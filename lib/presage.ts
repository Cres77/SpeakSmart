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
export function generatePresageFrames(sessionId: string, durationSeconds: number) {
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
    frames.push({
      timestampMs: i * 1000,
      pulseBpm: Number(pulse.toFixed(1)),
      breathingRpm: Number(breath.toFixed(1)),
      hrvMs: Number(hrv.toFixed(1)),
      gazeScore: Number(gaze.toFixed(1)),
      postureScore: Number(posture.toFixed(1)),
      expression,
    });
  }

  return frames;
}

export function suggestionsFromFrames(
  frames: Omit<SessionFrame, "id" | "sessionId">[],
): Suggestion[] {
  if (frames.length === 0) {
    return [
      {
        id: "empty",
        title: "No Presage samples yet",
        body: "End a recording to generate a frame-by-frame rundown.",
        severity: "info",
      },
    ];
  }

  const avg = (key: keyof Omit<SessionFrame, "id" | "sessionId">) => {
    const values = frames.map((f) => Number(f[key] ?? 0));
    return values.reduce((a, b) => a + b, 0) / values.length;
  };

  const pulse = avg("pulseBpm");
  const gaze = avg("gazeScore");
  const posture = avg("postureScore");
  const hrv = avg("hrvMs");
  const suggestions: Suggestion[] = [];

  if (pulse > 95) {
    suggestions.push({
      id: "pulse-high",
      title: "Heart rate ran high",
      body: `Average pulse was ${pulse.toFixed(0)} bpm. Slow your opening, plant your feet, and take a breath before the first slide.`,
      severity: "strong",
    });
  } else {
    suggestions.push({
      id: "pulse-ok",
      title: "Steady delivery energy",
      body: `Average pulse stayed around ${pulse.toFixed(0)} bpm. Keep that measured pace on the next run.`,
      severity: "info",
    });
  }

  if (gaze < 70) {
    suggestions.push({
      id: "gaze",
      title: "Look to the audience more",
      body: `Gaze stability averaged ${gaze.toFixed(0)}. Hold the camera (or the room) for a full sentence before glancing at notes.`,
      severity: "watch",
    });
  } else {
    suggestions.push({
      id: "gaze-ok",
      title: "Eye contact held",
      body: `Gaze score averaged ${gaze.toFixed(0)}. That reads as confident on camera.`,
      severity: "info",
    });
  }

  if (posture < 75) {
    suggestions.push({
      id: "posture",
      title: "Open up your stance",
      body: `Posture averaged ${posture.toFixed(0)}. Square your shoulders to the lens and avoid drifting out of frame.`,
      severity: "watch",
    });
  }

  if (hrv < 40) {
    suggestions.push({
      id: "hrv",
      title: "Build in recovery beats",
      body: `HRV averaged ${hrv.toFixed(0)} ms. Insert a pause after key points so your breathing can reset.`,
      severity: "watch",
    });
  }

  suggestions.push({
    id: "next",
    title: "AI language notes coming next",
    body: "Groq speech-to-text and ElevenLabs playback will land on this panel once those APIs are wired. This pass uses Presage-style vitals only.",
    severity: "info",
  });

  return suggestions;
}
