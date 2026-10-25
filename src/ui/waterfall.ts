import { parabolicPeakFromSpectrum } from '../phy/parabolic';

export interface WaterfallPeak {
  frequency: number;
  magnitude: number;
}

function ramp(t: number): [number, number, number] {
  if (t < 0.12) return [4, Math.floor(28 * (t / 0.12)), 8];
  if (t < 0.5) {
    const u = (t - 0.12) / 0.38;
    return [Math.floor(30 * u), Math.floor(36 + 140 * u), Math.floor(18 * u)];
  }
  if (t < 0.82) {
    const u = (t - 0.5) / 0.32;
    return [Math.floor(30 + 190 * u), Math.floor(176 + 60 * u), Math.floor(18 + 30 * u)];
  }
  const u = (t - 0.82) / 0.18;
  return [Math.floor(220 + 35 * u), Math.floor(236 + 19 * u), Math.floor(48 + 170 * u)];
}

export class Waterfall {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly temp: HTMLCanvasElement;
  private readonly tempCtx: CanvasRenderingContext2D;
  private readonly spectrum: Float32Array<ArrayBuffer>;
  private view = { min: 1000, max: 5400 };
  private listen = { min: 1200, max: 3200 };
  private running = false;
  private frame = 0;
  private readonly onPeak: (peak: WaterfallPeak | null) => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly analyser: AnalyserNode,
    onPeak: (peak: WaterfallPeak | null) => void,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const temp = document.createElement('canvas');
    const tempCtx = temp.getContext('2d', { alpha: false });
    if (!ctx || !tempCtx) throw new Error('Canvas is unavailable.');
    this.ctx = ctx;
    this.temp = temp;
    this.tempCtx = tempCtx;
    this.spectrum = new Float32Array(analyser.frequencyBinCount);
    this.onPeak = onPeak;
    this.resize();
  }

  setRanges(view: { min: number; max: number }, listen: { min: number; max: number }): void {
    this.view = view;
    this.listen = listen;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.draw();
  }

  stop(): void {
    this.running = false;
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.temp.width = width;
    this.temp.height = height;
    this.ctx.fillStyle = '#050705';
    this.ctx.fillRect(0, 0, width, height);
  }

  private draw = (): void => {
    if (!this.running) return;
    this.resize();
    const { width } = this.canvas;
    this.analyser.getFloatFrequencyData(this.spectrum);
    this.tempCtx.drawImage(this.canvas, 0, 0);
    this.ctx.drawImage(this.temp, 0, 1);

    const row = this.ctx.createImageData(width, 1);
    const { min, max } = this.view;
    const nyquist = this.analyser.context.sampleRate / 2;
    const bins = this.analyser.frequencyBinCount;
    const data = row.data;
    for (let x = 0; x < width; x += 1) {
      const freq = min + ((x + 0.5) / width) * (max - min);
      const bin = (freq / nyquist) * bins;
      const i0 = Math.max(0, Math.min(bins - 1, Math.floor(bin)));
      const i1 = Math.min(bins - 1, i0 + 1);
      const frac = bin - Math.floor(bin);
      const db = this.spectrum[i0] * (1 - frac) + this.spectrum[i1] * frac;
      const norm = Math.max(0, Math.min(1, (db + 100) / 78));
      const [r, g, b] = ramp(norm);
      const p = x * 4;
      data[p] = r;
      data[p + 1] = g;
      data[p + 2] = b;
      data[p + 3] = 255;
    }
    this.ctx.putImageData(row, 0, 0);

    this.frame += 1;
    if (this.frame % 4 === 0) {
      const peak = parabolicPeakFromSpectrum(
        this.spectrum,
        this.analyser.context.sampleRate,
        this.analyser.fftSize,
        this.listen.min,
        this.listen.max,
      );
      this.onPeak(peak && peak.magnitude > -90 ? peak : null);
    }
    requestAnimationFrame(this.draw);
  };
}
