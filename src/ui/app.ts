import { AcousticEngine } from '../audio/engine';
import {
  channelFor,
  defaultTransmitLevel,
  listenRange,
  opposite,
  receiveChannel,
  tones,
  transmitChannel,
  waterfallRange,
  CHANNELS,
  type Band,
  type LinkMode,
  type Station,
} from '../phy/channels';
import { assessHardware, type HardwareReport } from '../phy/hardware';
import type { DecoderSnapshot } from '../phy/decoder';
import { applyIncoming, planEdit } from '../phy/text';
import { FRAME_PERIOD } from '../phy/timing';
import { Waterfall } from './waterfall';

const TEST_SENTENCE = 'Zażółć gęślą jaźń — äöü éà €';

export function mount(root: Element): void {
  root.innerHTML = template();
  const ui = bind(root);
  const app = new Playground(ui);
  app.init();
}

interface Ui {
  band: NodeListOf<HTMLInputElement>;
  station: NodeListOf<HTMLInputElement>;
  link: NodeListOf<HTMLInputElement>;
  level: HTMLInputElement;
  levelOut: HTMLElement;
  mic: HTMLInputElement;
  micOut: HTMLElement;
  enable: HTMLButtonElement;
  release: HTMLButtonElement;
  test: HTMLButtonElement;
  copy: HTMLButtonElement;
  clearSender: HTMLButtonElement;
  clearReceiver: HTMLButtonElement;
  banner: HTMLElement;
  status: HTMLElement;
  queue: HTMLElement;
  txLamp: HTMLElement;
  rxLamp: HTMLElement;
  sender: HTMLTextAreaElement;
  senderHint: HTMLElement;
  receiver: HTMLElement;
  receiverHint: HTMLElement;
  empty: HTMLElement;
  waterfall: HTMLCanvasElement;
  peak: HTMLElement;
  scale: HTMLElement;
  marks: HTMLElement;
  protocol: HTMLElement;
}

function bind(root: Element): Ui {
  const take = <T extends Element>(selector: string): T => {
    const node = root.querySelector(selector);
    if (!node) throw new Error(`Missing ${selector}`);
    return node as T;
  };
  return {
    band: root.querySelectorAll('input[name="band"]'),
    station: root.querySelectorAll('input[name="station"]'),
    link: root.querySelectorAll('input[name="link"]'),
    level: take('input[name="level"]'),
    levelOut: take('[data-level]'),
    mic: take('input[name="mic"]'),
    micOut: take('[data-mic]'),
    enable: take('[data-enable]'),
    release: take('[data-release]'),
    test: take('[data-test]'),
    copy: take('[data-copy]'),
    clearSender: take('[data-clear-sender]'),
    clearReceiver: take('[data-clear-receiver]'),
    banner: take('[data-banner]'),
    status: take('[data-status]'),
    queue: take('[data-queue]'),
    txLamp: take('[data-tx-lamp]'),
    rxLamp: take('[data-rx-lamp]'),
    sender: take('textarea'),
    senderHint: take('[data-sender-hint]'),
    receiver: take('[data-receiver]'),
    receiverHint: take('[data-receiver-hint]'),
    empty: take('[data-empty]'),
    waterfall: take('canvas'),
    peak: take('[data-peak]'),
    scale: take('[data-scale]'),
    marks: take('[data-marks]'),
    protocol: take('[data-protocol]'),
  };
}

class Playground {
  private engine: AcousticEngine | null = null;
  private waterfall: Waterfall | null = null;
  private sent = '';
  private received = '';
  private composing = false;
  private starting = false;
  private meter: DecoderSnapshot | null = null;
  private timer = 0;
  private micNote = '';

  constructor(private readonly ui: Ui) {}

  init(): void {
    this.readQuery();
    this.ui.protocol.innerHTML = protocolHtml();
    this.bindControls();
    this.refreshLabels();
    this.renderTranscripts();
    this.setBanner({
      level: 'ok',
      message: 'Audio stays off until you enable it. Pick a station first if you already know which device is which.',
    });
    if (!window.isSecureContext) {
      this.setBanner({
        level: 'block',
        message: 'Browsers only open the microphone on HTTPS or localhost. Open the GitHub Pages URL instead of a file on disk.',
      });
      this.ui.enable.disabled = true;
    }
  }

