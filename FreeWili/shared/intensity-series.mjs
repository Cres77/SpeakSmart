/* Rolling intensity trace for the page chart.
 * The movement formula stays in movement.mjs. This file only keeps points.
 *
 * Samples arrive at sampleRateHz. The chart does not store each one.
 * Each 250 ms bucket keeps the latest intensity and that sample's timestamp,
 * which is about 4 points per second. Points older than 60 seconds, measured
 * from the newest timestamp, are dropped. The cap is one point per bucket
 * across that window, plus the current bucket.
 */

export const CHART_WINDOW_MS = 60_000;
export const CHART_BUCKET_MS = 250;
export const CHART_POINT_CAP = Math.ceil(CHART_WINDOW_MS / CHART_BUCKET_MS) + 1;

export function createIntensitySeries() {
  const points = [];

  function prune() {
    const newest = points[points.length - 1].timestamp;
    const cutoff = newest - CHART_WINDOW_MS;
    while (points.length > 1 && points[0].timestamp < cutoff) points.shift();
    while (points.length > CHART_POINT_CAP) points.shift();
  }

  return {
    get points() {
      return points;
    },
    reset() {
      points.length = 0;
    },
    push(timestamp, movement) {
      if (!Number.isFinite(timestamp) || !Number.isFinite(movement)) return { action: "ignore" };
      const intensity = Math.min(100, Math.max(0, movement * 100));
      const bucket = Math.floor(timestamp / CHART_BUCKET_MS);
      const last = points[points.length - 1];
      if (last && bucket < last.bucket) return { action: "ignore" };
      if (last && bucket === last.bucket) {
        last.timestamp = timestamp;
        last.intensity = intensity;
        prune();
        return { action: "replace" };
      }
      points.push({ timestamp, intensity, bucket });
      prune();
      return { action: "add" };
    },
  };
}
