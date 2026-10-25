/** Fractional bin offset in [-0.5, 0.5] from the log-magnitude (or raw) peak. */
export function parabolicOffset(alpha: number, beta: number, gamma: number): number {
  const denom = alpha - 2 * beta + gamma;
  if (denom === 0) return 0;
  const offset = 0.5 * ((alpha - gamma) / denom);
  if (offset > 0.5) return 0.5;
  if (offset < -0.5) return -0.5;
  return offset;
}

export function freqToBin(freq: number, sampleRate: number, fftSize: number): number {
  return Math.round((freq * fftSize) / sampleRate);
}

export function binToFreq(bin: number, sampleRate: number, fftSize: number): number {
  return (bin * sampleRate) / fftSize;
}

export function parabolicPeakFromSpectrum(
  spectrum: Float32Array,
  sampleRate: number,
  fftSize: number,
  minFreq: number,
  maxFreq: number,
): { frequency: number; magnitude: number } | null {
  const minBin = Math.max(1, Math.floor((minFreq * fftSize) / sampleRate));
  const maxBin = Math.min(spectrum.length - 2, Math.ceil((maxFreq * fftSize) / sampleRate));
  if (maxBin <= minBin) return null;

  let maxMag = Number.NEGATIVE_INFINITY;
  let maxIdx = -1;
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    if (spectrum[bin] > maxMag) {
      maxMag = spectrum[bin];
      maxIdx = bin;
    }
  }
  if (maxIdx < 0 || !Number.isFinite(maxMag)) return null;

  const offset = parabolicOffset(spectrum[maxIdx - 1], spectrum[maxIdx], spectrum[maxIdx + 1]);
  return {
    frequency: (maxIdx + offset) * (sampleRate / fftSize),
    magnitude: maxMag,
  };
}
