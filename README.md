# SpeakSmart coach

The coach page shows Connected, Connecting, or Disconnected, the latest accelerometer X, Y, and Z, a movement intensity, and the last minute of that intensity. It also shows Still, Gesturing, or Excessive since the latest coach hello, with gesture and excessive counts and a stillness percent. Reconnect asks the coach to join again. Presentation holds slide decks in this browser.

`presage/` is an existing webcam metrics proof of concept. It is separate from this coach and still runs on its own.

## Run

Requires Node.js 20+.

```bash
npm install
npm start
```

Open http://127.0.0.1:4173/

`npm start` also launches a **development stand-in**. It is not a FreeWili. The page says so while that process is the coach. It sends `hello`, `heartbeat`, and synthetic `sensor` frames with raw X, Y, and Z only. It does not invent a movement score. The server computes intensity and the page shows it as a percent plus a Chart.js line. The axis units are unknown. They are not a hardware reading. Disconnect and a new coach hello clear the line.

To leave the page Disconnected until something else connects:

```bash
SPEAKSMART_STANDIN=0 npm start
```

The server listens on all interfaces, port 4173 (`SPEAKSMART_PORT` overrides it), so a later coach on the same network can reach it. The stand-in itself uses localhost.

## Tests

```bash
npm test
```

That runs the server tests and `make -C firmware test`. The firmware test checks the radio state machine without hardware. The device entry exits 2 and prints why it did not join Wi-Fi.

## What is not live on a FreeWili

`hardware_accel_poll` returns no sample. `fwwasm.h` does not define a sensor payload struct, and `enable_motion_stream` has no documented numeric frame, so neither is parsed. `hardware_wifi_join` still returns unverified and the device entry still exits 2.

A manual buzz command is in [shared/PROTOCOL.md](shared/PROTOCOL.md). The page can send one pulse. The coach answers that no tone was played. Intensity is a relative score in the sample's unknown units. The formula is only in `shared/movement.mjs`. The chart reads that score; it does not compute a second one. Slide decks are saved in the browser at `localStorage` key `speaksmart.decks`. Practice sessions are saved at `speaksmart.sessions`.

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
10. Session analytics and coaching summary.

Thresholds live in `shared/config.json`: sample rate, movement, gesture magnitude and timing, stillness, excessive level and timing, and buzz cooldown, frequency, duration, and amplitude. The page reads that file. Firmware does not apply it.
