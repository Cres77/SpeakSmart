import assert from "node:assert/strict";
import test from "node:test";
import { BUZZ_STORAGE_KEY, buzzCommandError, createBuzzGuard, readBuzzSettings } from "../shared/buzz.mjs";
import { config } from "../shared/config.mjs";

test("buzz defaults match shared config and stay separate from decks and sessions", () => {
  assert.equal(BUZZ_STORAGE_KEY, "speaksmart.buzz");
  assert.notEqual(BUZZ_STORAGE_KEY, "speaksmart.decks");
  assert.notEqual(BUZZ_STORAGE_KEY, "speaksmart.sessions");
  const defaults = {
    frequency: config.buzzFrequencyHz,
    duration: config.buzzDurationMs,
    amplitude: config.buzzAmplitude,
  };
  assert.deepEqual(defaults, { frequency: 350, duration: 150, amplitude: 0.2 });
  assert.deepEqual(readBuzzSettings(null, defaults), defaults);
  assert.deepEqual(readBuzzSettings(JSON.stringify({ frequency: 440, duration: 200, amplitude: 0.3 }), defaults), {
    frequency: 440,
    duration: 200,
    amplitude: 0.3,
  });
  assert.equal(readBuzzSettings("{", defaults).frequency, 350);
});

test("a second buzz click during the pulse is ignored", () => {
  const guard = createBuzzGuard();
  assert.equal(guard.trySend(1_000, 150), true);
  assert.equal(guard.trySend(1_149, 150), false);
  assert.equal(guard.trySend(1_150, 150), true);
  assert.equal(buzzCommandError({ frequency: 350, duration: 501, amplitude: 0.2 }), "Duration must be greater than 0 ms and at most 500 ms.");
  assert.equal(buzzCommandError({ frequency: 350, duration: 150, amplitude: 0.2 }), null);
});