/* One movement score for the server. The page displays it and does not recompute it.
 * Firmware does not implement this.
 *
 * Units of x, y, and z are unknown. The score stays in those units.
 * Nothing here converts a sample to g or m/s².
 *
 * Baseline: exponential moving average of the x, y, z vector.
 * The first sample sets the baseline and scores 0, so a steady offset is not movement.
 * Each later sample measures the gap, then moves the baseline 2% of the way toward the sample.
 *
 * Intensity: length of that gap, averaged over the last 5 samples, divided by
 * movementThreshold. 1 means the smoothed gap is at the threshold. Larger gaps stay at 1.
 */

export const BASELINE_BLEND = 0.02;
export const SMOOTH_WINDOW = 5;

export function createMovementTracker(movementThreshold) {
  let baseline = null;
  const recent = [];

  function score(magnitude) {
    recent.push(magnitude);
    if (recent.length > SMOOTH_WINDOW) recent.shift();
    let sum = 0;
    for (const value of recent) sum += value;
    const average = sum / recent.length;
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
    },
    sample(x, y, z) {
      if (baseline === null) {
        baseline = { x, y, z };
        return score(0);
      }
      const dx = x - baseline.x;
      const dy = y - baseline.y;
      const dz = z - baseline.z;
      baseline.x += BASELINE_BLEND * dx;
      baseline.y += BASELINE_BLEND * dy;
      baseline.z += BASELINE_BLEND * dz;
      return score(Math.hypot(dx, dy, dz));
    },
  };
}