  private bindControls(): void {
    for (const input of [...this.ui.band, ...this.ui.station, ...this.ui.link]) {
      input.addEventListener('change', () => {
        if (input.name === 'band') {
          this.ui.level.value = String(defaultTransmitLevel(this.band));
        }
        void this.onRouteChange();
      });
    }
    this.ui.level.addEventListener('input', () => {
      this.refreshLabels();
      this.engine?.setTransmitLevel(Number(this.ui.level.value));
    });
    this.ui.mic.addEventListener('input', () => {
      this.refreshLabels();
      this.engine?.setMicGain(Number(this.ui.mic.value));
    });
    this.ui.enable.addEventListener('click', () => void this.enable());
    this.ui.release.addEventListener('click', () => this.release());
    this.ui.test.addEventListener('click', () => this.transmit(TEST_SENTENCE));
    this.ui.copy.addEventListener('click', () => void this.copyPartner());
    this.ui.clearSender.addEventListener('click', () => {
      this.sent = '';
      this.renderTranscripts();
    });
    this.ui.clearReceiver.addEventListener('click', () => {
      this.received = '';
      this.renderTranscripts();
    });
    this.ui.sender.addEventListener('compositionstart', () => {
      this.composing = true;
    });
    this.ui.sender.addEventListener('compositionend', () => {
      this.composing = false;
      this.reconcile();
    });
    this.ui.sender.addEventListener('input', () => {
      if (!this.composing) this.reconcile();
    });
  }

  private async enable(): Promise<void> {
    if (this.engine || this.starting) return;
    this.starting = true;
    this.ui.enable.disabled = true;
    this.micNote = '';
    try {
      const engine = await AcousticEngine.create({
        onText: (chunk) => this.accept(chunk),
        onMeter: (snapshot) => {
          this.meter = snapshot;
        },
      });
      this.engine = engine;
      try {
        await engine.requestMicrophone();
      } catch (error) {
        this.micNote = micErrorMessage(error);
      }
      this.applyRoute();
      this.waterfall = new Waterfall(this.ui.waterfall, engine.analyser, (peak) => {
        this.ui.peak.textContent = peak
          ? `Peak ${formatHz(peak.frequency)} · ${peak.magnitude.toFixed(0)} dB`
          : 'Peak —';
      });
      this.waterfall.setRanges(waterfallRange(this.band), listenRange(this.rx));
      this.waterfall.start();
      this.ui.enable.textContent = 'Audio running';
      this.ui.release.disabled = false;
      this.ui.test.disabled = false;
      this.ui.sender.disabled = false;
      this.ui.sender.focus();
      this.timer = window.setInterval(() => this.paintLive(), 100);
      this.paintLive();
      this.reportHardware();
    } catch (error) {
      this.engine?.destroy();
      this.engine = null;
      this.ui.enable.disabled = false;
      this.ui.enable.textContent = 'Enable speakers and microphone';
      this.setBanner({
        level: 'block',
        message: error instanceof Error ? error.message : 'Audio failed to start.',
      });
    } finally {
      this.starting = false;
    }
  }

  private release(): void {
    window.clearInterval(this.timer);
    this.waterfall?.stop();
    this.waterfall = null;
    this.engine?.destroy();
    this.engine = null;
    this.meter = null;
    this.ui.enable.disabled = false;
    this.ui.enable.textContent = 'Enable speakers and microphone';
    this.ui.release.disabled = true;
    this.ui.test.disabled = true;
    this.ui.sender.disabled = true;
    this.ui.txLamp.classList.remove('on');
    this.ui.rxLamp.classList.remove('rx');
    this.ui.queue.textContent = 'Idle';
    this.setBanner({ level: 'ok', message: 'Microphone released. Transcripts stay on this page.' });
  }

  private async onRouteChange(): Promise<void> {
    this.refreshLabels();
    if (!this.engine) return;
    this.applyRoute();
    this.reportHardware();
  }

  private applyRoute(): void {
    const engine = this.engine;
    if (!engine) return;
    engine.setTransmitLevel(Number(this.ui.level.value));
    engine.setMicGain(Number(this.ui.mic.value));
    engine.setLoopback(this.link === 'WIRE');
    void engine.listen(this.rx);
    this.waterfall?.setRanges(waterfallRange(this.band), listenRange(this.rx));
  }

  private reportHardware(): void {
    const engine = this.engine;
    if (!engine) return;
    const report = assessHardware({
      contextRate: engine.sampleRate,
      trackRate: engine.trackSampleRate,
      band: this.band,
      link: this.link,
      micGranted: engine.micGranted,
    });
    if (this.micNote && !engine.micGranted) {
      this.setBanner({ level: report.level === 'ok' ? 'warn' : report.level, message: `${this.micNote} ${report.message}` });
      return;
    }
    this.setBanner(report);
  }

