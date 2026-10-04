import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../shared/config.mjs";
import { summarizeSession } from "../shared/summary.mjs";

function session(overrides) {
  return {
    durationMs: 60_000,
    samples: [],
    gestures: [],
    excessive: [],
    buzzes: [],
    ...overrides,
  };
}

test("too few samples produces only the insufficient line", () => {
  const stored = session({
    durationMs: 60_000,
    samples: [0.9, 0.9, 0.9].map((movement) => ({ movement })),
    gestures: [{ timestamp: 1, magnitude: 2 }],
    excessive: [{ movement: 0.8 }, { movement: 0.8 }],
    buzzes: [{ reason: "excessive", played: false }],
  });
  const summary = summarizeSession(stored);
  assert.deepEqual(summary.lines, ["Not enough recorded movement to judge."]);
  assert.deepEqual(summarizeSession(stored).lines, summary.lines);
  assert.deepEqual(summarizeSession(stored), summary);
});

test("a spaced-gesture session produces the spaced line and not the close-together line", () => {
  const stored = session({
    samples: Array.from({ length: 10 }, () => ({ movement: 0.4 })),
    gestures: [1, 2, 3, 4].map((timestamp) => ({ timestamp, magnitude: 1.2 })),
  });
  const lines = summarizeSession(stored).lines;
  assert.ok(lines.includes("Gestures were spaced through the session (4 in 1:00)."));
  assert.equal(lines.some((line) => line.includes("close together")), false);
  assert.deepEqual(summarizeSession(stored).lines, lines);
});

test("an excessive count of 2 produces the 75% line with 2", () => {
  const stored = session({
    samples: Array.from({ length: 10 }, () => ({ movement: 0.4 })),
    excessive: [{ movement: 0.8 }, { movement: 0.9 }],
  });
  const lines = summarizeSession(stored).lines;
  assert.ok(lines.includes("Intensity stayed at or above 75% for 2 episodes."));
  assert.deepEqual(summarizeSession(stored).lines, lines);
});

test("a flat zero session is Uneven and does not get the movement continued line", () => {
  assert.equal(config.stillnessThreshold / config.movementThreshold, 0.08 / 0.35);
  const stored = session({
    samples: Array.from({ length: 10 }, () => ({ movement: 0 })),
  });
  const summary = summarizeSession(stored);
  assert.equal(summary.consistency, "Uneven");
  assert.equal(summary.averageBand, "Low");
  assert.equal(summary.stillness, 1);
  assert.equal(summary.lines.some((line) => line.includes("Movement continued")), false);
  assert.ok(summary.lines.includes("The hand was still for 100% of the recorded samples."));
  assert.deepEqual(summarizeSession(stored), summary);
});

test("stillness is absent when a session has no samples", () => {
  const summary = summarizeSession(session({ durationMs: 5_000 }));
  assert.equal(summary.stillness, null);
  assert.equal(summary.averageMovement, null);
  assert.deepEqual(summary.lines, ["Not enough recorded movement to judge."]);
});
