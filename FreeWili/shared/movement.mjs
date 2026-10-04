/* One movement score for the server. The page displays it and does not recompute it.
 * Firmware does not implement this.
 *
 * FreeWili samples arrive in g. Stand-in samples stay unitless.
 * The score stays in the sample's units. This file does not convert them.
 *
 * Baseline: exponential moving average of the x, y, z vector.
 * The first sample sets the baseline and scores 0, so a steady offset is not movement.
 * setBaseline can install a resting pose instead. That call is not a sample.
 * Each later sample measures the gap, then moves the baseline 2% of the way toward the sample.
 *
 * Intensity: length of that gap, averaged over the last 5 samples, divided by
 * movementThreshold. 1 means the smoothed gap is at the threshold. Larger gaps stay at 1.
 * sample() still returns only that 0–1 score. smoothedMagnitude is the average
 * length before the division, in the sample's units (g on a FreeWili). scored is false
 * on the sample that only sets the baseline.
 */

export const BASELINE_BLEND = 0.02;
export const SMOOTH_WINDOW = 5;

export function createMovementTracker(movementThreshold) {
  let baseline = null;
  const recent = [];
  let smoothedMagnitude = 0;
  let scored = false;

  function score(magnitude) {
    recent.push(magnitude);
    if (recent.length > SMOOTH_WINDOW) recent.shift();
    let sum = 0;
    for (const value of recent) sum += value;
    const average = sum / recent.length;
    smoothedMagnitude = average;
    if (!Number.isFinite(movementThreshold) || movementThreshold <= 0) {
      return average > 0 ? 1 : 0;
    }
    const ratio = average / movementThreshold;
    if (ratio <= 0) return 0;
    if (ratio >= 1) return 1;
    return ratio;
  }

  return {
    reset() {
      baseline = null;
      recent.length = 0;
      smoothedMagnitude = 0;
      scored = false;
    },
    setBaseline(vector) {
      if (!vector || ![vector.x, vector.y, vector.z].every((value) => Number.isFinite(value))) return false;
      baseline = { x: vector.x, y: vector.y, z: vector.z };
      recent.length = 0;
      smoothedMagnitude = 0;
      scored = false;
      return true;
    },
    get smoothedMagnitude() {
      return smoothedMagnitude;
    },
    get scored() {
      return scored;
    },
    sample(x, y, z) {
      if (baseline === null) {
        baseline = { x, y, z };
        scored = false;
        return score(0);
      }
      const dx = x - baseline.x;
      const dy = y - baseline.y;
      const dz = z - baseline.z;
      baseline.x += BASELINE_BLEND * dx;
      baseline.y += BASELINE_BLEND * dy;
      baseline.z += BASELINE_BLEND * dz;
      scored = true;
      return score(Math.hypot(dx, dy, dz));
    },
  };
}
