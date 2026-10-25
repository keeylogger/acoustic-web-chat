export type Band = 'ULTRASONIC' | 'AUDIBLE';
export type Station = 'ALPHA' | 'BETA';
export type LinkMode = 'DUPLEX' | 'AIR' | 'WIRE';

export type ChannelId =
  | 'ULTRASONIC_ALPHA'
  | 'ULTRASONIC_BETA'
  | 'AUDIBLE_ALPHA'
  | 'AUDIBLE_BETA';

export interface ChannelConfig {
  id: ChannelId;
  band: Band;
  station: Station;
  /** Sync tone, just below nibble 0. */
  preamble: number;
  /** Frequency of nibble 0x0. */
  baseFreq: number;
  /** Hertz between adjacent nibbles. */
  step: number;
  /** Quiet bin used as a noise reference. */
  guardFreq: number;
}

export const CHANNELS: Record<ChannelId, ChannelConfig> = {
  ULTRASONIC_ALPHA: {
    id: 'ULTRASONIC_ALPHA',
    band: 'ULTRASONIC',
    station: 'ALPHA',
    preamble: 17400,
    baseFreq: 17500,
    step: 80,
    guardFreq: 17150,
  },
  ULTRASONIC_BETA: {
    id: 'ULTRASONIC_BETA',
    band: 'ULTRASONIC',
    station: 'BETA',
    preamble: 18900,
    baseFreq: 19000,
    step: 80,
    guardFreq: 20450,
  },
  AUDIBLE_ALPHA: {
    id: 'AUDIBLE_ALPHA',
    band: 'AUDIBLE',
    station: 'ALPHA',
    preamble: 1400,
    baseFreq: 1500,
    step: 100,
    guardFreq: 1180,
  },
  /**
   * Second audible channel so two phones can type at once.
   * The whitepaper defines only one audible map; a shared map cannot be full duplex.
   * Tones sit on a 50 Hz offset from Alpha harmonics (2 × 1.5–3.0 kHz land on even hundreds).
   */
  AUDIBLE_BETA: {
    id: 'AUDIBLE_BETA',
    band: 'AUDIBLE',
    station: 'BETA',
    preamble: 3350,
    baseFreq: 3450,
    step: 100,
    guardFreq: 5200,
  },
};

export function channelById(id: ChannelId): ChannelConfig {
  return CHANNELS[id];
}

export function channelFor(band: Band, station: Station): ChannelConfig {
  return CHANNELS[`${band}_${station}`];
}

export function opposite(station: Station): Station {
  return station === 'ALPHA' ? 'BETA' : 'ALPHA';
}

export function transmitChannel(band: Band, station: Station): ChannelConfig {
  return channelFor(band, station);
}

export function receiveChannel(band: Band, station: Station, link: LinkMode): ChannelConfig {
  const listen = link === 'DUPLEX' ? opposite(station) : station;
  return channelFor(band, listen);
}

export function nibbleFrequency(channel: ChannelConfig, nibble: number): number {
  return channel.baseFreq + nibble * channel.step;
}

export function tones(channel: ChannelConfig): { name: string; freq: number }[] {
  const rows = [{ name: 'Preamble', freq: channel.preamble }];
  for (let nibble = 0; nibble < 16; nibble += 1) {
    rows.push({
      name: `0x${nibble.toString(16).toUpperCase()}`,
      freq: nibbleFrequency(channel, nibble),
    });
  }
  return rows;
}

export function waterfallRange(band: Band): { min: number; max: number } {
  if (band === 'ULTRASONIC') return { min: 17000, max: 20600 };
  return { min: 1000, max: 5400 };
}

export function listenRange(channel: ChannelConfig): { min: number; max: number } {
  return {
    min: channel.preamble - 60,
    max: channel.baseFreq + 15 * channel.step + 60,
  };
}

export function defaultTransmitLevel(band: Band): number {
  return band === 'AUDIBLE' ? 0.16 : 0.72;
}
