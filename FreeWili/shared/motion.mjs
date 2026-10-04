/* Gesture, stillness, and excessive movement from samples the movement tracker already scored.
 * Pass the tracker's smoothed magnitude (unknown units, before movementThreshold)
 * and its 0–1 movement score. Do not pass the sample that only set the baseline.
 * This does not buzz, play a tone, or write a coaching sentence.
 */

export function createMotionDetector(config) {
  const gestureThreshold = config.gestureThreshold;
  const gestureMinDurationMs = config.gestureMinDurationMs;
  const gestureCooldownMs = config.gestureCooldownMs;
  const stillnessThreshold = config.stillnessThreshold;
  const excessiveLevel = config.excessiveLevel;
  const excessiveHoldMs = config.excessiveHoldMs;
  const excessiveCooldownMs = config.excessiveCooldownMs;

  let gestureMode = "idle";
  let gestureStart = 0;
  let gestureCounted = false;
  let gestureCooldownUntil = 0;
  let gestureCount = 0;

  let excessiveMode = "idle";
  let excessiveStart = 0;
  let excessiveCooldownUntil = 0;
  let excessiveCount = 0;

  let scoredSamples = 0;
  let stillSamples = 0;
  let state = null;

  function snapshot(gestureEvent = null, excessiveEvent = null) {
    return {
      state,
      gestures: gestureCount,
      excessive: excessiveCount,
      stillnessPercent: scoredSamples === 0 ? null : stillSamples / scoredSamples,
      gestureEvent,
      excessiveEvent,
    };
  }

  function classify(magnitude) {
    if (excessiveMode === "latched") return "Excessive";
    if (magnitude >= gestureThreshold) return "Gesturing";
    if (magnitude < stillnessThreshold) return "Still";
    return "Moving";
  }

  function noteGesture(timestamp, magnitude) {
    if (gestureMode === "cooldown" && timestamp >= gestureCooldownUntil) gestureMode = "idle";
    const high = magnitude >= gestureThreshold;
    if (gestureMode === "cooldown") return null;
    if (high) {
      if (gestureMode !== "active") {
        gestureMode = "active";
        gestureStart = timestamp;
        gestureCounted = false;
      }
      if (!gestureCounted && timestamp - gestureStart >= gestureMinDurationMs) {
        gestureCounted = true;
        gestureCount += 1;
        return { timestamp, magnitude };
      }
      return null;
    }
    if (gestureMode === "active") {
      if (gestureCounted) {
        gestureMode = "cooldown";
        gestureCooldownUntil = timestamp + gestureCooldownMs;
      } else {
        gestureMode = "idle";
      }
      gestureCounted = false;
    }
    return null;
  }

  function noteExcessive(timestamp, movement) {
    if (excessiveMode === "cooldown" && timestamp >= excessiveCooldownUntil) excessiveMode = "idle";
    const high = movement >= excessiveLevel;
    if (!high) {
      if (excessiveMode === "holding") excessiveMode = "idle";
      if (excessiveMode === "latched") {
        excessiveMode = timestamp >= excessiveCooldownUntil ? "idle" : "cooldown";
      }
      return null;
    }
    if (excessiveMode === "cooldown" || excessiveMode === "latched") return null;
    if (excessiveMode === "idle") {
      excessiveMode = "holding";
      excessiveStart = timestamp;
    }
    if (excessiveMode === "holding" && timestamp - excessiveStart >= excessiveHoldMs) {
      excessiveMode = "latched";
      excessiveCooldownUntil = timestamp + excessiveCooldownMs;
      excessiveCount += 1;
      return { timestamp, movement };
    }
    return null;
  }

  return {
    reset() {
      gestureMode = "idle";
      gestureStart = 0;
      gestureCounted = false;
      gestureCooldownUntil = 0;
      gestureCount = 0;
      excessiveMode = "idle";
      excessiveStart = 0;
      excessiveCooldownUntil = 0;
      excessiveCount = 0;
      scoredSamples = 0;
      stillSamples = 0;
      state = null;
    },
    snapshot() {
      return snapshot();
    },
    push(sample) {
      if (!sample) return snapshot();
      const { timestamp, magnitude, movement } = sample;
      if (![timestamp, magnitude, movement].every((value) => Number.isFinite(value))) return snapshot();
      scoredSamples += 1;
      if (magnitude < stillnessThreshold) stillSamples += 1;
      const gestureEvent = noteGesture(timestamp, magnitude);
      const excessiveEvent = noteExcessive(timestamp, movement);
      state = classify(magnitude);
      return snapshot(gestureEvent, excessiveEvent);
    },
  };
}
