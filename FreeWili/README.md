# SpeakSmart coach

The coach page shows Connected, Connecting, or Disconnected, the latest accelerometer X, Y, and Z, a movement intensity, and the last minute of that intensity. It also shows Still, Gesturing, or Excessive since the latest coach hello, with gesture and excessive counts and a stillness percent. Reconnect asks the coach to join again. Presentation holds slide decks in this browser.

`presage/` at the repository root is an existing webcam metrics proof of concept. It is separate from this coach and still runs on its own.

## Run

Requires Node.js 20+. From a fresh clone, run these in the repository root. The coach lives in `FreeWili/`.

```bash
cd FreeWili
npm install
npm start
```

Open http://127.0.0.1:4173/

`npm start` launches a USB bridge. It uses OneWili from git, pinned in `bridge/requirements.txt`, not freewili-python. One plugged-in FreeWili is used. Leave `FREEWILI_SERIAL` empty for that board. Set `FREEWILI_SERIAL` when more than one board is plugged in. The bridge opens only the Main CDC port `0x093C:0x2054` with `OneWili(port).open()`. It does not open the Display port and it does not open the Espressif debug port `0x303a:0x1001`. Accelerometer samples are g. The bridge divides OneWili `*motion` milli-g by 1000 before the sensor frame. Stand-in samples stay unitless, and the page labels them as the stand-in. A buzz while that stream is running can drop a few queued samples. The page stays Disconnected until that port opens. The bridge then sends `transport: "freewili"` and `deviceId` set to the serial. If several boards are present and no serial is set, the process prints those serials and does not send that transport.

Python 3.10+ and the package are required:

```bash
cd FreeWili
python3 -m pip install -r bridge/requirements.txt
npm start
```

If Python or OneWili is missing, `npm start` prints that install command. OneWili takes no IP address, so `FREEWILI_HOST` is unused and the bridge stays on USB.

`npm run diagnose` opens that same Main port. OneWili at the pinned commit does not expose a firmware version, so the script says so and prints the USB product name when the finder has one. It turns on the sensor zone, streams motion for 5 seconds, prints the sample count and a few g values, then plays a 350 Hz, 150 ms tone and asks you to listen. It does not report that a tone was heard.

```bash
cd FreeWili
npm run diagnose
```

The development stand-in is off unless you ask for it. It is not a FreeWili. The page says so while that process is the coach.

```bash
cd FreeWili
SPEAKSMART_STANDIN=1 npm start
```

The server listens on all interfaces, port 4173 (`SPEAKSMART_PORT` overrides it). The bridge and the stand-in use localhost.

## Tests

```bash
cd FreeWili
npm test
```

That runs the server tests and `make -C firmware test`. The firmware test checks the radio state machine without hardware. The device entry exits 2 and prints why it did not join Wi-Fi.

## What is not live on a FreeWili

The on-device C build is unchanged and is not the live path. `hardware_accel_poll` returns no sample. `hardware_wifi_join` still returns unverified and the device entry still exits 2. The live board path is the USB host bridge in `bridge/`, which uses OneWili on the computer the board is plugged into.

A manual buzz command is in [shared/PROTOCOL.md](shared/PROTOCOL.md). The page can send one pulse. `played` is true only when OneWili's tone command returns OK. The page asks you to listen. Intensity uses `movementThreshold` on those numbers. For a FreeWili they are g. The kept defaults are starting points to tune with calibration: movement 0.35 g, stillness 0.08 g, and gesture 0.5 g. The formula is only in `shared/movement.mjs`. The chart reads that score; it does not compute a second one. Slide decks are saved in the browser at `localStorage` key `speaksmart.decks`. Practice sessions are saved at `speaksmart.sessions`.

## Later phases

1. Coach link. Done.
2. Accelerometer X/Y/Z. Done for the protocol, page, and stand-in. The C binary does not read a device.
3. Movement intensity. Done on the server and the page. The stand-in still sends raw X, Y, and Z. The C binary does not score samples.
4. Live movement graph. Done on the page from the server's intensity. About 4 points per second, last 60 seconds. Cleared on disconnect and on a new coach hello.
5. Presentation and slideshow. Done in the browser. Create a deck, edit slides, and present them with a timer. Leaving presentation mode ends it. Decks stay in `localStorage` under `speaksmart.decks`.
6. Record practice sessions. Done in the browser. Start practice while presenting, then review the saved session under Practice. Sessions stay in `localStorage` under `speaksmart.sessions`, separate from decks.
7. Gesture and excessive-movement detection. Done on the page from the server's smoothed magnitude and movement score. A practice review lists the events from that practice. Buzz stays empty. No tone and no coaching sentence.
8. Manual buzz command. Done. Settings stores frequency, duration, and amplitude in this browser. Buzz FreeWili and Test Buzz each send one command. The pulse cannot be retriggered until its duration has elapsed. The stand-in replies `played: false`. No automatic buzz.
9. Automatic buzz with cooldown. Done. Settings can turn on automatic movement feedback. It is off by default. An excessive hold sends one buzz, then waits `buzzCooldownMs` (3000 ms) before another. The stand-in replies `played: false`. The USB bridge sets `played` from whether the tone command returns OK.
10. Session analytics and coaching summary. Done. Analytics and the practice review call one summary of the saved session. Automatic feedback stays off unless the setting is on. The stand-in replies `played: false`.

A resting pose can be saved in this browser under `speaksmart.calibration`. The server uses that vector as the movement baseline. Clearing it restores the first-sample baseline. Automatic feedback stays off unless the setting is on.

A slide can store an optional cue. Presentation shows that text under the slide. Settings can buzz once when that slide is entered. The checkbox is off by default, under `speaksmart.buzz`. The stand-in replies `played: false`.

Thresholds live in `shared/config.json`: sample rate, movement, gesture magnitude and timing, stillness, excessive level and timing, buzz cooldown, frequency, duration, and amplitude, and calibration duration. The page reads that file. Firmware does not apply it.
