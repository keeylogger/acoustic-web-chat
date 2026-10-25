# AcousticWebChat

Two browsers in the same room can type to each other through the air. One device plays short tones; the other hears them. There is no server, no account, and no Wi-Fi pairing.

The page is a static playground meant for GitHub Pages. Sender and receiver sit side by side. Each browser is a station: **Alpha** or **Beta**.

## Talk across two devices

1. Open the page on both devices. Use headphones only if they leave the sample rate at 44.1 kHz or higher. A Bluetooth headset in call mode will not work.
2. Choose the same band on both. **Audible** is the one that works on phone speakers. **Ultrasonic** (17.4–20.2 kHz) is silent to most adults and is often missing from laptop speakers.
3. Set one station to Alpha and the other to Beta. Link: **Two devices**.
4. Press **Enable speakers and microphone**, allow the mic, turn the volume up, and type.

Alpha transmits on one set of tones and listens on the other, so a station does not decode its own speaker. Copy link for the other device writes a URL with the opposite station already selected.

Put the devices within about a meter. Each byte takes 100 ms: 20 ms preamble, 10 ms silence, 30 ms high nibble, 10 ms silence, 30 ms low nibble. Accented letters take more than one byte, so a sentence queues for a few seconds. The status line shows the queue.

Backspace sends the ASCII backspace and deletes the last character on the other screen. Enter sends a newline. The sender is append-only; edits in the middle of the line are ignored.

## Try it on one computer

**Wire demo** connects the transmitter to the receiver inside the browser and mutes the microphone. Press **Send test sentence**. The Polish pangram, a few accents, and the euro sign should appear on the right. This is the codec check.

**Air demo** listens on the same channel it transmits, so a laptop can hear its own speaker. Ultrasonic air tests fail on a lot of machines even when the wire demo passes. Switch both sides to Audible if a real pair stays quiet.

## Bands

| | Alpha | Beta |
|---|---|---|
| Ultrasonic preamble | 17,400 Hz | 18,900 Hz |
| Ultrasonic nibbles | 17,500 + n × 80 Hz | 19,000 + n × 80 Hz |
| Audible preamble | 1,400 Hz | 3,350 Hz |
| Audible nibbles | 1,500 + n × 100 Hz | 3,450 + n × 100 Hz |

Audible Alpha matches the specification table. Audible Beta is an extra channel: the specification only defines one audible map, and two people cannot type at once on a single map. Beta sits 50 Hz away from the second harmonics of Alpha so mild speaker distortion does not look like a Beta tone.

Keystrokes are UTF-8 bytes, split into 4-bit nibbles. The microphone is opened with echo cancellation, noise suppression, and auto gain turned off. If the capture rate is below 44.1 kHz, the page refuses ultrasonic mode.

## Run locally

```bash
npm install
npm test
npm run dev
```

The receiver that runs in the browser is an AudioWorklet. Vite writes it to `public/awc-rx-worklet.js` when the dev server or the production build starts. `npm test` does not need a browser: it synthesizes the tones and runs the same decoder on the samples.

## GitHub Pages

This checkout was built without a GitHub login, so the site is not published yet. From a machine that can push:

```bash
git init
git add .
git commit -m "Add AcousticWebChat playground"
gh repo create acoustic-web-chat --public --source=. --remote=origin --push
```

In the repository settings, set Pages to **GitHub Actions**. The workflow `.github/workflows/deploy.yml` tests, builds, and deploys `dist/` on every push to `main`. The Vite `base` is `./`, so the same build works for a user site or a project site.

The live page only needs a static host. Typed text never leaves the browser.
