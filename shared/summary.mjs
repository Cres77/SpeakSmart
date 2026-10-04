/* Session summary from a saved practice. Pure: the same session always
 * returns the same numbers and lines. It does not read live sensors.
 *
 * Inputs are the stored session only: durationMs, samples (movement is the
 * 0–1 relative score), gestures, excessive, and buzzes.
 *
 * Derived numbers:
 * - Duration comes from durationMs, shown as m:ss.
 * - Gestures is gestures.length.
 * - Excessive episodes is excessive.length.
 * - Average movement is the mean of sample movement values. Low when the
 *   mean is below 0.20, Medium when it is below 0.55, High otherwise.
 *   These bands are on the relative score, not g or m/s².
 * - Stillness is the share of samples whose movement is below
 *   0.08 / movementThreshold (0.08 / 0.35). That is the stored form of
 *   “smoothed magnitude below 0.08”. If there are no movement samples,
 *   stillness is absent, not 0%.
 * - Consistency is Steady when there are at least 8 samples, the mean is
 *   between 0.15 and 0.70 inclusive, and the population standard deviation
 *   is at most 0.25. Otherwise it is Uneven. A near-zero session is Uneven,
 *   not Steady.
 *
 * Feedback lines follow the rules below, in this order, and only when the
 * rule matches. No other sentences are added.
 */

import { config } from "./config.mjs";

const STILLNESS_MOVEMENT = config.stillnessThreshold / config.movementThreshold;
const LOW_AVERAGE = 0.2;
const MEDIUM_AVERAGE = 0.55;
const STEADY_MIN_SAMPLES = 8;
const STEADY_MEAN_MIN = 0.15;
const STEADY_MEAN_MAX = 0.7;
const STEADY_MAX_DEVIATION = 0.25;
const MIN_SAMPLES = 4;
const MIN_DURATION_MS = 10_000;
const SPACED_PER_MINUTE = 12;
const CLOSE_PER_MINUTE = 20;

function clock(durationMs) {
  const total = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function percent(share) {
  return Math.round(share * 100);
}

export function summarizeSession(session) {
  const samples = Array.isArray(session?.samples) ? session.samples : [];
  const gestures = Array.isArray(session?.gestures) ? session.gestures : [];
  const excessive = Array.isArray(session?.excessive) ? session.excessive : [];
  const buzzes = Array.isArray(session?.buzzes) ? session.buzzes : [];
  const durationMs = Number.isFinite(session?.durationMs) ? Math.max(0, session.durationMs) : 0;
  const movements = [];
  for (const sample of samples) {
    if (sample && Number.isFinite(sample.movement)) movements.push(sample.movement);
  }

  let averageMovement = null;
  let averageBand = null;
  if (movements.length > 0) {
    let sum = 0;
    for (const movement of movements) sum += movement;
    averageMovement = sum / movements.length;
    if (averageMovement < LOW_AVERAGE) averageBand = "Low";
    else if (averageMovement < MEDIUM_AVERAGE) averageBand = "Medium";
    else averageBand = "High";
  }

  let stillness = null;
  if (movements.length > 0) {
    let still = 0;
    for (const movement of movements) {
      if (movement < STILLNESS_MOVEMENT) still += 1;
    }
    stillness = still / movements.length;
  }

  let deviation = null;
  if (averageMovement != null) {
    let squareSum = 0;
    for (const movement of movements) {
      const delta = movement - averageMovement;
      squareSum += delta * delta;
    }
    deviation = Math.sqrt(squareSum / movements.length);
  }
  const steady = samples.length >= STEADY_MIN_SAMPLES
    && averageMovement != null
    && averageMovement >= STEADY_MEAN_MIN
    && averageMovement <= STEADY_MEAN_MAX
    && deviation != null
    && deviation <= STEADY_MAX_DEVIATION;

  const gestureCount = gestures.length;
  const excessiveCount = excessive.length;
  let automaticBuzzes = 0;
  for (const buzz of buzzes) {
    if (buzz && buzz.reason === "excessive") automaticBuzzes += 1;
  }

  const lines = [];
  if (samples.length < MIN_SAMPLES || durationMs < MIN_DURATION_MS) {
    lines.push("Not enough recorded movement to judge.");
  } else {
    const perMinute = gestureCount / (durationMs / 60_000);
    if (gestureCount >= 1 && perMinute <= SPACED_PER_MINUTE) {
      lines.push(`Gestures were spaced through the session (${gestureCount} in ${clock(durationMs)}).`);
    }
    if (perMinute > CLOSE_PER_MINUTE) {
      lines.push(`Gestures came close together (${gestureCount} in ${clock(durationMs)}). Consider leaving more time between them.`);
    }
    if (excessiveCount >= 1) {
      lines.push(`Intensity stayed at or above 75% for ${excessiveCount} episodes.`);
    }
    if (stillness != null && stillness >= 0.7) {
      lines.push(`The hand was still for ${percent(stillness)}% of the recorded samples.`);
    }
    if (stillness != null && stillness < 0.15 && averageBand !== "Low") {
      lines.push(`Movement continued through ${percent(1 - stillness)}% of the recorded samples.`);
    }
    if (automaticBuzzes >= 1) {
      lines.push(`Automatic feedback was requested ${automaticBuzzes} times. No tone was played.`);
    }
  }

  return {
    durationMs,
    durationLabel: clock(durationMs),
    gestures: gestureCount,
    excessive: excessiveCount,
    averageMovement,
    averageBand,
    stillness,
    consistency: steady ? "Steady" : "Uneven",
    lines,
  };
}
