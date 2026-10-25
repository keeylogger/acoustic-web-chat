import { FrameDecoder, type DecoderSnapshot } from '../phy/decoder';
import { channelById, type ChannelId } from '../phy/channels';

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

interface ConfigMessage {
  type: 'config';
  channelId: ChannelId;
  sampleRate: number;
}

class AwcReceiver extends AudioWorkletProcessor {
  private decoder: FrameDecoder | null = null;
  private meterSamples = 0;
  private meterEvery = 4800;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<ConfigMessage>) => {
      const data = event.data;
      if (!data || data.type !== 'config') return;
      const channel = channelById(data.channelId);
      const rate = data.sampleRate;
      if (!this.decoder || this.decoderRate !== rate) {
        this.decoderRate = rate;
        this.meterEvery = Math.max(128, Math.round(rate * 0.1));
        this.decoder = new FrameDecoder(rate, channel, (byte) => {
          this.port.postMessage({ type: 'byte', byte });
        });
      } else {
        this.decoder.setChannel(channel);
      }
    };
  }

  private decoderRate = 0;

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel && channel.length > 0 && this.decoder) {
      this.decoder.push(channel);
      this.meterSamples += channel.length;
      if (this.meterSamples >= this.meterEvery) {
        this.meterSamples = 0;
        const snap: DecoderSnapshot = this.decoder.snapshot();
        this.port.postMessage({ type: 'meter', snap });
      }
    }
    return true;
  }
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;

registerProcessor('awc-rx', AwcReceiver);
