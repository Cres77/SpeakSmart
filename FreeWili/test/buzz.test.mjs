import assert from "node:assert/strict";
import test from "node:test";
import { BUZZ_STORAGE_KEY, buzzCommandError, createAutomaticFeedback, createBuzzGuard, createSlideCues, readBuzzSettings } from "../shared/buzz.mjs";
import { config } from "../shared/config.mjs";
import { createMotionDetector } from "../shared/motion.mjs";
import { inspectClientMessage } from "../shared/protocol.mjs";

const buzzDefaults = {
  frequency: config.buzzFrequencyHz,
  duration: config.buzzDurationMs,
  amplitude: config.buzzAmplitude,
  automatic: false,
  cooldown: config.buzzCooldownMs,
  cueBuzz: false,
};

function excessiveDetector() {
  return createMotionDetector({
    gestureThreshold: 1.2,
    gestureMinDurationMs: 200,
    gestureCooldownMs: 400,
    stillnessThreshold: 0.08,
    excessiveLevel: config.excessiveLevel,
    excessiveHoldMs: config.excessiveHoldMs,
    excessiveCooldownMs: 200,
  });
}

function hold(detector, feedback, settings, guard, stamps, movement) {
  const sent = [];
  let counted = 0;
  let last = null;
  for (const timestamp of stamps) {
    last = detector.push({ timestamp, magnitude: 0.2, movement });
    if (last.excessiveEvent) counted += 1;
    const command = feedback.decide(last.excessiveEvent, settings, timestamp, guard);
    if (command) sent.push(command);
  }
  return { sent, counted, last };
}

test("buzz defaults match shared config and stay separate from decks and sessions", () => {
  assert.equal(BUZZ_STORAGE_KEY, "speaksmart.buzz");
  assert.notEqual(BUZZ_STORAGE_KEY, "speaksmart.decks");
  assert.notEqual(BUZZ_STORAGE_KEY, "speaksmart.sessions");
  assert.equal(config.buzzCooldownMs, 3000);
  assert.equal(Object.hasOwn(config, "buzzCooldownMs"), true);
  assert.equal(Object.hasOwn(config, "excessiveCooldownMs"), true);
  assert.deepEqual(
    { frequency: buzzDefaults.frequency, duration: buzzDefaults.duration, amplitude: buzzDefaults.amplitude },
    { frequency: 350, duration: 150, amplitude: 0.2 },
  );
  assert.deepEqual(readBuzzSettings(null, buzzDefaults), buzzDefaults);
  assert.deepEqual(readBuzzSettings(JSON.stringify({ frequency: 440, duration: 200, amplitude: 0.3 }), buzzDefaults), {
    frequency: 440,
    duration: 200,
    amplitude: 0.3,
    automatic: false,
    cooldown: 3000,
    cueBuzz: false,
  });
  assert.equal(readBuzzSettings(JSON.stringify({ cueBuzz: true }), buzzDefaults).cueBuzz, true);
  assert.equal(readBuzzSettings(JSON.stringify({ cueBuzz: "true" }), buzzDefaults).cueBuzz, false);
  assert.equal(readBuzzSettings(JSON.stringify({ automatic: true, cooldown: 8000 }), buzzDefaults).automatic, true);
  assert.equal(readBuzzSettings(JSON.stringify({ automatic: "true" }), buzzDefaults).automatic, false);
  assert.equal(readBuzzSettings("{", buzzDefaults).frequency, 350);
});

test("a second buzz click during the pulse is ignored", () => {
  const guard = createBuzzGuard();
  assert.equal(guard.trySend(1_000, 150), true);
  assert.equal(guard.trySend(1_149, 150), false);
  assert.equal(guard.trySend(1_150, 150), true);
  assert.equal(buzzCommandError({ frequency: 350, duration: 501, amplitude: 0.2 }), "Duration must be greater than 0 ms and at most 500 ms.");
  assert.equal(buzzCommandError({ frequency: 350, duration: 150, amplitude: 0.2 }), null);
});

test("automatic movement feedback sends nothing while it is off", () => {
  const settings = { ...buzzDefaults, frequency: 440, duration: 200, amplitude: 0.3, automatic: false };
  const { sent, counted } = hold(
    excessiveDetector(),
    createAutomaticFeedback(),
    settings,
    createBuzzGuard(),
    [0, 1000],
    0.8,
  );
  assert.equal(counted, 1);
  assert.deepEqual(sent, []);
});

