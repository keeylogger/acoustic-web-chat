import type { ChannelConfig } from '../phy/channels';
import { nibbleFrequency } from '../phy/channels';
import { renderPulse } from '../phy/synth';
import { FRAME_PERIOD, HIGH_START, LOW_START, NIBBLE_SEC, PREAMBLE_SEC } from '../phy/timing';

export class Transmitter {
  readonly output: GainNode;
  private cursor = 0;
  private readonly cache = new Map<string, AudioBuffer>();

  constructor(private readonly ctx: AudioContext) {
    this.output = ctx.createGain();
    this.output.gain.value = 0.2;
  }

  setLevel(level: number): void {
    const clamped = Math.max(0, Math.min(1, level));
    this.output.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.01);
  }

  backlog(): number {
    return Math.max(0, this.cursor - this.ctx.currentTime);
  }

  sendBytes(bytes: Uint8Array, channel: ChannelConfig): void {
    const lead = this.ctx.currentTime + 0.05;
    if (this.cursor < lead) this.cursor = lead;
    for (const byte of bytes) {
      this.scheduleByte(byte, channel, this.cursor);
      this.cursor += FRAME_PERIOD;
    }
  }

  private scheduleByte(byte: number, channel: ChannelConfig, when: number): void {
    const high = (byte >> 4) & 0x0f;
    const low = byte & 0x0f;
    this.schedulePulse(channel.preamble, when, PREAMBLE_SEC);
    this.schedulePulse(nibbleFrequency(channel, high), when + HIGH_START, NIBBLE_SEC);
    this.schedulePulse(nibbleFrequency(channel, low), when + LOW_START, NIBBLE_SEC);
  }

  private schedulePulse(freq: number, when: number, duration: number): void {
    const source = this.ctx.createBufferSource();
    source.buffer = this.bufferFor(freq, duration);
    source.connect(this.output);
    source.onended = () => source.disconnect();
    source.start(when);
  }

  private bufferFor(freq: number, duration: number): AudioBuffer {
    const key = `${this.ctx.sampleRate}|${freq}|${duration}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const length = Math.max(1, Math.round(duration * this.ctx.sampleRate));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    renderPulse(buffer.getChannelData(0), this.ctx.sampleRate, freq, 0, duration, 1);
    this.cache.set(key, buffer);
    return buffer;
  }
}
