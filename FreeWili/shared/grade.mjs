/* Deterministic hand-movement grade from summarizeSession output.
 * The same summary always returns the same letter and score.
 * Returns null when there is no scored movement (average or stillness missing).
 *
 * Start at 100. Each rule applies at most one penalty. Clamp the result to 0–100.
 *
 * Average movement is the 0–1 relative intensity:
 * - 0.15 through 0.55: no penalty. This is the moderate band.
 * - below 0.15: −20
 * - above 0.55 and below 0.85: −15
 * - 0.85 or above: −30
 *
 * Gestures per minute is gestures / (durationMs / 60000):
 * - at least one and at most 12 per minute: no penalty. These are spaced.
 * - none: −15
 * - more than 12 and at most 20 per minute: −10
 * - more than 20 per minute: −25
 * A positive count with a duration of 0 counts as more than 20 per minute.
 *
 * Excessive episodes:
 * - 0: no penalty
 * - 1: −10
 * - 2: −20
 * - 3 or more: −35
 *
 * Stillness is a 0–1 share of scored samples:
 * - 0.20 through 0.70: no penalty
 * - below 0.10 or above 0.90: −25
 * - from 0.10 up to 0.20, or above 0.70 through 0.90: −10
 *
 * Letters from the clamped score: A at 90 or above, B at 80, C at 70, D at 60, otherwise F.
 */

export function gradeMovement(summary) {
  const average = summary?.averageMovement;
  const stillness = summary?.stillness;
  if (!Number.isFinite(average) || !Number.isFinite(stillness)) return null;

  const durationMs = Number.isFinite(summary.durationMs) ? Math.max(0, summary.durationMs) : 0;
  const gestures = Number.isFinite(summary.gestures) ? Math.max(0, summary.gestures) : 0;
  const excessive = Number.isFinite(summary.excessive) ? Math.max(0, summary.excessive) : 0;

  let score = 100;
  score -= averagePenalty(average);
  score -= gesturePenalty(gestures, durationMs);
  score -= excessivePenalty(excessive);
  score -= stillnessPenalty(stillness);
  score = Math.max(0, Math.min(100, score));

  return { letter: letterFor(score), score };
}

function averagePenalty(average) {
  if (average >= 0.15 && average <= 0.55) return 0;
  if (average < 0.15) return 20;
  if (average < 0.85) return 15;
  return 30;
}

function gesturePenalty(gestures, durationMs) {
  if (gestures <= 0) return 15;
  const perMinute = durationMs <= 0 ? Infinity : gestures / (durationMs / 60_000);
  if (perMinute > 20) return 25;
  if (perMinute > 12) return 10;
  return 0;
}

function excessivePenalty(excessive) {
  if (excessive <= 0) return 0;
  if (excessive === 1) return 10;
  if (excessive === 2) return 20;
  return 35;
}

function stillnessPenalty(stillness) {
  if (stillness >= 0.2 && stillness <= 0.7) return 0;
  if (stillness < 0.1 || stillness > 0.9) return 25;
  return 10;
}

function letterFor(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}
