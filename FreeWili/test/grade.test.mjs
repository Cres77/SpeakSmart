import assert from "node:assert/strict";
import test from "node:test";
import { gradeMovement } from "../shared/grade.mjs";

function summary(overrides) {
  return {
    durationMs: 60_000,
    gestures: 4,
    excessive: 0,
    averageMovement: 0.4,
    stillness: 0.4,
    ...overrides,
  };
}

test("a moderate spaced session is an A at 100", () => {
  const grade = gradeMovement(summary());
  assert.deepEqual(grade, { letter: "A", score: 100 });
  assert.deepEqual(gradeMovement(summary()), grade);
});

test("missing movement is not graded", () => {
  assert.equal(gradeMovement(summary({ averageMovement: null, stillness: null })), null);
  assert.equal(gradeMovement(summary({ averageMovement: 0.4, stillness: null })), null);
  assert.equal(gradeMovement({}), null);
});

test("average, gesture, excessive, and stillness penalties are mutually exclusive within each rule", () => {
  assert.deepEqual(gradeMovement(summary({ averageMovement: 0.1 })), { letter: "B", score: 80 });
  assert.deepEqual(gradeMovement(summary({ averageMovement: 0.7 })), { letter: "B", score: 85 });
  assert.deepEqual(gradeMovement(summary({ averageMovement: 0.9 })), { letter: "C", score: 70 });
  assert.deepEqual(gradeMovement(summary({ gestures: 0 })), { letter: "B", score: 85 });
  assert.deepEqual(gradeMovement(summary({ gestures: 13 })), { letter: "A", score: 90 });
  assert.deepEqual(gradeMovement(summary({ gestures: 21 })), { letter: "C", score: 75 });
  assert.deepEqual(gradeMovement(summary({ gestures: 5, durationMs: 0 })), { letter: "C", score: 75 });
  assert.deepEqual(gradeMovement(summary({ excessive: 1 })), { letter: "A", score: 90 });
  assert.deepEqual(gradeMovement(summary({ excessive: 2 })), { letter: "B", score: 80 });
  assert.deepEqual(gradeMovement(summary({ excessive: 3 })), { letter: "D", score: 65 });
  assert.deepEqual(gradeMovement(summary({ stillness: 0.15 })), { letter: "A", score: 90 });
  assert.deepEqual(gradeMovement(summary({ stillness: 0.05 })), { letter: "C", score: 75 });
  assert.deepEqual(gradeMovement(summary({ stillness: 0.8 })), { letter: "A", score: 90 });
  assert.deepEqual(gradeMovement(summary({ stillness: 0.95 })), { letter: "C", score: 75 });
  assert.deepEqual(gradeMovement(summary({ stillness: 0.2 })), { letter: "A", score: 100 });
  assert.deepEqual(gradeMovement(summary({ stillness: 0.7 })), { letter: "A", score: 100 });
});

test("stacked penalties clamp at 0 and land on D and F", () => {
  assert.deepEqual(
    gradeMovement(summary({ averageMovement: 0.1, excessive: 2 })),
    { letter: "D", score: 60 },
  );
  assert.deepEqual(
    gradeMovement(summary({
      averageMovement: 0.9,
      gestures: 0,
      excessive: 3,
      stillness: 0,
    })),
    { letter: "F", score: 0 },
  );
});