test("automatic movement feedback sends one buzz when the hold completes and ignores the next event inside the cooldown", () => {
  const settings = { ...buzzDefaults, frequency: 440, duration: 200, amplitude: 0.3, automatic: true, cooldown: 3000 };
  const feedback = createAutomaticFeedback();
  const guard = createBuzzGuard();
  const detector = excessiveDetector();
  const first = hold(detector, feedback, settings, guard, [0, 1000], 0.8);
  assert.equal(first.counted, 1);
  assert.equal(first.sent.length, 1);
  assert.deepEqual(first.sent[0], {
    frequency: 440,
    duration: 200,
    amplitude: 0.3,
    timestamp: 1000,
    reason: "excessive",
    played: false,
  });
  const dropped = hold(detector, feedback, settings, guard, [1100], 0.1);
  assert.equal(dropped.sent.length, 0);
  const second = hold(detector, feedback, settings, guard, [1300, 2300], 0.8);
  assert.equal(second.counted, 1);
  assert.deepEqual(second.sent, []);
  const ack = inspectClientMessage({
    type: "buzz",
    role: "device",
    frequency: first.sent[0].frequency,
    duration: first.sent[0].duration,
    amplitude: first.sent[0].amplitude,
    played: false,
    timestamp: first.sent[0].timestamp,
  });
  assert.equal(ack.ok, true);
  assert.equal(first.sent[0].played, false);
  const accepted = inspectClientMessage({
    type: "buzz",
    role: "device",
    frequency: 440,
    duration: 200,
    amplitude: 0.3,
    played: true,
    note: "Listen for the tone.",
    timestamp: 1000,
  });
  assert.equal(accepted.ok, true);
});

test("a pulse still running blocks an automatic buzz without starting its cooldown", () => {
  const guard = createBuzzGuard();
  assert.equal(guard.trySend(1000, 150), true);
  const feedback = createAutomaticFeedback();
  const settings = { ...buzzDefaults, automatic: true, cooldown: 3000 };
  const event = { timestamp: 1100, movement: 0.8 };
  assert.equal(feedback.decide(event, settings, 1100, guard), null);
  const sent = feedback.decide(event, settings, 1200, guard);
  assert.equal(sent.played, false);
  assert.equal(sent.reason, "excessive");
  assert.equal(sent.frequency, 350);
});

test("a slide cue sends one buzz on entry only when the checkbox is on", () => {
  const settingsOn = { ...buzzDefaults, frequency: 440, duration: 200, amplitude: 0.3, cueBuzz: true };
  const settingsOff = { ...settingsOn, cueBuzz: false };
  const empty = { id: "quiet", title: "Quiet", cue: "" };
  const slide = { id: "opening", title: "Opening", cue: "  Slow down hand movements  " };
  const guard = createBuzzGuard();
  const cues = createSlideCues();

  assert.equal(cues.enter(empty, settingsOn, 1000, guard), null);
  cues.reset();
  assert.equal(cues.enter(slide, settingsOff, 1000, guard), null);

  cues.reset();
  const sent = cues.enter(slide, settingsOn, 1000, guard);
  assert.deepEqual(sent, {
    frequency: 440,
    duration: 200,
    amplitude: 0.3,
    timestamp: 1000,
    reason: "cue",
    slideTitle: "Opening",
    cue: "Slow down hand movements",
    played: false,
  });
  assert.equal(cues.enter(slide, settingsOn, 1100, guard), null);
  assert.equal(sent.played, false);

  const away = cues.enter({ id: "next", title: "Next", cue: "" }, settingsOn, 2000, guard);
  assert.equal(away, null);
  const again = cues.enter(slide, settingsOn, 2000, guard);
  assert.equal(again.reason, "cue");
  assert.equal(again.played, false);
  assert.equal(again.cue, "Slow down hand movements");

  const ack = inspectClientMessage({
    type: "buzz",
    role: "device",
    frequency: sent.frequency,
    duration: sent.duration,
    amplitude: sent.amplitude,
    played: false,
    timestamp: sent.timestamp,
  });
  assert.equal(ack.ok, true);
});

test("a blocked cue pulse is not retried while that slide stays up", () => {
  const guard = createBuzzGuard();
  assert.equal(guard.trySend(1000, 150), true);
  const cues = createSlideCues();
  const slide = { id: "opening", title: "Opening", cue: "Slow down hand movements" };
  const settings = { ...buzzDefaults, cueBuzz: true };
  assert.equal(cues.enter(slide, settings, 1100, guard), null);
  assert.equal(cues.enter(slide, settings, 2000, guard), null);
});