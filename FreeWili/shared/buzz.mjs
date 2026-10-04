/* Buzz settings, the click guard, and automatic movement feedback.
 * This does not play a tone. Automatic feedback sends at most one command
 * for an excessive event, then waits out buzzCooldownMs. It does not schedule
 * another command by itself.
 */

export const BUZZ_STORAGE_KEY = "speaksmart.buzz";

export function readBuzzSettings(raw, defaults) {
  const fallback = {
    frequency: defaults.frequency,
    duration: defaults.duration,
    amplitude: defaults.amplitude,
    automatic: defaults.automatic === true,
    cooldown: Number.isFinite(defaults.cooldown) ? defaults.cooldown : 3000,
    cueBuzz: defaults.cueBuzz === true,
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
    automatic: parsed.automatic === true,
    cooldown: Number.isFinite(parsed.cooldown) ? parsed.cooldown : fallback.cooldown,
    cueBuzz: parsed.cueBuzz === true,
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

export function createAutomaticFeedback() {
  let cooldownUntil = -Infinity;
  return {
    decide(event, settings, now, guard) {
      if (!event || !settings || settings.automatic !== true) return null;
      if (!Number.isFinite(now)) return null;
      const cooldown = Number.isFinite(settings.cooldown) ? settings.cooldown : 0;
      if (now < cooldownUntil) return null;
      if (guard && !guard.trySend(now, settings.duration)) return null;
      cooldownUntil = now + cooldown;
      return {
        frequency: settings.frequency,
        duration: settings.duration,
        amplitude: settings.amplitude,
        timestamp: now,
        reason: "excessive",
        played: false,
      };
    },
  };
}

export function createSlideCues() {
  let shownId = null;
  return {
    reset() {
      shownId = null;
    },
    enter(slide, settings, now, guard) {
      const id = slide && typeof slide.id === "string" ? slide.id : null;
      if (id === shownId) return null;
      shownId = id;
      const cue = typeof slide?.cue === "string" ? slide.cue.trim() : "";
      if (!cue || !settings || settings.cueBuzz !== true) return null;
      if (!Number.isFinite(now)) return null;
      if (guard && !guard.trySend(now, settings.duration)) return null;
      return {
        frequency: settings.frequency,
        duration: settings.duration,
        amplitude: settings.amplitude,
        timestamp: now,
        reason: "cue",
        slideTitle: typeof slide.title === "string" ? slide.title : "",
        cue,
        played: false,
      };
    },
  };
}
