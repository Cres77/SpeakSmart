# SpeakSmart coach

The coach page shows Connected, Connecting, or Disconnected, and the latest accelerometer X, Y, and Z. Reconnect asks the coach to join again.

`presage/` is an existing webcam metrics proof of concept. It is separate from this coach and still runs on its own.

## Run

Requires Node.js 20+.

```bash
npm install
npm start
```

Open http://127.0.0.1:4173/

`npm start` also launches a **development stand-in**. It is not a FreeWili. The page says so while that process is the coach. It sends `hello`, `heartbeat`, and synthetic `sensor` frames. The X, Y, and Z numbers move, and their units are unknown. They are not a hardware reading.

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

There is no movement score, graph, slideshow, session recording, or buzzer. `buzz` stays reserved in [shared/PROTOCOL.md](shared/PROTOCOL.md).

## Later phases

1. Coach link. Done.
2. Accelerometer X/Y/Z. Done for the protocol, page, and stand-in. The C binary does not read a device.
3. Movement intensity.
4. Live movement graph.
5. Presentation and slideshow.
6. Record practice sessions.
7. Gesture and excessive-movement detection.
8. FreeWili buzz commands.
9. Automatic buzz with cooldown.
10. Session analytics and coaching summary.

Thresholds for later phases already live in `shared/config.json`: sample rate, movement, gesture, stillness, and buzz cooldown, frequency, duration, and amplitude.
