import assert from "node:assert/strict";
import test from "node:test";
import { CALIBRATION_STORAGE_KEY, MIN_CALIBRATION_SAMPLES, readCalibration, restingPose } from "../shared/calibration.mjs";

test("a window under 20 samples does not produce a pose", () => {
  assert.equal(CALIBRATION_STORAGE_KEY, "speaksmart.calibration");
  assert.notEqual(CALIBRATION_STORAGE_KEY, "speaksmart.decks");
  assert.notEqual(CALIBRATION_STORAGE_KEY, "speaksmart.sessions");
  assert.notEqual(CALIBRATION_STORAGE_KEY, "speaksmart.buzz");
  assert.equal(MIN_CALIBRATION_SAMPLES, 20);
  const samples = Array.from({ length: 19 }, () => ({ x: 1, y: 2, z: 3 }));
  assert.equal(restingPose(samples), null);
  assert.equal(readCalibration({ timestamp: 1, samples: 19, baseline: { x: 1, y: 2, z: 3 } }), null);
});

test("twenty samples produce the mean pose", () => {
  const samples = Array.from({ length: 20 }, (_, index) => ({ x: index, y: 2, z: 4 }));
  const pose = restingPose(samples);
  assert.equal(pose.samples, 20);
  assert.equal(pose.x, 9.5);
  assert.equal(pose.y, 2);
  assert.equal(pose.z, 4);
  const stored = readCalibration(JSON.stringify({
    timestamp: 50,
    samples: pose.samples,
    transport: "development-stand-in",
    baseline: pose,
  }));
  assert.equal(stored.transport, "development-stand-in");
  assert.deepEqual(stored.baseline, { x: 9.5, y: 2, z: 4 });
});
