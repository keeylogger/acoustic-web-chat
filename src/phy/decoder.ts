import { nibbleFrequency, type ChannelConfig } from './channels';
import { makeProbe, probeAmplitude, type ToneProbe } from './goertzel';
import {
  COOLDOWN_AFTER_PREAMBLE_SEC,
  HIGH_CENTER_AFTER_PREAMBLE_SEC,
  LOW_CENTER_AFTER_PREAMBLE_SEC,
  PEAK_TO_PREAMBLE_END_SEC,
} from './timing';

export type DecoderState = 'SEEK' | 'HIGH' | 'LOW' | 'COOLDOWN';

export interface DecoderSnapshot {
  state: DecoderState;
  noise: number;
  preamble: number;
  snrDb: number;
  lastByte: number | null;
}

interface PulsePoint {
  end: number;
  mag: number;
}

const MIN_MAG = 0.001;
const NOISE_RATIO = 5.5;
const DISTINCT_RATIO = 1.7;
const MIN_PULSE_HOPS = 5;
const FORCE_LOCK_HOPS = 16;
const NIBBLE_MARGIN = 1.3;

/**
 * Sliding matched filter for one FDD channel.
 * A 16 ms Goertzel bank runs every 2 ms. The preamble peak fixes the
 * symbol clock; nibble decisions are taken at the center of each 30 ms pulse.
 */
export class FrameDecoder {
  private ring: Float32Array;
  private scratch: Float32Array;
  private total = 0;
  private hopCursor = 0;
  private readonly hop: number;
  private readonly win: number;
  private preamble: ToneProbe;
  private guard: ToneProbe;
  private nibbles: ToneProbe[];

  private state: DecoderState = 'SEEK';
  private noise = 0.0008;
  private inPulse = false;
  private pulse: PulsePoint[] = [];
  private highDue = 0;
  private lowDue = 0;
  private coolDue = 0;
  private highNibble = 0;
  private lastPreamble = 0;
  private lastSnr = 0;
  private lastByte: number | null = null;

  constructor(
    private readonly sampleRate: number,
    channel: ChannelConfig,
    private readonly onByte: (byte: number) => void,
  ) {
    this.hop = Math.max(32, Math.round(sampleRate * 0.002));
    this.win = Math.max(64, Math.round(sampleRate * 0.016));
    this.ring = new Float32Array(Math.round(sampleRate * 0.6));
    this.scratch = new Float32Array(this.win);
    this.preamble = makeProbe(channel.preamble, sampleRate);
    this.guard = makeProbe(channel.guardFreq, sampleRate);
    this.nibbles = probesFor(channel, sampleRate);
  }

  setChannel(channel: ChannelConfig): void {
    this.preamble = makeProbe(channel.preamble, this.sampleRate);
    this.guard = makeProbe(channel.guardFreq, this.sampleRate);
    this.nibbles = probesFor(channel, this.sampleRate);
    this.reset();
  }

  reset(): void {
    this.state = 'SEEK';
    this.inPulse = false;
    this.pulse = [];
    this.highNibble = 0;
    this.lastByte = null;
    this.lastPreamble = 0;
    this.lastSnr = 0;
  }

  snapshot(): DecoderSnapshot {
    return {
      state: this.state,
      noise: this.noise,
      preamble: this.lastPreamble,
      snrDb: this.lastSnr,
      lastByte: this.lastByte,
    };
  }

  push(input: Float32Array): void {
    const ring = this.ring;
    const size = ring.length;
    for (let i = 0; i < input.length; i += 1) {
      ring[this.total % size] = input[i];
      this.total += 1;
      this.hopCursor += 1;
      if (this.hopCursor >= this.hop && this.total >= this.win) {
        this.hopCursor = 0;
        this.tick(this.total);
      }
    }
  }

  private tick(end: number): void {
    if (this.state === 'HIGH') {
      if (end >= this.highDue) this.sampleHigh();
      return;
    }
    if (this.state === 'LOW') {
      if (end >= this.lowDue) this.sampleLow();
      return;
    }
    if (this.state === 'COOLDOWN') {
      if (end >= this.coolDue) {
        this.state = 'SEEK';
        this.inPulse = false;
        this.pulse = [];
      }
      return;
    }
    this.seek(end);
  }

