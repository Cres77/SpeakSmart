/* Manual buzz settings and the click guard. This does not play a tone. */

export const BUZZ_STORAGE_KEY = "speaksmart.buzz";

export function readBuzzSettings(raw, defaults) {
  const fallback = {
    frequency: defaults.frequency,
    duration: defaults.duration,
    amplitude: defaults.amplitude,
  };
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
  return {
    frequency: Number.isFinite(parsed.frequency) ? parsed.frequency : fallback.frequency,
    duration: Number.isFinite(parsed.duration) ? parsed.duration : fallback.duration,
    amplitude: Number.isFinite(parsed.amplitude) ? parsed.amplitude : fallback.amplitude,
  };
}

export function buzzCommandError(command) {
  if (!command || !Number.isFinite(command.frequency) || command.frequency < 50 || command.frequency > 2000) {
    return "Frequency must be from 50 to 2000 Hz.";
  }
  if (!Number.isFinite(command.duration) || command.duration <= 0 || command.duration > 500) {
    return "Duration must be greater than 0 ms and at most 500 ms.";
  }
  if (!Number.isFinite(command.amplitude)) return "Amplitude must be a number.";
  return null;
}

export function createBuzzGuard() {
  let until = 0;
  return {
    trySend(now, durationMs) {
      if (now < until) return false;
      until = now + durationMs;
      return true;
    },
  };
}
