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

`npm start` launches a USB bridge. It calls `FreeWili.find_all()` and `FreeWili.open()` from the `freewili` package (`bridge/requirements.txt`, freewili 0.0.51). One plugged-in FreeWili is used, whatever serial the library reports. Leave `FREEWILI_SERIAL` empty for that board. Set `FREEWILI_SERIAL` when more than one board is plugged in, or to require a specific serial. The server log says it is looking for a FreeWili. It names a serial only when `FREEWILI_SERIAL` is set. The page stays Disconnected until that library opens the board. The bridge then sends `transport: "freewili"` and `deviceId` set to the serial the library reports. If several boards are present and no serial is set, the process prints those serials and does not send that transport. If none is selected, it prints that the FreeWili was not found and does not send that transport. An Espressif USB JTAG/serial debug unit (VID `0x303a`, PID `0x1001`) is not a FreeWili. If that is the only device `find_all()` returns, the process prints that and does not send `transport: "freewili"`.

Python 3.10+ and the package are required:

```bash
cd FreeWili
python3 -m pip install -r bridge/requirements.txt
npm start
```

If Python or the package is missing, `npm start` prints that install command. `freewili` 0.0.51 has no IP argument, so `FREEWILI_HOST` is unused and the bridge stays on USB.

`npm run diagnose` opens that same board and prints, for Display and then Main, `get_app_info`, `enable_accel_events(True, 100, processor)`, event counts from 5 seconds of `process_events()`, and `play_audio_tone(350, 0.15, 0.2, processor)`. It asks you to note whether you heard a tone. It does not report that a tone played.

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

The on-device C build is unchanged. `hardware_accel_poll` returns no sample. `fwwasm.h` does not define a sensor payload struct, and `enable_motion_stream` has no documented numeric frame, so neither is parsed. `hardware_wifi_join` still returns unverified and the device entry still exits 2. The live board path is the USB host bridge in `bridge/`, which uses `freewili` on the computer the board is plugged into.

A manual buzz command is in [shared/PROTOCOL.md](shared/PROTOCOL.md). The page can send one pulse. The acknowledgement stays `played: false`. The page says the command was sent and asks you to listen for the tone. Intensity is a relative score in the sample's unknown units. The formula is only in `shared/movement.mjs`. The chart reads that score; it does not compute a second one. Slide decks are saved in the browser at `localStorage` key `speaksmart.decks`. Practice sessions are saved at `speaksmart.sessions`.

## Later phases

1. Coach link. Done.
2. Accelerometer X/Y/Z. Done for the protocol, page, and stand-in. The C binary does not read a device.
3. Movement intensity. Done on the server and the page. The stand-in still sends raw X, Y, and Z. The C binary does not score samples.
4. Live movement graph. Done on the page from the server's intensity. About 4 points per second, last 60 seconds. Cleared on disconnect and on a new coach hello.
5. Presentation and slideshow. Done in the browser. Create a deck, edit slides, and present them with a timer. Leaving presentation mode ends it. Decks stay in `localStorage` under `speaksmart.decks`.
6. Record practice sessions. Done in the browser. Start practice while presenting, then review the saved session under Practice. Sessions stay in `localStorage` under `speaksmart.sessions`, separate from decks.
7. Gesture and excessive-movement detection. Done on the page from the server's smoothed magnitude and movement score. A practice review lists the events from that practice. Buzz stays empty. No tone and no coaching sentence.
8. Manual buzz command. Done. Settings stores frequency, duration, and amplitude in this browser. Buzz FreeWili and Test Buzz each send one command. The pulse cannot be retriggered until its duration has elapsed. The stand-in replies `played: false`. No automatic buzz.
9. Automatic buzz with cooldown. Done. Settings can turn on automatic movement feedback. It is off by default. An excessive hold sends one buzz, then waits `buzzCooldownMs` (3000 ms) before another. The acknowledgement stays `played: false`.
10. Session analytics and coaching summary. Done. Analytics and the practice review call one summary of the saved session. Automatic feedback stays off unless the setting is on. The acknowledgement stays `played: false`.

A resting pose can be saved in this browser under `speaksmart.calibration`. The server uses that vector as the movement baseline. Clearing it restores the first-sample baseline. Automatic feedback stays off unless the setting is on.

A slide can store an optional cue. Presentation shows that text under the slide. Settings can buzz once when that slide is entered. The checkbox is off by default, under `speaksmart.buzz`. The acknowledgement stays `played: false`.

Thresholds live in `shared/config.json`: sample rate, movement, gesture magnitude and timing, stillness, excessive level and timing, buzz cooldown, frequency, duration, and amplitude, and calibration duration. The page reads that file. Firmware does not apply it.
