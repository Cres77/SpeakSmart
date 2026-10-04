import { buildSessionSuggestions } from "./analysis-coach";
import type { SessionFrame } from "./schema";
import type { Suggestion } from "./schema";

const EXPRESSIONS = ["neutral", "engaged", "focused", "tense", "smiling"] as const;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function hashSeed(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Placeholder series until live Presage SmartSpectra is wired to the camera. */
export function generatePresageFrames(sessionId: string, durationSeconds: number, qaStartedMs?: number | null) {
  const seconds = Math.max(8, durationSeconds);
  const random = rng(hashSeed(sessionId));
  const frames: Omit<SessionFrame, "id" | "sessionId">[] = [];
  let pulse = 72 + random() * 10;
  let breath = 14 + random() * 3;
  let hrv = 48 + random() * 12;
  let gaze = 78 + random() * 10;
  let posture = 82 + random() * 8;

  for (let i = 0; i <= seconds; i += 1) {
    pulse = clamp(pulse + (random() - 0.48) * 4, 62, 118);
    breath = clamp(breath + (random() - 0.5) * 0.8, 10, 22);
    hrv = clamp(hrv + (random() - 0.5) * 3, 22, 90);
    gaze = clamp(gaze + (random() - 0.46) * 5, 35, 98);
    posture = clamp(posture + (random() - 0.5) * 3.5, 48, 98);
    const expression = EXPRESSIONS[Math.floor(random() * EXPRESSIONS.length)];
    const qaSecond = qaStartedMs == null ? null : Math.floor(qaStartedMs / 1000);
    frames.push({
      timestampMs: i * 1000,
      pulseBpm: Number(pulse.toFixed(1)),
      breathingRpm: Number(breath.toFixed(1)),
      hrvMs: Number(hrv.toFixed(1)),
      gazeScore: Number(gaze.toFixed(1)),
      postureScore: Number(posture.toFixed(1)),
      expression,
      segment: qaSecond != null && i >= qaSecond ? "questions" : "presentation",
    });
  }

  return frames;
}

export function suggestionsFromFrames(
  frames: Omit<SessionFrame, "id" | "sessionId">[],
  note?: string | null,
  context?: { transcript?: string | null; durationSeconds?: number; qaStartedMs?: number | null },
): Suggestion[] {
  return buildSessionSuggestions({
    frames,
    note,
    transcript: context?.transcript,
    durationSeconds: context?.durationSeconds,
    qaStartedMs: context?.qaStartedMs,
  });
}
