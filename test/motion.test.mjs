import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../shared/config.mjs";
import { createMotionDetector } from "../shared/motion.mjs";
import { createMovementTracker } from "../shared/movement.mjs";

const stepMs = 1000 / config.sampleRateHz;

function feed(samples) {
  const tracker = createMovementTracker(config.movementThreshold);
  const detector = createMotionDetector(config);
  const gestures = [];
  const excessive = [];
  const trace = [];
  let last = detector.snapshot();
  for (const sample of samples) {
    const movement = tracker.sample(sample.x, sample.y, sample.z);
    if (!tracker.scored) continue;
    last = detector.push({
      timestamp: sample.timestamp,
      magnitude: tracker.smoothedMagnitude,
      movement,
    });
    trace.push({
      timestamp: sample.timestamp,
      magnitude: tracker.smoothedMagnitude,
      movement,
      state: last.state,
    });
    if (last.gestureEvent) gestures.push(last.gestureEvent);
    if (last.excessiveEvent) excessive.push(last.excessiveEvent);
  }
  return { last, gestures, excessive, trace };
}

function series(vector, count, start) {
  const samples = [];
  for (let i = 0; i < count; i += 1) {
    samples.push({ ...vector, timestamp: start + i * stepMs });
  }
  return samples;
}

function aboveSpan(trace, threshold) {
  const above = trace.filter((sample) => sample.magnitude >= threshold);
  if (above.length === 0) return null;
  return {
    start: above[0].timestamp,
    end: above[above.length - 1].timestamp,
    duration: above[above.length - 1].timestamp - above[0].timestamp,
  };
}

test("detection settings come from shared config", () => {
  assert.equal(config.gestureThreshold, 1.2);
  assert.equal(config.gestureMinDurationMs, 200);
  assert.equal(config.gestureCooldownMs, 400);
  assert.equal(config.stillnessThreshold, 0.08);
  assert.equal(config.excessiveLevel, 0.75);
  assert.equal(config.excessiveHoldMs, 1000);
  assert.equal(config.excessiveCooldownMs, 3000);
});

test("a short blip does not count as a gesture", () => {
  const start = 10_000;
  const result = feed([
    ...series({ x: 0, y: 0, z: 1 }, 8, start),
    ...series({ x: 4, y: 0, z: 1 }, 3, start + 8 * stepMs),
    ...series({ x: 0, y: 0, z: 1 }, 20, start + 11 * stepMs),
  ]);
  const span = aboveSpan(result.trace, config.gestureThreshold);
  assert.ok(span, "the blip never reached the gesture threshold");
  assert.ok(span.duration < config.gestureMinDurationMs, span.duration);
  assert.equal(result.gestures.length, 0);
  assert.equal(result.excessive.length, 0);
});

test("a sustained crossing of the gesture threshold counts once", () => {
  const start = 20_000;
  const result = feed([
    ...series({ x: 0, y: 0, z: 1 }, 8, start),
    ...series({ x: 4, y: 0, z: 1 }, 20, start + 8 * stepMs),
  ]);
  const span = aboveSpan(result.trace, config.gestureThreshold);
  assert.ok(span.duration >= config.gestureMinDurationMs, span.duration);
  assert.equal(result.gestures.length, 1);
  assert.equal(result.gestures[0].timestamp >= span.start, true);
  assert.ok(result.gestures[0].magnitude >= config.gestureThreshold);
  assert.equal(result.last.state, "Excessive");
  assert.equal(result.excessive.length, 0);
});