  private reconcile(): void {
    const plan = planEdit(this.sent, this.ui.sender.value);
    if (plan.type === 'noop') {
      if (this.ui.sender.value !== this.sent) this.ui.sender.value = this.sent;
      return;
    }
    if (!this.engine) {
      this.ui.sender.value = this.sent;
      return;
    }
    if (plan.type === 'append') {
      this.transmit(plan.text);
      return;
    }
    if (plan.type === 'backspace') {
      const chars = Array.from(this.sent);
      chars.pop();
      this.sent = chars.join('');
      this.ui.sender.value = this.sent;
      this.engine.sendBytes(new Uint8Array([0x08]), this.tx);
      return;
    }
    this.ui.sender.value = this.sent;
    this.ui.queue.textContent = 'Type at the end. Backspace deletes one character.';
  }

  private transmit(text: string): void {
    if (!this.engine || !text) return;
    this.sent += text;
    const chars = Array.from(this.sent);
    if (chars.length > 8000) this.sent = chars.slice(-8000).join('');
    this.ui.sender.value = this.sent;
    this.ui.sender.scrollTop = this.ui.sender.scrollHeight;
    this.engine.sendText(text, this.tx);
  }

  private accept(chunk: string): void {
    this.received = applyIncoming(this.received, chunk);
    this.renderTranscripts();
  }

  private renderTranscripts(): void {
    this.ui.sender.value = this.sent;
    this.ui.receiver.textContent = this.received;
    this.ui.receiver.scrollTop = this.ui.receiver.scrollHeight;
    this.ui.empty.hidden = this.received.length > 0;
  }

  private paintLive(): void {
    const engine = this.engine;
    if (!engine) return;
    const queued = engine.backlog();
    this.ui.queue.textContent = queued > 0.08 ? `Sending · ${queued.toFixed(1)}s queued` : 'Idle';
    this.ui.txLamp.classList.toggle('on', queued > 0.02);
    const hearing = !!this.meter && (this.meter.state !== 'SEEK' || this.meter.preamble > Math.max(this.meter.noise * 6, 0.004));
    this.ui.rxLamp.classList.toggle('rx', hearing);
    const snap = this.meter;
    const rxState = snap ? snap.state.toLowerCase() : 'seek';
    const snr = snap && snap.snrDb > 0 ? ` · last lock ${snap.snrDb.toFixed(0)} dB` : '';
    const last = snap?.lastByte === null || snap?.lastByte === undefined
      ? ''
      : ` · last byte 0x${snap.lastByte.toString(16).padStart(2, '0')}`;
    this.ui.status.textContent = `${formatRate(engine.sampleRate)} · listen ${this.rx.id.replaceAll('_', ' ').toLowerCase()} · ${rxState}${snr}${last}`;
  }

  private async copyPartner(): Promise<void> {
    const url = partnerUrl(this.band, this.station, this.link);
    try {
      await navigator.clipboard.writeText(url);
      this.ui.queue.textContent = 'Partner link copied.';
    } catch {
      this.ui.queue.textContent = url;
    }
  }

  private refreshLabels(): void {
    const level = Number(this.ui.level.value);
    const mic = Number(this.ui.mic.value);
    this.ui.levelOut.textContent = level.toFixed(2);
    this.ui.micOut.textContent = `${mic.toFixed(1)}×`;
    const tx = this.tx;
    const rx = this.rx;
    this.ui.senderHint.textContent = `Speaks ${formatHz(tx.preamble)}–${formatHz(tx.baseFreq + 15 * tx.step)}`;
    this.ui.receiverHint.textContent = `Listens ${formatHz(rx.preamble)}–${formatHz(rx.baseFreq + 15 * rx.step)}`;
    const range = waterfallRange(this.band);
    this.ui.scale.textContent = `${formatHz(range.min)} to ${formatHz(range.max)} · ${Math.round(FRAME_PERIOD * 1000)} ms / byte`;
    const alpha = channelFor(this.band, 'ALPHA');
    const beta = channelFor(this.band, 'BETA');
    this.ui.marks.innerHTML = '';
    for (const mark of [
      { label: 'Alpha', freq: alpha.baseFreq },
      { label: 'Beta', freq: beta.baseFreq },
    ]) {
      const el = document.createElement('i');
      const pct = ((mark.freq - range.min) / (range.max - range.min)) * 100;
      el.style.left = `${Math.min(96, Math.max(4, pct))}%`;
      el.textContent = mark.label;
      this.ui.marks.append(el);
    }
  }

