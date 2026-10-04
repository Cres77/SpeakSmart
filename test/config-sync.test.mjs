import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { config } from "../shared/config.mjs";

const header = readFileSync(new URL("../shared/coach_config.h", import.meta.url), "utf8");

function define(name) {
  const match = header.match(new RegExp(`#define ${name} ([0-9.]+)`));
  assert.ok(match, name);
  return Number(match[1]);
}

test("firmware config matches shared/config.json", () => {
  assert.equal(define("COACH_SAMPLE_RATE_HZ"), config.sampleRateHz);
  assert.equal(define("COACH_MOVEMENT_THRESHOLD"), config.movementThreshold);
  assert.equal(define("COACH_GESTURE_THRESHOLD"), config.gestureThreshold);
  assert.equal(define("COACH_STILLNESS_THRESHOLD"), config.stillnessThreshold);
  assert.equal(define("COACH_BUZZ_COOLDOWN_MS"), config.buzzCooldownMs);
  assert.equal(define("COACH_BUZZ_FREQUENCY_HZ"), config.buzzFrequencyHz);
  assert.equal(define("COACH_BUZZ_DURATION_MS"), config.buzzDurationMs);
  assert.equal(define("COACH_BUZZ_AMPLITUDE"), config.buzzAmplitude);
  assert.equal(define("COACH_HEARTBEAT_INTERVAL_MS"), config.heartbeatIntervalMs);
  assert.equal(define("COACH_HEARTBEAT_TIMEOUT_MS"), config.heartbeatTimeoutMs);
  assert.equal(define("COACH_RECONNECT_GRACE_MS"), config.reconnectGraceMs);
  assert.equal(define("COACH_SERVER_PORT"), config.serverPort);
});