  private seek(end: number): void {
    this.fill(end);
    const preamble = probeAmplitude(this.scratch, this.preamble);
    const guard = probeAmplitude(this.scratch, this.guard);
    this.noise = this.noise * 0.96 + guard * 0.04;
    this.lastPreamble = preamble;

    let bestNibble = 0;
    for (let i = 0; i < this.nibbles.length; i += 1) {
      const mag = probeAmplitude(this.scratch, this.nibbles[i]);
      if (mag > bestNibble) bestNibble = mag;
    }

    const floor = Math.max(this.noise * NOISE_RATIO, MIN_MAG);
    const hit = preamble > floor && preamble > bestNibble * DISTINCT_RATIO;

    if (hit) {
      if (!this.inPulse) {
        this.inPulse = true;
        this.pulse = [];
      }
      this.pulse.push({ end, mag: preamble });
      if (this.pulse.length >= FORCE_LOCK_HOPS) this.lock();
      return;
    }

    if (this.inPulse) {
      if (this.pulse.length >= MIN_PULSE_HOPS && preamble < this.peakMag() * 0.62) {
        this.lock();
      } else {
        this.inPulse = false;
        this.pulse = [];
      }
    }
  }

  private lock(): void {
    const peakAt = Math.round(refinePeak(this.pulse));
    const preambleEnd = peakAt + Math.round(PEAK_TO_PREAMBLE_END_SEC * this.sampleRate);
    const half = Math.round(this.win / 2);
    this.highDue = preambleEnd + Math.round(HIGH_CENTER_AFTER_PREAMBLE_SEC * this.sampleRate) + half;
    this.lowDue = preambleEnd + Math.round(LOW_CENTER_AFTER_PREAMBLE_SEC * this.sampleRate) + half;
    this.coolDue = preambleEnd + Math.round(COOLDOWN_AFTER_PREAMBLE_SEC * this.sampleRate);
    this.lastSnr = snrDb(this.peakMag(), this.noise);
    this.state = 'HIGH';
    this.inPulse = false;
    this.pulse = [];
  }

  private sampleHigh(): void {
    const picked = this.pickNibble(this.highDue);
    // Nibble 0 is a real symbol. A falsy check would drop every byte below 0x10.
    if (picked === null) {
      this.abort();
      return;
    }
    this.highNibble = picked;
    this.state = 'LOW';
  }

  private sampleLow(): void {
    const picked = this.pickNibble(this.lowDue);
    if (picked === null) {
      this.abort();
      return;
    }
    const byte = ((this.highNibble & 0x0f) << 4) | picked;
    this.lastByte = byte;
    this.state = 'COOLDOWN';
    this.onByte(byte);
  }

  private abort(): void {
    this.state = 'COOLDOWN';
    this.coolDue = this.total + Math.round(0.045 * this.sampleRate);
    this.inPulse = false;
    this.pulse = [];
  }

  private pickNibble(end: number): number | null {
    this.fill(end);
    let best = 0;
    let bestMag = -1;
    let second = 0;
    for (let i = 0; i < this.nibbles.length; i += 1) {
      const mag = probeAmplitude(this.scratch, this.nibbles[i]);
      if (mag > bestMag) {
        second = bestMag;
        bestMag = mag;
        best = i;
      } else if (mag > second) {
        second = mag;
      }
    }
    const floor = Math.max(this.noise * NOISE_RATIO, MIN_MAG);
    if (bestMag < floor) return null;
    if (second > 0 && bestMag < second * NIBBLE_MARGIN) return null;
    return best;
  }

  private fill(end: number): void {
    const start = end - this.win;
    const size = this.ring.length;
    const scratch = this.scratch;
    for (let i = 0; i < this.win; i += 1) {
      scratch[i] = this.ring[(start + i) % size];
    }
  }

  private peakMag(): number {
    let peak = 0;
    for (const point of this.pulse) if (point.mag > peak) peak = point.mag;
    return peak;
  }
}

function probesFor(channel: ChannelConfig, sampleRate: number): ToneProbe[] {
  const probes: ToneProbe[] = [];
  for (let nibble = 0; nibble < 16; nibble += 1) {
    probes.push(makeProbe(nibbleFrequency(channel, nibble), sampleRate));
  }
  return probes;
}

function refinePeak(points: PulsePoint[]): number {
  if (points.length === 0) return 0;
  let index = 0;
  for (let i = 1; i < points.length; i += 1) {
    if (points[i].mag > points[index].mag) index = i;
  }
  if (index === 0 || index === points.length - 1) return points[index].end;
  const alpha = points[index - 1].mag;
  const beta = points[index].mag;
  const gamma = points[index + 1].mag;
  const denom = alpha - 2 * beta + gamma;
  let offset = 0;
  if (denom !== 0) offset = 0.5 * ((alpha - gamma) / denom);
  if (offset > 0.5) offset = 0.5;
  if (offset < -0.5) offset = -0.5;
  const hop = points[index].end - points[index - 1].end;
  return points[index].end + offset * hop;
}

function snrDb(signal: number, noise: number): number {
  const ratio = signal / Math.max(noise, 1e-8);
  if (ratio <= 0) return 0;
  return 20 * Math.log10(ratio);
}