test("a second crossing inside the gesture cooldown does not count", () => {
  const tracker = createMovementTracker(config.movementThreshold);
  const detector = createMotionDetector(config);
  const gestures = [];
  const trace = [];
  let timestamp = 0;
  function push(x) {
    const movement = tracker.sample(x, 0, 1);
    const at = timestamp;
    timestamp += stepMs;
    if (!tracker.scored) return null;
    const result = detector.push({ timestamp: at, magnitude: tracker.smoothedMagnitude, movement });
    trace.push({ timestamp: at, magnitude: tracker.smoothedMagnitude });
    if (result.gestureEvent) gestures.push(result.gestureEvent);
    return result;
  }
  for (let i = 0; i < 8; i += 1) push(0);
  let guard = 0;
  while (gestures.length === 0 && guard < 300) {
    push(4);
    guard += 1;
  }
  assert.equal(gestures.length, 1);
  guard = 0;
  while (trace.at(-1).magnitude >= config.gestureThreshold && guard < 300) {
    push(4);
    guard += 1;
  }
  const ended = trace.at(-1).timestamp;
  assert.ok(trace.at(-1).magnitude < config.gestureThreshold);
  const cooldownEnd = ended + config.gestureCooldownMs;
  const secondStart = timestamp;
  while (timestamp < cooldownEnd) push(0);
  const second = trace.filter((sample) => {
    return sample.timestamp >= secondStart && sample.magnitude >= config.gestureThreshold;
  });
  assert.ok(second.length > 1);
  assert.ok(second.at(-1).timestamp - second[0].timestamp >= config.gestureMinDurationMs);
  assert.ok(second.at(-1).timestamp < cooldownEnd);
  assert.equal(gestures.filter((event) => event.timestamp < cooldownEnd).length, 1);
  guard = 0;
  while (gestures.length < 2 && guard < 300) {
    push(0);
    guard += 1;
  }
  assert.equal(gestures.length, 2);
  assert.ok(gestures[1].timestamp >= cooldownEnd);
});

test("a score at the excessive level for less than a second is not excessive", () => {
  const start = 40_000;
  const held = Math.floor(800 / stepMs);
  const result = feed([
    ...series({ x: 0, y: 0, z: 1 }, 8, start),
    ...series({ x: 1, y: 0, z: 1 }, held, start + 8 * stepMs),
  ]);
  const high = result.trace.filter((sample) => sample.movement >= config.excessiveLevel);
  assert.ok(high.length > 1);
  assert.ok(high[high.length - 1].timestamp - high[0].timestamp < config.excessiveHoldMs);
  assert.equal(result.excessive.length, 0);
  assert.equal(result.gestures.length, 0);
  assert.ok(Math.max(...result.trace.map((sample) => sample.magnitude)) < config.gestureThreshold);
});

test("holding the excessive level for the hold time records one event", () => {
  const start = 50_000;
  const held = Math.ceil((config.excessiveHoldMs + 400) / stepMs);
  const result = feed([
    ...series({ x: 0, y: 0, z: 1 }, 8, start),
    ...series({ x: 1, y: 0, z: 1 }, held, start + 8 * stepMs),
  ]);
  const high = result.trace.filter((sample) => sample.movement >= config.excessiveLevel);
  assert.ok(high[high.length - 1].timestamp - high[0].timestamp >= config.excessiveHoldMs);
  assert.equal(result.excessive.length, 1);
  assert.ok(result.excessive[0].movement >= config.excessiveLevel);
  const fired = result.trace.find((sample) => sample.timestamp === result.excessive[0].timestamp);
  assert.equal(fired.state, "Excessive");
  assert.equal(result.gestures.length, 0);
});

test("a constant vector after the baseline settles is Still and adds no gestures", () => {
  const start = 60_000;
  const result = feed(series({ x: 0, y: 0, z: 1 }, 40, start));
  assert.equal(result.trace.length, 39);
  assert.equal(result.last.state, "Still");
  assert.equal(result.gestures.length, 0);
  assert.equal(result.excessive.length, 0);
  assert.equal(result.last.stillnessPercent, 1);
  assert.ok(result.trace.every((sample) => sample.magnitude < config.stillnessThreshold));
});

test("Excessive wins when a sample is both gesturing and excessive", () => {
  const detector = createMotionDetector(config);
  const both = detector.push({ timestamp: 1000, magnitude: config.gestureThreshold, movement: config.excessiveLevel });
  assert.equal(both.state, "Excessive");
  detector.reset();
  const gesturing = detector.push({
    timestamp: 1000,
    magnitude: config.gestureThreshold,
    movement: config.excessiveLevel - 0.01,
  });
  assert.equal(gesturing.state, "Gesturing");
  const still = detector.push({ timestamp: 1020, magnitude: 0, movement: 0 });
  assert.equal(still.state, "Still");
  assert.equal(still.stillnessPercent, 0.5);
});
