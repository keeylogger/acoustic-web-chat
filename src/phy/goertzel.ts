export interface ToneProbe {
  freq: number;
  coeff: number;
  cos: number;
  sin: number;
}

export function makeProbe(freq: number, sampleRate: number): ToneProbe {
  const omega = (2 * Math.PI * freq) / sampleRate;
  return {
    freq,
    coeff: 2 * Math.cos(omega),
    cos: Math.cos(omega),
    sin: Math.sin(omega),
  };
}

/** Peak amplitude of a real sinusoid at `probe.freq`, independent of phase. */
export function probeAmplitude(samples: Float32Array, probe: ToneProbe): number {
  const length = samples.length;
  if (length === 0) return 0;
  const { coeff, cos, sin } = probe;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < length; i += 1) {
    const s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * cos;
  const imag = s2 * sin;
  return (2 * Math.hypot(real, imag)) / length;
}

export function toneAmplitude(samples: Float32Array, sampleRate: number, freq: number): number {
  return probeAmplitude(samples, makeProbe(freq, sampleRate));
}