  private readQuery(): void {
    const params = new URLSearchParams(location.search);
    setRadio(this.ui.band, normalizeBand(params.get('band')));
    setRadio(this.ui.station, normalizeStation(params.get('station')));
    setRadio(this.ui.link, normalizeLink(params.get('link')));
    const band = this.band;
    this.ui.level.value = String(defaultTransmitLevel(band));
  }

  private setBanner(report: HardwareReport): void {
    this.ui.banner.className = `banner ${report.level}`;
    this.ui.banner.textContent = report.message;
  }

  private get band(): Band {
    return selected(this.ui.band) === 'ULTRASONIC' ? 'ULTRASONIC' : 'AUDIBLE';
  }

  private get station(): Station {
    return selected(this.ui.station) === 'BETA' ? 'BETA' : 'ALPHA';
  }

  private get link(): LinkMode {
    const value = selected(this.ui.link);
    if (value === 'AIR' || value === 'WIRE') return value;
    return 'DUPLEX';
  }

  private get tx() {
    return transmitChannel(this.band, this.station);
  }

  private get rx() {
    return receiveChannel(this.band, this.station, this.link);
  }
}

function selected(nodes: NodeListOf<HTMLInputElement>): string {
  for (const node of nodes) if (node.checked) return node.value;
  return nodes[0]?.value ?? '';
}

function setRadio(nodes: NodeListOf<HTMLInputElement>, value: string | null): void {
  if (!value) return;
  for (const node of nodes) node.checked = node.value === value;
}

function normalizeBand(value: string | null): string | null {
  if (!value) return null;
  const text = value.toUpperCase();
  if (text === 'AUDIBLE' || text === 'ULTRASONIC') return text;
  return null;
}

function normalizeStation(value: string | null): string | null {
  if (!value) return null;
  const text = value.toUpperCase();
  if (text === 'ALPHA' || text === 'BETA') return text;
  return null;
}

function normalizeLink(value: string | null): string | null {
  if (!value) return null;
  const text = value.toUpperCase();
  if (text === 'DUPLEX' || text === 'AIR' || text === 'WIRE') return text;
  return null;
}

function partnerUrl(band: Band, station: Station, link: LinkMode): string {
  const url = new URL(location.href);
  url.searchParams.set('band', band.toLowerCase());
  const partner = link === 'DUPLEX' ? opposite(station) : station;
  url.searchParams.set('station', partner.toLowerCase());
  url.searchParams.set('link', link.toLowerCase());
  return url.toString();
}

function formatHz(freq: number): string {
  if (freq < 1000) return `${Math.round(freq)} Hz`;
  const khz = freq / 1000;
  const text = Number.isInteger(khz) ? khz.toFixed(0) : khz.toFixed(2).replace(/0$/, '');
  return `${text} kHz`;
}

function formatRate(rate: number): string {
  return `${(rate / 1000).toFixed(rate % 1000 === 0 ? 0 : 1)} kHz`;
}

function micErrorMessage(error: unknown): string {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return 'Microphone permission was denied.';
  }
  if (error instanceof Error) return error.message;
  return 'Microphone request failed.';
}

function protocolHtml(): string {
  const audible = toneRows(CHANNELS.AUDIBLE_ALPHA, CHANNELS.AUDIBLE_BETA);
  const ultra = toneRows(CHANNELS.ULTRASONIC_ALPHA, CHANNELS.ULTRASONIC_BETA);
  return `
    <div class="help">
      <div class="pair">
        <div><strong>Device A.</strong> Audible or Ultrasonic, station Alpha, link Two devices.</div>
        <div><strong>Device B.</strong> The same band, station Beta, link Two devices. Use “Copy link for the other device”.</div>
      </div>
      <p>Put them within about a meter, raise the volume, and turn silent mode off. Each byte is a 20 ms preamble, 10 ms of silence, a 30 ms high nibble, 10 ms of silence, and a 30 ms low nibble. That is 100 ms, about 10 bytes a second. Letters with accents take two or three bytes.</p>
      <p>Wire demo loops the transmitter into the receiver inside this browser, so one computer can prove the codec with the microphone muted. Air demo listens to the channel it is transmitting, which is the right test when one laptop’s speaker faces its own microphone. Two devices use opposite channels so a station does not decode its own voice.</p>
      <p>Audible Beta is an extension. The specification defines a single audible map, and two people cannot type at once on one map. Beta audible tones run from 3.35 kHz to 4.95 kHz, offset by 50 Hz from the harmonics of Alpha.</p>
      <h2>Audible</h2>
      ${audible}
      <h2>Near-ultrasonic</h2>
      ${ultra}
      <p>Nothing you type is uploaded. The page only asks for the microphone so it can hear the other device.</p>
    </div>`;
}

