import { Transmitter } from './transmitter';
import type { ChannelConfig, ChannelId } from '../phy/channels';
import type { DecoderSnapshot } from '../phy/decoder';
import { ByteStreamDecoder, encodeText } from '../phy/text';

export interface EngineHandlers {
  onText: (chunk: string) => void;
  onMeter: (snapshot: DecoderSnapshot) => void;
}

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
  sampleRate: { ideal: 48000 },
};

export class AcousticEngine {
  readonly context: AudioContext;
  readonly transmitter: Transmitter;
  readonly analyser: AnalyserNode;
  private readonly mix: GainNode;
  private readonly micGain: GainNode;
  private readonly loopGain: GainNode;
  private readonly sink: GainNode;
  private worklet: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private chars = new ByteStreamDecoder();
  private micLevel = 2;
  private loopback = false;
  private micOpen = false;

  private constructor(
    context: AudioContext,
    private readonly handlers: EngineHandlers,
  ) {
    this.context = context;
    this.transmitter = new Transmitter(context);
    this.mix = context.createGain();
    this.mix.channelCount = 1;
    this.mix.channelCountMode = 'explicit';
    this.micGain = context.createGain();
    this.micGain.gain.value = 0;
    this.loopGain = context.createGain();
    this.loopGain.gain.value = 0;
    this.sink = context.createGain();
    this.sink.gain.value = 0;

    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.1;
    this.analyser.minDecibels = -110;
    this.analyser.maxDecibels = -20;

    this.micGain.connect(this.mix);
    this.loopGain.connect(this.mix);
    this.mix.connect(this.analyser);
    this.analyser.connect(this.sink);
    this.sink.connect(context.destination);
    this.transmitter.output.connect(context.destination);
    this.transmitter.output.connect(this.loopGain);

    context.addEventListener('statechange', () => {
      if (context.state === 'suspended') void context.resume();
    });
  }

  static async create(handlers: EngineHandlers): Promise<AcousticEngine> {
    const context = createContext();
    await context.resume();
    const engine = new AcousticEngine(context, handlers);
    await engine.installWorklet();
    return engine;
  }

  get sampleRate(): number {
    return this.context.sampleRate;
  }

  get trackSampleRate(): number | null {
    const track = this.stream?.getAudioTracks()[0];
    const rate = track?.getSettings().sampleRate;
    return typeof rate === 'number' && rate > 0 ? rate : null;
  }

  get micGranted(): boolean {
    return this.micOpen;
  }

  async requestMicrophone(): Promise<void> {
    if (this.micOpen) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser has no microphone API.');
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    }
    this.attachStream(stream);
  }

  setTransmitLevel(level: number): void {
    this.transmitter.setLevel(level);
  }

  setMicGain(level: number): void {
    this.micLevel = Math.max(0, Math.min(8, level));
    if (this.micOpen && !this.loopback) this.micGain.gain.value = this.micLevel;
  }

  setLoopback(enabled: boolean): void {
    this.loopback = enabled;
    this.loopGain.gain.value = enabled ? 1 : 0;
    this.micGain.gain.value = enabled || !this.micOpen ? 0 : this.micLevel;
  }

  async listen(channel: ChannelConfig): Promise<void> {
    if (!this.worklet) throw new Error('Receiver worklet is not running.');
    this.chars.reset();
    this.worklet.port.postMessage({
      type: 'config',
      channelId: channel.id satisfies ChannelId,
      sampleRate: this.context.sampleRate,
    });
  }

  sendText(text: string, channel: ChannelConfig): void {
    const bytes = encodeText(text);
    if (bytes.length === 0) return;
    this.transmitter.sendBytes(bytes, channel);
  }

  sendBytes(bytes: Uint8Array, channel: ChannelConfig): void {
    if (bytes.length === 0) return;
    this.transmitter.sendBytes(bytes, channel);
  }

  backlog(): number {
    if (this.context.state === 'closed') return 0;
    return this.transmitter.backlog();
  }

  destroy(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.micOpen = false;
    void this.context.close();
  }

  private attachStream(stream: MediaStream): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = stream;
    const source = this.context.createMediaStreamSource(stream);
    source.connect(this.micGain);
    this.micOpen = true;
    this.micGain.gain.value = this.loopback ? 0 : this.micLevel;
  }

  private async installWorklet(): Promise<void> {
    const url = new URL('awc-rx-worklet.js', document.baseURI).href;
    await this.context.audioWorklet.addModule(url);
    this.worklet = new AudioWorkletNode(this.context, 'awc-rx', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    this.mix.connect(this.worklet);
    this.worklet.connect(this.sink);
    this.worklet.port.onmessage = (event: MessageEvent<{ type: string; byte?: number; snap?: DecoderSnapshot }>) => {
      const data = event.data;
      if (!data) return;
      if (data.type === 'byte' && typeof data.byte === 'number') {
        const chunk = this.chars.push(data.byte & 0xff);
        if (chunk) this.handlers.onText(chunk);
        return;
      }
      if (data.type === 'meter' && data.snap) this.handlers.onMeter(data.snap);
    };
  }
}

function createContext(): AudioContext {
  const options: AudioContextOptions = { latencyHint: 'interactive', sampleRate: 48000 };
  try {
    return new AudioContext(options);
  } catch {
    return new AudioContext({ latencyHint: 'interactive' });
  }
}
