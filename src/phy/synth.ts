import { nibbleFrequency, type ChannelConfig } from './channels';
import { tukey } from './shape';
import { FRAME_PERIOD, HIGH_START, LOW_START, NIBBLE_SEC, PREAMBLE_SEC } from './timing';

export function renderPulse(
  out: Float32Array,
  sampleRate: number,
  freq: number,
  startSec: number,
  durationSec: number,
  amplitude: number,
): void {
  const start = Math.round(startSec * sampleRate);
  const count = Math.round(durationSec * sampleRate);
  for (let i = 0; i < count; i += 1) {
    const index = start + i;
    if (index < 0 || index >= out.length) continue;
    const t = i / sampleRate;
    out[index] += amplitude * tukey(t, durationSec) * Math.sin(2 * Math.PI * freq * t);
  }
}

export function mixByte(
  out: Float32Array,
  sampleRate: number,
  channel: ChannelConfig,
  byte: number,
  startSec: number,
  amplitude: number,
): void {
  const high = (byte >> 4) & 0x0f;
  const low = byte & 0x0f;
  renderPulse(out, sampleRate, channel.preamble, startSec, PREAMBLE_SEC, amplitude);
  renderPulse(
    out,
    sampleRate,
    nibbleFrequency(channel, high),
    startSec + HIGH_START,
    NIBBLE_SEC,
    amplitude,
  );
  renderPulse(
    out,
    sampleRate,
    nibbleFrequency(channel, low),
    startSec + LOW_START,
    NIBBLE_SEC,
    amplitude,
  );
}

export function renderBytes(
  sampleRate: number,
  channel: ChannelConfig,
  bytes: number[],
  leadSec = 0.12,
  amplitude = 0.45,
): Float32Array {
  const totalSec = leadSec + bytes.length * FRAME_PERIOD + 0.08;
  const out = new Float32Array(Math.ceil(totalSec * sampleRate));
  bytes.forEach((byte, index) => {
    mixByte(out, sampleRate, channel, byte, leadSec + index * FRAME_PERIOD, amplitude);
  });
  return out;
}
