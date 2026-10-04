# SpeakSmart coach protocol

JSON text frames on a WebSocket. One JSON object is one message. Timestamps are integer milliseconds. The coach sends one raw accelerometer sample per `sensor` message. The server computes movement intensity and the smoothed magnitude and adds them when it forwards that sample to the browser.

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

`transport` is optional. The development stand-in sends `development-stand-in`. The USB bridge sends `freewili` only after `FreeWili.open()` has opened that board, and `deviceId` is then that board's serial. A missing transport is not a physical FreeWili. The stand-in never sends `freewili`.

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

`sensor` — one accelerometer sample. Rate is `sampleRateHz` in `shared/config.json` (50). The coach sends raw `x`, `y`, and `z` only. It does not send `movement`. `g` is included only when a verified `AccelData.g` arrives with `x`, `y`, and `z`. The stand-in does not send `g` and does not send a movement score.

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

Units of `x`, `y`, `z`, and `g` are unknown. Do not treat the numbers as g or m/s². Intensity uses those same unknown units. The stand-in's numbers are synthetic and are not `AccelData`.

A coach `sensor` that includes `movement` is rejected with `code: "invalid"`. That number is not forwarded and is not used as the score.

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
  "lastSeen": 1710000002000,
  "session": 1
}
```

`status` is `connected`, `connecting`, or `disconnected`. During a reconnect the status stays `connecting` until the next coach `hello` or until `reconnectGraceMs` (5000) expires.

`session` starts at 0 and increases by one on each coach `hello`. Heartbeats keep the same number. The page uses it to tell a new hello from a heartbeat.

`sensor` — the coach sample, plus the server's intensity and smoothed magnitude. `movement` is a number from 0 to 1. 1 means 100%. `magnitude` is the smoothed baseline-removed length in the sample's unknown units, before dividing by `movementThreshold`. `scored` is false on the sample that only sets the baseline; that sample is not a stillness, gesture, or excessive-movement sample. The browser does not calculate intensity or magnitude.

```json
{
  "type": "sensor",
  "role": "device",
  "timestamp": 1710000000100,
  "deviceId": "dev-stand-in",
  "transport": "development-stand-in",
  "accel": { "x": 0.25, "y": -0.5, "z": 1.5 },
  "movement": 0.42,
  "magnitude": 0.147,
  "scored": true
}
```

`transport` is the value from the coach `hello`. `g` is copied onto `accel` only when the coach sent a finite `g`. A coach-supplied `magnitude` is rejected the same way as a coach-supplied `movement`.

Intensity is one formula, in `shared/movement.mjs`, applied by the server:

1. Keep a slow baseline, an exponential moving average of the `x`, `y`, `z` vector. The first sample sets the baseline and scores 0, so a constant offset such as gravity is not movement. Each later sample is compared with the baseline, and the baseline then moves 2% of the way toward that sample.
2. Take the straight-line length of the sample minus the baseline. That length stays in the sample's unknown units.
3. Smooth that length with a short moving average of the last 5 samples.
4. Divide by `movementThreshold` from `shared/config.json` (0.35). At the threshold the score is 1, which the page shows as 100%. Above the threshold the score stays at 1. Below it the score is the fraction of the threshold. Negative results are clamped to 0.

A new coach `hello` starts a new baseline. Disconnecting clears it. The website can send `calibration` with a resting pose. The server sets the tracker baseline to that vector and does not treat the message as a sample. The next real sample is scored against it, then the baseline still moves 2% of the way toward each sample. A later hello clears the tracker; the page sends the stored pose again. Clearing calibration restores the first-sample baseline.

```json
{ "type": "calibration", "role": "browser", "timestamp": 1710000006000, "baseline": { "x": 0.1, "y": -0.2, "z": 1.0 } }
```

The page plots `movement` as 0–100% against the sample timestamp. It does not plot X, Y, or Z. Chart.js draws the line. The trace is not a server message.

Gesture, stillness, and excessive movement use the same forwarded sample. They read `shared/config.json`. A gesture candidate begins when `magnitude` reaches `gestureThreshold` (1.2) and counts once if it stays there for `gestureMinDurationMs` (200). After that gesture ends, new candidates wait `gestureCooldownMs` (400). A sample is still when `magnitude` is below `stillnessThreshold` (0.08). Excessive movement begins when `movement` stays at or above `excessiveLevel` (0.75) for `excessiveHoldMs` (1000), then waits `excessiveCooldownMs` (3000) before another episode can count. The page can send one manual buzz. It does not play a tone or write a coaching sentence.

Downsample and window, in `shared/intensity-series.mjs`:

- Samples stay at `sampleRateHz` for the percent and the meter.
- The chart keeps one point per 250 ms bucket, about 4 points per second. The point is that bucket's latest intensity and that sample's timestamp.
- Points older than 60 seconds before the newest timestamp are dropped. The series also caps at 241 points.
- A new coach `hello` (`session` changes) clears the line. A `disconnected` link clears it too, so a stale trace is not left up. A reconnect stays `connecting` until the next hello, and that hello clears the line. Before the first sample the chart is blank, with Time and Intensity axes and no error.

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

## Implemented — manual buzz

`buzz` is a manual command. The website sends it, the server forwards it to the coach, and the coach replies. Nothing plays a tone. There is no automatic threshold buzz.

### `buzz` (website → server → coach)

```json
{ "type": "buzz", "frequency": 350, "duration": 150, "amplitude": 0.2, "timestamp": 1710000009000 }
```

`frequency` is hertz, from 50 to 2000. `duration` is milliseconds, greater than 0 and at most 500. `amplitude` is the requested level. Defaults in `shared/config.json` are 350 Hz, 150 ms, and 0.2. A non-positive duration, a duration above 500 ms, or a frequency outside 50–2000 Hz is rejected with `error` / `code: "invalid"` and is not forwarded.

The website role is `browser`. A second click while that pulse’s duration has not elapsed is ignored on the page, so the command cannot become a continuous tone.

### `buzz` acknowledgement (coach → server → website)

```json
{ "type": "buzz", "role": "device", "frequency": 350, "duration": 150, "amplitude": 0.2, "played": false, "timestamp": 1710000009100 }
```

The acknowledgement repeats the requested frequency, duration, and amplitude. `played` is false. The development stand-in does not set `played` to true. The server forwards `played: false`. An optional `note` string is forwarded when the coach sends one. The USB bridge calls `FreeWili.play_audio_tone(frequency_hz, duration_sec, amplitude, processor)` on Display, and on Main when Display returns a response-frame timeout. The v54 result is unreliable, so the ack still sends `played: false`, with `note` set to `v54 firmware: Response frame always returns failure`. The page asks you to listen for the tone. The host firmware function `buzz` does not call a speaker and does not return success.

Two verified tone APIs use different duration units. Do not mix them, and do not call them from the host build:

- OneWili `dev.io.audio.tone(frequency, duration_ms, amplitude)` — duration in milliseconds.
- WASM `playSoundFromFrequencyAndDuration(frequency, duration_seconds, amplitude, wavetype)` — duration in seconds.

No separate buzzer API exists. When automatic movement feedback is on, the page sends this same buzz command once for an excessive hold, then waits `buzzCooldownMs`. The command is not repeated by a timer. `played` stays false.

## Limits

Live coach messages are hello, heartbeat, disconnect, and sensor, plus the reconnect handshake. The server adds intensity on the sample it forwards to the browser. The page draws that intensity. Slideshow decks are kept in the browser under localStorage key `speaksmart.decks`. Practice sessions are a separate key, `speaksmart.sessions`. They are not coach messages. A session stores the start time, duration, downsampled samples, and slide changes. During a practice, `gestures` and `excessive` store only the events those rules recorded in that practice: a timestamp, and the magnitude or movement score that met the rule. If a buzz command is sent during that practice, `buzzes` stores `{ timestamp, frequency, duration, amplitude, reason, played: false }`. `reason` is `manual` or `excessive`. There is no calibration or coaching summary. The live label is Still when the smoothed magnitude is below `stillnessThreshold`, Excessive only after the score has stayed at or above `excessiveLevel` for `excessiveHoldMs` and only while it remains there, Gesturing when the magnitude is at or above `gestureThreshold` and the label is not Excessive, and Moving otherwise. Frames larger than 4 KiB are dropped. If the radio link is down, the firmware keeps at most 8 samples and drops the oldest. A sample is removed from that queue only after the link accepts it. Sampling still does no network I/O. The radio poll still sends at most one queued sample on a non-blocking link.
