import type { Band, LinkMode } from './channels';

export interface HardwareReport {
  level: 'ok' | 'warn' | 'block';
  message: string;
}

export function assessHardware(options: {
  contextRate: number;
  trackRate: number | null;
  band: Band;
  link: LinkMode;
  micGranted: boolean;
}): HardwareReport {
  const { contextRate, trackRate, band, link, micGranted } = options;
  const needsMic = link !== 'WIRE';

  if (needsMic && !micGranted) {
    return {
      level: 'block',
      message:
        'Microphone permission is off, so this station cannot hear the room. Use Wire demo on one computer, or allow the microphone and try again.',
    };
  }

  if (link === 'WIRE') {
    return {
      level: 'ok',
      message: `Wire demo. Audio engine ${formatRate(contextRate)}. The microphone is out of the circuit, so this station hears its own transmitter directly.`,
    };
  }

  const captureRate = trackRate ?? contextRate;
  if (band === 'ULTRASONIC' && needsMic && captureRate < 44100) {
    return {
      level: 'block',
      message: `The microphone is running at ${formatRate(captureRate)}. Bluetooth headsets often drop to 8 or 16 kHz and erase everything above 8 kHz. Disconnect the headset, or switch to Audible.`,
    };
  }

  if (band === 'ULTRASONIC' && contextRate < 44100) {
    return {
      level: 'block',
      message: `The audio engine is running at ${formatRate(contextRate)}. Near-ultrasonic tones need 44.1 kHz or higher. Switch to Audible.`,
    };
  }

  if (band === 'AUDIBLE' && captureRate < 11025 && needsMic) {
    return {
      level: 'warn',
      message: `The microphone is running at ${formatRate(captureRate)}. Station Beta’s audible tones reach 4.95 kHz and will be cut off. Use Station Alpha and take turns, or disconnect the headset.`,
    };
  }

  if (band === 'ULTRASONIC' && needsMic) {
    return {
      level: 'warn',
      message:
        'Ultrasonic mode is silent to most adults, and many laptop speakers fade out before 18 kHz. If the other station stays quiet, switch both devices to Audible.',
    };
  }

  return {
    level: 'ok',
    message: `Audio engine ${formatRate(contextRate)}. Microphone ${formatRate(captureRate)}. Filters off.`,
  };
}

function formatRate(rate: number): string {
  const khz = rate / 1000;
  const text = Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(1);
  return `${text} kHz`;
}
