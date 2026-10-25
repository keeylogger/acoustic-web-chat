import { TUKEY_ALPHA } from './timing';

/** Tapered cosine. Zero at both ends, one through the middle, continuous slope. */
export function tukey(t: number, duration: number, alpha = TUKEY_ALPHA): number {
  if (duration <= 0 || t <= 0 || t >= duration) return 0;
  const edge = (alpha * duration) / 2;
  if (edge <= 0) return 1;
  if (t < edge) {
    return 0.5 * (1 + Math.cos((2 * Math.PI / (alpha * duration)) * (t - edge)));
  }
  if (t <= duration - edge) return 1;
  return 0.5 * (1 + Math.cos((2 * Math.PI / (alpha * duration)) * (t - duration + edge)));
}
