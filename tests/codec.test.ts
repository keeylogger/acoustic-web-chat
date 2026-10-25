import { describe, expect, it } from 'vitest';
import { CHANNELS, nibbleFrequency } from '../src/phy/channels';
import { FrameDecoder } from '../src/phy/decoder';
import { toneAmplitude } from '../src/phy/goertzel';
import { assessHardware } from '../src/phy/hardware';
import { binToFreq, freqToBin, parabolicOffset, parabolicPeakFromSpectrum } from '../src/phy/parabolic';
import { tukey } from '../src/phy/shape';
import { renderBytes, renderPulse } from '../src/phy/synth';
import { applyIncoming, ByteStreamDecoder, planEdit } from '../src/phy/text';
import { FRAME_PERIOD } from '../src/phy/timing';
import type { ChannelConfig } from '../src/phy/channels';

function runDecoder(sampleRate: number, channel: ChannelConfig, audio: Float32Array): number[] {
  const got: number[] = [];
  const decoder = new FrameDecoder(sampleRate, channel, (byte) => got.push(byte));
  const chunk = 128;
  for (let offset = 0; offset < audio.length; offset += chunk) {
    decoder.push(audio.subarray(offset, Math.min(audio.length, offset + chunk)));
  }
  decoder.push(new Float32Array(Math.round(sampleRate * 0.2)));
  return got;
}

function expectBytes(got: number[], expected: number[]): void {
  const index = got.findIndex((byte, i) => byte !== expected[i]);
  if (got.length !== expected.length || index !== -1) {
    const at = index === -1 ? expected.length : index;
    throw new Error(
      `mismatch at ${at}: expected ${expected[at]} got ${got[at]} (lengths ${got.length} vs ${expected.length})`,
    );
  }
}

function addNoise(buffer: Float32Array, amplitude: number, seed = 7): void {
  let state = seed >>> 0;
  for (let i = 0; i < buffer.length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    buffer[i] += ((state / 2 ** 32) * 2 - 1) * amplitude;
  }
}

function addEcho(buffer: Float32Array, delay: number, gain: number): void {
  const dry = buffer.slice();
  for (let i = delay; i < buffer.length; i += 1) buffer[i] += gain * dry[i - delay];
}

describe('framing tables', () => {
  it('keeps a 100 ms byte', () => {
    expect(FRAME_PERIOD).toBeCloseTo(0.1, 6);
  });

  it('matches the whitepaper tone map', () => {
    const alpha = CHANNELS.ULTRASONIC_ALPHA;
    const beta = CHANNELS.ULTRASONIC_BETA;
    const audible = CHANNELS.AUDIBLE_ALPHA;
    expect(alpha.preamble).toBe(17400);
    expect(nibbleFrequency(alpha, 0x0)).toBe(17500);
    expect(nibbleFrequency(alpha, 0x1)).toBe(17580);
    expect(nibbleFrequency(alpha, 0xf)).toBe(18700);
    expect(beta.preamble).toBe(18900);
    expect(nibbleFrequency(beta, 0x0)).toBe(19000);
    expect(nibbleFrequency(beta, 0xa)).toBe(19800);
    expect(nibbleFrequency(beta, 0xf)).toBe(20200);
    expect(audible.preamble).toBe(1400);
    expect(nibbleFrequency(audible, 0x0)).toBe(1500);
    expect(nibbleFrequency(audible, 0x5)).toBe(2000);
    expect(nibbleFrequency(audible, 0xf)).toBe(3000);
    expect(CHANNELS.AUDIBLE_BETA.preamble).toBe(3350);
    expect(nibbleFrequency(CHANNELS.AUDIBLE_BETA, 0x0)).toBe(3450);
    expect(nibbleFrequency(CHANNELS.AUDIBLE_BETA, 0xf)).toBe(4950);
  });

  it('shapes pulses with a Tukey window', () => {
    expect(tukey(0, 0.03)).toBe(0);
    expect(tukey(0.015, 0.03)).toBe(1);
    expect(tukey(0.03, 0.03)).toBe(0);
  });

  it('interpolates a spectral peak between bins', () => {
    expect(parabolicOffset(1, 3, 2)).toBeCloseTo(0.5 * (1 - 2) / (1 - 6 + 2), 6);
    expect(freqToBin(17500, 48000, 2048)).toBe(747);
    expect(binToFreq(747, 48000, 2048)).toBeCloseTo(17507.8, 0);
    const spectrum = new Float32Array(1024);
    spectrum.fill(-120);
    spectrum[99] = -40;
    spectrum[100] = -20;
    spectrum[101] = -30;
    const peak = parabolicPeakFromSpectrum(spectrum, 48000, 2048, 1000, 4000);
    expect(peak).not.toBeNull();
    expect(peak!.frequency).toBeGreaterThan(binToFreq(99.5, 48000, 2048));
    expect(peak!.frequency).toBeLessThan(binToFreq(100.5, 48000, 2048));
  });

  it('measures a sine at its own amplitude', () => {
    const sampleRate = 48000;
    const length = 768;
    const buffer = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      buffer[i] = 0.5 * Math.sin((2 * Math.PI * 2000 * i) / sampleRate);
    }
    expect(toneAmplitude(buffer, sampleRate, 2000)).toBeCloseTo(0.5, 2);
  });
});

