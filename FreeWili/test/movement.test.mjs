import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../shared/config.mjs";
import { createMovementTracker, SMOOTH_WINDOW } from "../shared/movement.mjs";

const threshold = config.movementThreshold;

function settle(tracker, sample, count) {
  let score = 0;
  for (let i = 0; i < count; i += 1) score = tracker.sample(sample.x, sample.y, sample.z);
  return score;
}

test("a constant vector settles near 0% after the baseline catches up", () => {
  const tracker = createMovementTracker(threshold);
  const steady = settle(tracker, { x: 0, y: 0, z: 1 }, 30);
  assert.ok(steady < 0.02, steady);

  let caughtUp = 1;
  for (let i = 0; i < 400; i += 1) caughtUp = tracker.sample(0, 0, 2);
  assert.ok(caughtUp < 0.02, caughtUp);
});

test("a change at movementThreshold reaches about 100%", () => {
  const tracker = createMovementTracker(threshold);
  settle(tracker, { x: 0, y: 0, z: 1 }, 5);
  const score = settle(tracker, { x: threshold, y: 0, z: 1 }, SMOOTH_WINDOW);
  assert.ok(score >= 0.95 && score <= 1, score);

  const pinned = createMovementTracker(threshold);
  settle(pinned, { x: 0, y: 0, z: 1 }, 5);
  const above = settle(pinned, { x: threshold * 3, y: 0, z: 1 }, SMOOTH_WINDOW);
  assert.equal(above, 1);
});

test("a smaller change stays below 100%", () => {
  const tracker = createMovementTracker(threshold);
  settle(tracker, { x: 0, y: 0, z: 1 }, 5);
  const score = settle(tracker, { x: threshold / 2, y: 0, z: 1 }, SMOOTH_WINDOW);
  assert.ok(score > 0.4 && score < 0.75, score);
});

test("no calibration leaves a constant vector at 0 after the first sample", () => {
  const tracker = createMovementTracker(threshold);
  assert.equal(tracker.sample(1, 2, 3), 0);
  assert.equal(tracker.scored, false);
  assert.equal(tracker.sample(1, 2, 3), 0);
  assert.equal(tracker.scored, true);
  assert.equal(tracker.smoothedMagnitude, 0);
});

test("a resting baseline scores an identical sample at 0 and a threshold step near 100%", () => {
  const fresh = createMovementTracker(threshold);
  assert.equal(fresh.setBaseline({ x: 1, y: 2, z: 3 }), true);
  assert.equal(fresh.scored, false);
  assert.equal(fresh.sample(1, 2, 3), 0);
  assert.equal(fresh.scored, true);

  const stepped = createMovementTracker(threshold);
  stepped.setBaseline({ x: 1, y: 2, z: 3 });
  const score = settle(stepped, { x: 1 + threshold, y: 2, z: 3 }, SMOOTH_WINDOW);
  assert.ok(score >= 0.95 && score <= 1, score);
});

test("smoothed magnitude is the length before dividing, and the first sample is not scored", () => {
  const tracker = createMovementTracker(threshold);
  const first = tracker.sample(0, 0, 1);
  assert.equal(first, 0);
  assert.equal(tracker.scored, false);
  assert.equal(tracker.smoothedMagnitude, 0);
  const score = settle(tracker, { x: threshold / 2, y: 0, z: 1 }, SMOOTH_WINDOW);
  assert.equal(tracker.scored, true);
  assert.ok(tracker.smoothedMagnitude > 0);
  assert.ok(tracker.smoothedMagnitude < threshold);
  assert.equal(score, tracker.smoothedMagnitude / threshold);
});
