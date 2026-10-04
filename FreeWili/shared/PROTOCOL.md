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

`transport` is optional. The development stand-in sends `development-stand-in`. The USB bridge sends `freewili` only after `OneWili(port).open()` has opened the Main CDC port `0x093C:0x2054`, and `deviceId` is then that board's serial. A missing transport is not a physical FreeWili. The stand-in never sends `freewili`.

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

`sensor` — one accelerometer sample. Rate is `sampleRateHz` in `shared/config.json` (50). The coach sends raw `x`, `y`, and `z` only. It does not send `movement`. The USB bridge does not send `g`. The stand-in does not send `g` and does not send a movement score.

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

On the USB bridge, `x`, `y`, and `z` are g. OneWili `*motion` fields `ax_mg`, `ay_mg`, and `az_mg` are milli-g, and the bridge divides each by 1000 before the sensor frame. A 350 mg axis is `0.35`. Gyro fields are not sent. The stand-in's `x`, `y`, and `z` stay unitless, and the page labels those samples as the development stand-in.

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

`sensor` — the coach sample, plus the server's intensity and smoothed magnitude. `movement` is a number from 0 to 1. 1 means 100%. `magnitude` is the smoothed baseline-removed length in the sample's units, before dividing by `movementThreshold`. For the USB bridge those units are g. The stand-in's magnitude stays in the stand-in's unitless numbers. `scored` is false on the sample that only sets the baseline; that sample is not a stillness, gesture, or excessive-movement sample. The browser does not calculate intensity or magnitude.

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
2. Take the straight-line length of the sample minus the baseline. That length stays in the sample's units. For the USB bridge those units are g. For the stand-in they stay unitless.
3. Smooth that length with a short moving average of the last 5 samples.
4. Divide by `movementThreshold` from `shared/config.json` (1.05). At the threshold the score is 1, which the page shows as 100%. Above the threshold the score stays at 1. Below it the score is the fraction of the threshold. Negative results are clamped to 0.

A new coach `hello` starts a new baseline. Disconnecting clears it. The website can send `calibration` with a resting pose. The server sets the tracker baseline to that vector and does not treat the message as a sample. The next real sample is scored against it, then the baseline still moves 2% of the way toward each sample. A later hello clears the tracker; the page sends the stored pose again. Clearing calibration restores the first-sample baseline.

```json
{ "type": "calibration", "role": "browser", "timestamp": 1710000006000, "baseline": { "x": 0.1, "y": -0.2, "z": 1.0 } }
```

```json
{ "type": "calibration", "role": "browser", "timestamp": 1710000006000, "clear": true }
```

The SpeakSmart website plots saved `movement` as 0–100% for that recording. It does not plot X, Y, or Z. The trace is not a server message. At record start the website sends `calibration` with `"clear": true`, which drops the baseline so the next sample sets it, then one buzz.

Gesture, stillness, and excessive movement use the same forwarded sample. They read `shared/config.json`. In g, the defaults are one third of the earlier sensitivity: `movementThreshold` is 1.05 g and `stillnessThreshold` is 0.24 g. `gestureThreshold` is 1.5 g. A gesture candidate begins when `magnitude` reaches `gestureThreshold` (1.5) and counts once if it stays there for `gestureMinDurationMs` (200). After that gesture ends, new candidates wait `gestureCooldownMs` (400). A sample is still when `magnitude` is below `stillnessThreshold` (0.24). Excessive movement begins when `movement` stays at or above `excessiveLevel` (0.75) for `excessiveHoldMs` (1000), then waits `excessiveCooldownMs` (3000) before another episode can count. The page can send one manual buzz. It does not play a tone or write a coaching sentence.

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

The acknowledgement repeats the requested frequency, duration, and amplitude. `played` is a boolean. The USB bridge sets it true only when `dev.io.audio.tone(frequency, duration_ms, amplitude)` returns Ok, and false when that call returns Err or does not return in time. `duration_ms` is the protocol duration in milliseconds. The note asks the user to listen. A buzz while motion is streaming clears OneWili's event queue, so a few samples can be dropped. The development stand-in sends `played: false` because it does not call OneWili. The server forwards the boolean it received. The host firmware function `buzz` does not call a speaker and does not return success.

Two verified tone APIs use different duration units. Do not mix them, and do not call them from the host build:

- OneWili `dev.io.audio.tone(frequency, duration_ms, amplitude)` — duration in milliseconds.
- WASM `playSoundFromFrequencyAndDuration(frequency, duration_seconds, amplitude, wavetype)` — duration in seconds.

No separate buzzer API exists. The website sends this command once when a recording starts, at the defaults above, with `reason` `record-start` on the saved event. `createBuzzGuard` ignores another send until that duration has elapsed. `played` on the saved event is the boolean from the coach acknowledgement.

## Limits

Live coach messages are hello, heartbeat, disconnect, and sensor, plus the reconnect handshake. The server adds intensity on the sample it forwards to the browser. The website keeps samples only while a recording is running, and only when `transport` is `freewili`. It stores the summary in this browser under the IndexedDB key `freewili-motion:<sessionId>`: duration, average intensity, gestures, excessive episodes, stillness percent, a 250 ms intensity series for the whole recording, and buzz events. `shared/grade.mjs` turns that summary into a letter A–F and a 0–100 score. A session with no scored samples is not graded. Frames larger than 4 KiB are dropped.