describe('byte codec', () => {
  const phrase = 'Zażółć gęślą jaźń — äöü éà €';

  it.each([44100, 48000])('round-trips text at %s Hz', (sampleRate) => {
    const payload = [...new TextEncoder().encode(`${phrase}\n`)];
    const audio = renderBytes(sampleRate, CHANNELS.AUDIBLE_ALPHA, payload, 0.12, 0.4);
    expectBytes(runDecoder(sampleRate, CHANNELS.AUDIBLE_ALPHA, audio), payload);
  });

  it('round-trips every byte value', () => {
    const payload = Array.from({ length: 256 }, (_, byte) => byte);
    const audio = renderBytes(48000, CHANNELS.ULTRASONIC_ALPHA, payload, 0.12, 0.4);
    expectBytes(runDecoder(48000, CHANNELS.ULTRASONIC_ALPHA, audio), payload);
  }, 30_000);

  it('keeps Alpha and Beta apart when both transmit', () => {
    const sampleRate = 48000;
    const alpha = [...new TextEncoder().encode('Alpha')];
    const beta = [...new TextEncoder().encode('Beta!')];
    const mixed = renderBytes(sampleRate, CHANNELS.ULTRASONIC_ALPHA, alpha, 0.1, 0.35);
    const other = renderBytes(sampleRate, CHANNELS.ULTRASONIC_BETA, beta, 0.1, 0.35);
    for (let i = 0; i < other.length; i += 1) mixed[i] += other[i] ?? 0;
    expectBytes(runDecoder(sampleRate, CHANNELS.ULTRASONIC_ALPHA, mixed), alpha);
    expectBytes(runDecoder(sampleRate, CHANNELS.ULTRASONIC_BETA, mixed), beta);
  });

  it('ignores the opposite audible channel', () => {
    const payload = [...new TextEncoder().encode('solo')];
    const audio = renderBytes(48000, CHANNELS.AUDIBLE_ALPHA, payload);
    expect(runDecoder(48000, CHANNELS.AUDIBLE_BETA, audio)).toEqual([]);
  });

  it('survives a little noise and a short echo', () => {
    const payload = [...new TextEncoder().encode('Hello, Zürich')];
    const audio = renderBytes(44100, CHANNELS.AUDIBLE_BETA, payload, 0.12, 0.35);
    addEcho(audio, Math.round(0.006 * 44100), 0.28);
    addNoise(audio, 0.01, 11);
    expectBytes(runDecoder(44100, CHANNELS.AUDIBLE_BETA, audio), payload);
  });

  it('decodes UTF-8, newline, and backspace into text', () => {
    const payload = [...new TextEncoder().encode('ä€\n\b')];
    const audio = renderBytes(48000, CHANNELS.ULTRASONIC_BETA, payload);
    const decoded = new ByteStreamDecoder();
    let text = '';
    for (const byte of runDecoder(48000, CHANNELS.ULTRASONIC_BETA, audio)) {
      text = applyIncoming(text, decoded.push(byte));
    }
    expect(text).toBe('ä€');
  });

  it('renders a pulse that starts and ends at zero', () => {
    const buffer = new Float32Array(4800);
    renderPulse(buffer, 48000, 17500, 0.01, 0.02, 0.8);
    expect(Math.max(...buffer)).toBeGreaterThan(0.7);
    expect(buffer[Math.round(0.01 * 48000)]).toBeCloseTo(0, 5);
  });
});

describe('terminal edits', () => {
  it('appends, deletes one code point, and rejects a middle edit', () => {
    expect(planEdit('café', 'café!')).toEqual({ type: 'append', text: '!' });
    expect(planEdit('café', 'caf')).toEqual({ type: 'backspace' });
    expect(planEdit('café', 'cafX')).toEqual({ type: 'reject' });
    expect(planEdit('a', 'a\r\nb')).toEqual({ type: 'append', text: '\nb' });
    expect(applyIncoming('jaźń', '\b')).toBe('jaź');
    expect(applyIncoming('hi', '\n')).toBe('hi\n');
  });
});

describe('hardware gate', () => {
  it('sends Bluetooth headsets to audible mode', () => {
    const report = assessHardware({
      contextRate: 48000,
      trackRate: 16000,
      band: 'ULTRASONIC',
      link: 'DUPLEX',
      micGranted: true,
    });
    expect(report.level).toBe('block');
  });

  it('allows a wire demo without a microphone', () => {
    const report = assessHardware({
      contextRate: 48000,
      trackRate: null,
      band: 'ULTRASONIC',
      link: 'WIRE',
      micGranted: false,
    });
    expect(report.level).toBe('ok');
  });
});
