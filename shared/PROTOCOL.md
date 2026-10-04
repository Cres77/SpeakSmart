# SpeakSmart coach protocol

Phase 1 uses JSON text frames on a WebSocket. One JSON object is one message. Timestamps are integer milliseconds. The coach does not send raw sample streams in this phase.

The local server is the hub. The browser and the coach are both clients of that server. A development stand-in can speak the coach side so the page can be exercised without hardware. Its `transport` is `development-stand-in`. That process is not a FreeWili.

## Implemented now

### Coach → server

`hello` — first message after the socket opens.

```json
{
  "type": "hello",
  "role": "device",
  "timestamp": 1710000000000,
  "deviceId": "dev-stand-in",
  "transport": "development-stand-in"
}
```

`transport` is optional. Phase 1 never sends `transport: "freewili"` because no verified outbound socket exists on the device. Do not treat a missing transport as a physical FreeWili.

`heartbeat` — liveness while the socket stays open. Interval is `heartbeatIntervalMs` in `shared/config.json` (2000). The server marks the coach disconnected if none arrives within `heartbeatTimeoutMs` (7000).

```json
{
  "type": "heartbeat",
  "role": "device",
  "timestamp": 1710000002000,
  "deviceId": "dev-stand-in"
}
```

`disconnect` — the coach is closing the socket on purpose.

```json
{
  "type": "disconnect",
  "role": "device",
  "timestamp": 1710000003000,
  "deviceId": "dev-stand-in",
  "reason": "shutdown"
}
```

`reason` is `shutdown` or `reconnect`.

### Browser → server

`hello` — the page announces itself. The server answers with the current `link` message.

```json
{ "type": "hello", "role": "browser", "timestamp": 1710000000000 }
```

`reconnect` — ask the coach to drop the socket and open it again.

```json
{ "type": "reconnect", "role": "browser", "timestamp": 1710000004000 }
```

### Server → browser

`link` — connection indicator. Sent on browser hello, and whenever coach state changes, including each accepted heartbeat (`lastSeen` moves).

```json
{
  "type": "link",
  "timestamp": 1710000002000,
  "status": "connected",
  "deviceId": "dev-stand-in",
  "transport": "development-stand-in",
  "lastSeen": 1710000002000
}
```

`status` is `connected`, `connecting`, or `disconnected`. During a reconnect the status stays `connecting` until the next coach `hello` or until `reconnectGraceMs` (5000) expires.

### Server → coach

`welcome` — answer to a coach `hello`. Tells the coach the expected heartbeat interval. No hardware action.

```json
{ "type": "welcome", "timestamp": 1710000000000, "heartbeatIntervalMs": 2000 }
```

`reconnect` — forwarded from the browser. The coach sends `disconnect` with `reason: "reconnect"`, closes, then connects again and sends `hello`.

```json
{ "type": "reconnect", "timestamp": 1710000004000 }
```

### Either client

`error` — the server rejected a frame. The socket stays open.

```json
{
  "type": "error",
  "timestamp": 1710000005000,
  "code": "reserved",
  "for": "buzz",
  "message": "That message is reserved for a later phase and was not executed."
}
```

`code` is `reserved`, `invalid`, or `unknown`.

## Reserved — not executed

These shapes are part of the contract so later phases stay consistent. Phase 1 rejects them with `error` / `code: "reserved"`. The server does not store them, chart them, or forward `buzz` to hardware. The firmware recognizes `buzz` only so a stray frame cannot be mistaken for a sensor loop, and it does not play a tone.

### `sensor` (coach → server), phases 2–4 and 7

```json
{
  "type": "sensor",
  "timestamp": 1710000000000,
  "deviceId": "wrist-1",
  "accel": { "x": 0.12, "y": 0.87, "z": 9.71 },
  "movement": 0.72
}
```

`movement` is reserved until intensity exists (phase 3). Do not send this in phase 1, including from the stand-in.

Axis units are not verified. See `firmware/hardware_freewili.c`. Later code must not assume millig, g, or m/s² until a sample frame from the device is captured.

### `buzz` (website → coach), phases 8–9

```json
{ "type": "buzz", "frequency": 350, "duration": 150 }
```

`frequency` is hertz and `duration` is milliseconds. Defaults live in `shared/config.json`: 350 Hz, 150 ms, amplitude 0.2, cooldown 2000 ms. Amplitude is the fwwasm recommended level for a later call, not a measured speaker setting. Phase 1 does not play sound.

Two verified tone APIs use different duration units. Do not mix them:

- OneWili `dev.io.audio.tone(frequency: float, duration_ms: float, amplitude: float)` — duration in milliseconds.
- WASM `playSoundFromFrequencyAndDuration(float frequency, float duration, float amplitude, audioWaveType wavetype)` — duration in seconds.

Neither documents a frequency range, so 300–400 Hz is expressible and not confirmed audible.

## Limits

Coach messages in phase 1 are hello, heartbeat, and disconnect, plus the reconnect handshake. There is no slideshow, calibration, session, or raw-sample channel. Frames larger than 4 KiB are dropped.
