/* Resting pose from live samples the page already received.
 * This does not read a device and does not change the intensity formula.
 * Fewer than 20 finite samples is not a pose.
 */

export const CALIBRATION_STORAGE_KEY = "speaksmart.calibration";
export const MIN_CALIBRATION_SAMPLES = 20;

export function restingPose(samples) {
  if (!Array.isArray(samples) || samples.length < MIN_CALIBRATION_SAMPLES) return null;
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (const sample of samples) {
    if (!sample || ![sample.x, sample.y, sample.z].every((value) => Number.isFinite(value))) continue;
    x += sample.x;
    y += sample.y;
    z += sample.z;
    count += 1;
  }
  if (count < MIN_CALIBRATION_SAMPLES) return null;
  return { x: x / count, y: y / count, z: z / count, samples: count };
}

export function readCalibration(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const baseline = parsed.baseline;
  if (!baseline || ![baseline.x, baseline.y, baseline.z].every((value) => Number.isFinite(value))) return null;
  if (!Number.isFinite(parsed.timestamp) || !Number.isFinite(parsed.samples) || parsed.samples < MIN_CALIBRATION_SAMPLES) {
    return null;
  }
  const stored = {
    timestamp: parsed.timestamp,
    samples: parsed.samples,
    baseline: { x: baseline.x, y: baseline.y, z: baseline.z },
  };
  if (typeof parsed.transport === "string" && parsed.transport) stored.transport = parsed.transport;
  return stored;
}
