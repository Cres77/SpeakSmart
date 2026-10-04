# SpeakSmart coach

Phase 1 connects a presentation coach to this website over a WebSocket. The page shows Connected, Connecting, or Disconnected, and Reconnect asks the coach to join again.

`presage/` is an existing webcam metrics proof of concept. It is separate from this coach and still runs on its own.

## Run

Requires Node.js 20+.

```bash
npm install
npm start
```

Open http://127.0.0.1:4173/

`npm start` also launches a **development stand-in**. It is not a FreeWili. The page says so while that process is the coach. It sends `hello` and `heartbeat` only.

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

## What Phase 1 does not do

No accelerometer samples, movement score, graph, slideshow, session recording, or buzzer. Those message types are reserved in [shared/PROTOCOL.md](shared/PROTOCOL.md).

A physical FreeWili will not show Connected yet. The checked firmware APIs can join Wi-Fi, but no verified outbound WebSocket client exists. The calls are named and left uncalled in [firmware/hardware_freewili.c](firmware/hardware_freewili.c).

## Later phases

1. Coach link. This phase.
2. Read the accelerometer and send X/Y/Z.
3. Movement intensity.
4. Live movement graph.
5. Presentation and slideshow.
6. Record practice sessions.
7. Gesture and excessive-movement detection.
8. FreeWili buzz commands.
9. Automatic buzz with cooldown.
10. Session analytics and coaching summary.

Thresholds for later phases already live in `shared/config.json`: sample rate, movement, gesture, stillness, and buzz cooldown, frequency, duration, and amplitude.
