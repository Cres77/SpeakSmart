# SpeakSmart coach protocol

JSON text frames on a WebSocket. One JSON object is one message. Timestamps are integer milliseconds. Phase 2 sends one accelerometer sample per `sensor` message. It does not send a movement score.

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

`transport` is optional. The development stand-in sends `development-stand-in`. This build does not send `transport: "freewili"`. A missing transport is not a physical FreeWili.

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

`sensor` — one accelerometer sample. Rate is `sampleRateHz` in `shared/config.json` (50). `movement` is omitted until phase 3. `g` is included only when a verified `AccelData.g` arrives with `x`, `y`, and `z`. The stand-in does not send `g`.

```json
{
  "type": "sensor",
  "role": "device",
  "timestamp": 1710000000100,
  "deviceId": "dev-stand-in",
  "transport": "development-stand-in",
  "accel": { "x": 0.25, "y": -0.5, "z": 1.5 }
}
```

`transport` on this message is optional. The server forwards the transport captured at `hello`, not a later claim that the coach is a FreeWili.

Units of `x`, `y`, `z`, and `g` are unknown. Do not treat the numbers as g or m/s². The stand-in's numbers are synthetic and are not `AccelData`.

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

`buzz` is still rejected with `error` / `code: "reserved"`. The server does not play a tone. The firmware recognizes `buzz` only so a stray frame cannot be mistaken for a sample, and it does not play a tone.

A `sensor` message that includes `movement` is rejected with `code: "invalid"`. Phase 3 owns that field.

### `movement` (later, on `sensor`)

```json
{ "movement": 0.72 }
```

### `buzz` (website → coach), phases 8–9

```json
{ "type": "buzz", "frequency": 350, "duration": 150 }
```

`frequency` is hertz and `duration` is milliseconds. Defaults live in `shared/config.json`: 350 Hz, 150 ms, amplitude 0.2, cooldown 2000 ms. Amplitude is the fwwasm recommended level for a later call, not a measured speaker setting. Phase 2 does not play sound.

Two verified tone APIs use different duration units. Do not mix them:

- OneWili `dev.io.audio.tone(frequency: float, duration_ms: float, amplitude: float)` — duration in milliseconds.
- WASM `playSoundFromFrequencyAndDuration(float frequency, float duration, float amplitude, audioWaveType wavetype)` — duration in seconds.

Neither documents a frequency range, so 300–400 Hz is expressible and not confirmed audible.

## Limits

Live coach messages are hello, heartbeat, disconnect, and sensor, plus the reconnect handshake. There is no slideshow, calibration, session store, intensity, or chart. Frames larger than 4 KiB are dropped. If the radio link is down, the firmware keeps at most 8 samples and drops the oldest. A sample is removed from that queue only after the link accepts it.