function toneRows(left: (typeof CHANNELS)[keyof typeof CHANNELS], right: (typeof CHANNELS)[keyof typeof CHANNELS]): string {
  const a = tones(left);
  const b = tones(right);
  const rows = a
    .map((tone, index) => `<tr><td>${tone.name}</td><td>${tone.freq.toLocaleString('en-US')} Hz</td><td>${b[index].freq.toLocaleString('en-US')} Hz</td></tr>`)
    .join('');
  return `<table><thead><tr><th></th><th>${left.station === 'ALPHA' ? 'Alpha' : 'Left'}</th><th>${right.station === 'BETA' ? 'Beta' : 'Right'}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function template(): string {
  return `
    <main class="shell">
      <header class="top">
        <div>
          <div class="mark"><b>AWC-1</b></div>
          <h1>AcousticWebChat</h1>
          <p class="lede">Two browsers in the same room. Text moves as short tones from one speaker into the other microphone. There is no server, no account, and no Wi-Fi pairing.</p>
        </div>
        <div class="pill">Local audio only</div>
      </header>
      <section class="panel controls">
        <div class="row">
          <div class="field">
            <span>Band</span>
            <div class="segment" role="radiogroup" aria-label="Band">
              <label><input type="radio" name="band" value="AUDIBLE" checked /> Audible</label>
              <label><input type="radio" name="band" value="ULTRASONIC" /> Ultrasonic</label>
            </div>
          </div>
          <div class="field">
            <span>This station</span>
            <div class="segment" role="radiogroup" aria-label="Station">
              <label><input type="radio" name="station" value="ALPHA" checked /> Alpha</label>
              <label><input type="radio" name="station" value="BETA" /> Beta</label>
            </div>
          </div>
          <div class="field">
            <span>Link</span>
            <div class="segment" role="radiogroup" aria-label="Link">
              <label><input type="radio" name="link" value="DUPLEX" checked /> Two devices</label>
              <label><input type="radio" name="link" value="AIR" /> Air demo</label>
              <label><input type="radio" name="link" value="WIRE" /> Wire demo</label>
            </div>
          </div>
        </div>
        <div class="sliders">
          <label>Transmit <input name="level" type="range" min="0" max="1" step="0.01" value="0.16" /> <b data-level>0.16</b></label>
          <label>Mic gain <input name="mic" type="range" min="0.5" max="8" step="0.1" value="2" /> <b data-mic>2.0×</b></label>
        </div>
        <div class="actions">
          <button class="primary" type="button" data-enable>Enable speakers and microphone</button>
          <button class="ghost" type="button" data-release disabled>Release audio</button>
          <button class="ghost" type="button" data-test disabled>Send test sentence</button>
          <button class="ghost" type="button" data-copy>Copy link for the other device</button>
          <button class="ghost" type="button" data-clear-sender>Clear sender view</button>
          <button class="ghost" type="button" data-clear-receiver>Clear receiver view</button>
        </div>
        <div class="banner ok" data-banner></div>
        <div class="statusline">
          <i class="lamp" data-tx-lamp></i>
          <i class="lamp" data-rx-lamp></i>
          <span data-status>Waiting to start</span>
          <span data-queue>Idle</span>
        </div>
      </section>
      <section class="panes">
        <article class="pane sender">
          <header><strong>SENDER</strong><em data-sender-hint></em></header>
          <textarea disabled autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Sender" placeholder="Enable audio, then type. Enter is a new line."></textarea>
          <div class="footnote">Backspace deletes the last character on the other station. Middle-of-line edits are ignored.</div>
        </article>
        <article class="pane receiver">
          <header>
            <strong>RECEIVER</strong>
            <em data-receiver-hint></em>
          </header>
          <div class="transcript" data-receiver role="log" aria-label="Receiver"></div>
          <p class="empty" data-empty>Waiting. One computer: choose Wire demo, enable audio, and send the test sentence. Two computers: opposite stations, same band, link set to Two devices.</p>
          <div class="footnote">Heard text stays here until you clear the view. Backspace from the other station deletes the last character.</div>
        </article>
      </section>
      <section class="spectrum">
        <div class="spectrum-head"><span>Waterfall</span><span data-peak>Peak —</span></div>
        <canvas id="waterfall" width="900" height="168" aria-label="Acoustic waterfall"></canvas>
        <div class="scale" data-scale></div>
        <div class="marks" data-marks></div>
      </section>
      <details>
        <summary>How the two stations share the air</summary>
        <div data-protocol></div>
      </details>
    </main>`;
}
