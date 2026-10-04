import type { SessionFrame, Suggestion } from "./schema";

type Frame = Omit<SessionFrame, "id" | "sessionId">;

export function buildSessionSuggestions(input: {
  frames: Frame[];
  note?: string | null;
  transcript?: string | null;
  durationSeconds?: number;
  qaStartedMs?: number | null;
}): Suggestion[] {
  const { frames, note } = input;
  if (!frames.length) {
    return [
      note
        ? { id: "presage-note", title: "Presage could not measure this recording", body: note, severity: "watch" }
        : {
            id: "empty",
            title: "No Presage samples yet",
            body: "End a recording to generate a frame-by-frame rundown.",
            severity: "info",
          },
    ];
  }

  const durationMs = Math.max(
    (input.durationSeconds ?? 0) * 1000,
    frames[frames.length - 1]?.timestampMs ?? 0,
  );
  const suggestions: Suggestion[] = [];
  const pulse = series(frames, "pulseBpm");
  const breath = series(frames, "breathingRpm");
  const hrv = series(frames, "hrvMs");

  suggestions.push(coverageCard(pulse, breath, hrv, durationMs));
  suggestions.push(...pulseCards(pulse));
  suggestions.push(...breathCards(breath));
  if (hrv.changes.length) suggestions.push(...hrvCards(hrv));
  else {
    suggestions.push({
      id: "hrv-missing",
      title: "No heart-rate variability this run",
      body: "No HRV sample. Hold still a little longer next time if you want a recovery score.",
      severity: "info",
    });
  }

  if (input.qaStartedMs != null) suggestions.push(qaCard(pulse, breath, input.qaStartedMs));
  if (input.transcript?.trim()) suggestions.push(...speechCards(input.transcript, durationMs));
  if (note) {
    suggestions.push({ id: "presage-note", title: "Presage note", body: note, severity: "watch" });
  }
  return suggestions.slice(0, 10);
}

export type MetricScore = {
  id: string;
  label: string;
  score: number;
  detail: string;
};

export function sessionScores(input: {
  frames: Frame[];
  transcript?: string | null;
  durationSeconds?: number;
}): { overall: number | null; metrics: MetricScore[] } {
  if (!input.frames.length) return { overall: null, metrics: [] };
  const durationMs = Math.max((input.durationSeconds ?? 0) * 1000, input.frames.at(-1)?.timestampMs ?? 0);
  const pulse = series(input.frames, "pulseBpm");
  const breath = series(input.frames, "breathingRpm");
  const hrv = series(input.frames, "hrvMs");
  const metrics: MetricScore[] = [];

  if (pulse.changes.length) {
    const low = extreme(pulse.changes, "min");
    const high = extreme(pulse.changes, "max");
    const range = high.v - low.v;
    metrics.push({
      id: "pulse",
      label: "Pulse steadiness",
      score: clamp(Math.round(100 - Math.max(0, range - 6) * 2.5), 0, 100),
      detail: `${low.v.toFixed(0)}–${high.v.toFixed(0)} bpm`,
    });
  }

  const plausible = breath.changes.filter((point) => point.v >= 6 && point.v <= 30);
  if (plausible.length) {
    const avg = plausible.reduce((sum, point) => sum + point.v, 0) / plausible.length;
    const wild = breath.changes.length - plausible.length;
    metrics.push({
      id: "breath",
      label: "Breathing",
      score: clamp(Math.round(100 - Math.abs(avg - 14) * 5 - wild * 12), 0, 100),
      detail: `~${avg.toFixed(0)} /min`,
    });
  }

  if (hrv.changes.length) {
    const avg = hrv.changes.reduce((sum, point) => sum + point.v, 0) / hrv.changes.length;
    metrics.push({
      id: "hrv",
      label: "Recovery",
      score: clamp(Math.round((avg / 70) * 100), 0, 100),
      detail: `${avg.toFixed(0)} ms HRV`,
    });
  }

  const text = input.transcript?.trim();
  if (text) {
    const words = text.replace(/— Audience questions —/g, " ").split(/\s+/).filter(Boolean);
    const minutes = Math.max(durationMs / 60000, 1 / 60);
    const wpm = words.length / minutes;
    metrics.push({
      id: "pace",
      label: "Pace",
      score: clamp(Math.round(100 - Math.abs(wpm - 145) * 1.1), 0, 100),
      detail: `${wpm.toFixed(0)} wpm`,
    });
    const fillers = countFillers(text).reduce((sum, item) => sum + item.count, 0);
    const perHundred = words.length ? (fillers / words.length) * 100 : 0;
    metrics.push({
      id: "clarity",
      label: "Clarity",
      score: clamp(Math.round(100 - perHundred * 8), 0, 100),
      detail: fillers ? `${fillers} fillers` : "No fillers",
    });
  }

  const covered = input.frames.filter((frame) => frame.pulseBpm != null).length;
  if (input.frames.length) {
    metrics.push({
      id: "signal",
      label: "Signal coverage",
      score: clamp(Math.round((covered / input.frames.length) * 100), 0, 100),
      detail: pulse.points[0] ? `Pulse from ${clock(pulse.points[0].t)}` : "No pulse",
    });
  }

  if (!metrics.length) return { overall: null, metrics: [] };
  const overall = Math.round(metrics.reduce((sum, metric) => sum + metric.score, 0) / metrics.length);
  return { overall, metrics };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function measurementBrief(input: {
  frames: Frame[];
  transcript?: string | null;
  durationSeconds?: number;
  qaStartedMs?: number | null;
}) {
  const lines = buildSessionSuggestions(input).map(
    (item) => `${item.severity.toUpperCase()} — ${item.title}: ${item.body}`,
  );
  const transcript = input.transcript?.trim();
  return [
    `Duration: ${Math.round((input.durationSeconds ?? 0) || (input.frames.at(-1)?.timestampMs ?? 0) / 1000)} seconds.`,
    input.qaStartedMs != null ? `Audience questions start at ${clock(input.qaStartedMs)}.` : "No audience Q&A.",
    ...lines,
    transcript ? `Transcript:\n${transcript.slice(0, 8000)}` : "No transcript.",
  ].join("\n\n");
}

type Point = { t: number; v: number };
type Track = { points: Point[]; changes: Point[] };

function series(frames: Frame[], key: "pulseBpm" | "breathingRpm" | "hrvMs"): Track {
  const points: Point[] = [];
  for (const frame of frames) {
    const value = frame[key];
    if (typeof value === "number" && Number.isFinite(value)) points.push({ t: frame.timestampMs, v: value });
  }
  const changes: Point[] = [];
  for (const point of points) {
    const prev = changes[changes.length - 1];
    if (!prev || prev.v !== point.v) changes.push(point);
  }
  return { points, changes };
}

function coverageCard(pulse: Track, breath: Track, hrv: Track, durationMs: number): Suggestion {
  const firstPulse = pulse.points[0];
  const firstBreath = breath.points[0];
  const parts = [
    `The take is ${clock(durationMs)}.`,
    firstBreath
      ? `Breathing rate starts at ${clock(firstBreath.t)}.`
      : "Breathing rate never arrived.",
    firstPulse ? `Pulse starts at ${clock(firstPulse.t)}.` : "Pulse never arrived.",
    hrv.points.length ? `HRV starts at ${clock(hrv.points[0].t)}.` : "HRV never arrived.",
  ];
  return { id: "coverage", title: "What was measured", body: parts.join(" "), severity: "info" };
}

function pulseCards(pulse: Track): Suggestion[] {
  if (!pulse.changes.length) {
    return [
      {
        id: "pulse-missing",
        title: "No pulse samples",
        body: "No pulse. Keep your face and upper chest in frame, and hold still for the first half minute.",
        severity: "watch",
      },
    ];
  }
  const values = pulse.changes.map((point) => point.v);
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const peak = extreme(pulse.changes, "max");
  const low = extreme(pulse.changes, "min");
  const first = pulse.changes[0];
  const last = pulse.changes[pulse.changes.length - 1];
  const cards: Suggestion[] = [
    {
      id: "pulse-range",
      title: "Pulse moved through the talk",
      body: `${low.v.toFixed(0)}–${peak.v.toFixed(0)} bpm, averaging ${avg.toFixed(0)}. Last new reading is ${last.v.toFixed(0)} at ${clock(last.t)}.`,
      severity: peak.v - low.v > 15 ? "watch" : "info",
    },
  ];
  if (last.t > first.t && last.v < first.v - 8) {
    cards.push({
      id: "pulse-drop",
      title: "Energy fell after the peak",
      body: `Peaks at ${peak.v.toFixed(0)} bpm (${clock(peak.t)}), then falls to ${last.v.toFixed(0)} by ${clock(last.t)}. Add a breath before the next big point.`,
      severity: "strong",
    });
  } else if (peak.v > 95) {
    cards.push({
      id: "pulse-high",
      title: "Heart rate ran high",
      body: `Hits ${peak.v.toFixed(0)} bpm at ${clock(peak.t)}. Take one breath before the first real sentence.`,
      severity: "strong",
    });
  }
  if (first.t > 20_000) {
    cards.push({
      id: "pulse-late",
      title: "The pulse took a while to lock",
      body: `First pulse is at ${clock(first.t)}. Face the camera and hold still through the opening.`,
      severity: "watch",
    });
  }
  return cards;
}

function breathCards(breath: Track): Suggestion[] {
  if (!breath.changes.length) {
    return [
      {
        id: "breath-missing",
        title: "No breathing rate",
        body: "No breathing rate. Keep your upper chest in frame and stay still for a few breaths.",
        severity: "watch",
      },
    ];
  }
  const plausible = breath.changes.filter((point) => point.v >= 6 && point.v <= 30);
  const wild = breath.changes.filter((point) => point.v < 6 || point.v > 30);
  const cards: Suggestion[] = [];
  if (plausible.length) {
    const avg = plausible.reduce((sum, point) => sum + point.v, 0) / plausible.length;
    const low = extreme(plausible, "min");
    const high = extreme(plausible, "max");
    cards.push({
      id: "breath-range",
      title: "Breathing rate through the talk",
      body: `About ${avg.toFixed(0)} breaths/min (${low.v.toFixed(0)}–${high.v.toFixed(0)}). Breathe out at the end of each point.`,
      severity: high.v > 22 || low.v < 8 ? "watch" : "info",
    });
  }
  if (wild.length) {
    const listed = wild
      .slice(0, 4)
      .map((point) => `${point.v.toFixed(1)} at ${clock(point.t)}`)
      .join(", ");
    cards.push({
      id: "breath-spikes",
      title: "A few breathing readings look wrong",
      body: `Skip ${listed}. Those are bad locks, not real breaths.`,
      severity: "watch",
    });
  }
  return cards;
}

function hrvCards(hrv: Track): Suggestion[] {
  const avg = hrv.changes.reduce((sum, point) => sum + point.v, 0) / hrv.changes.length;
  return [
    {
      id: "hrv",
      title: avg < 40 ? "Little recovery between points" : "Heart-rate variability",
      body: `HRV averages ${avg.toFixed(0)} ms${avg < 40 ? ". Pause after the points you want remembered." : "."}`,
      severity: avg < 40 ? "watch" : "info",
    },
  ];
}

function qaCard(pulse: Track, breath: Track, qaStartedMs: number): Suggestion {
  const before = pulse.changes.filter((point) => point.t < qaStartedMs);
  const after = pulse.changes.filter((point) => point.t >= qaStartedMs);
  const avg = (points: Point[]) =>
    points.length ? points.reduce((sum, point) => sum + point.v, 0) / points.length : null;
  const talk = avg(before);
  const answers = avg(after);
  const breathAfter = breath.changes.filter((point) => point.t >= qaStartedMs && point.v >= 6 && point.v <= 30);
  const breathAvg = avg(breathAfter);
  const pulseLine =
    talk != null && answers != null
      ? `Pulse averages ${talk.toFixed(0)} bpm during the talk and ${answers.toFixed(0)} bpm once questions start at ${clock(qaStartedMs)}.`
      : `Questions start at ${clock(qaStartedMs)}.`;
  const breathLine =
    breathAvg != null ? ` Breathing during the answers averages ${breathAvg.toFixed(1)} per minute.` : "";
  return {
    id: "qa",
    title: "How the Q&A compares with the talk",
    body: `${pulseLine}${breathLine} Answer in the first sentence, then one example.`,
    severity: "info",
  };
}

function speechCards(transcript: string, durationMs: number): Suggestion[] {
  const text = transcript.replace(/— Audience questions —/g, " ").replace(/\s+/g, " ").trim();
  const words = text.split(" ").filter(Boolean);
  const minutes = Math.max(durationMs / 60000, 1 / 60);
  const wpm = words.length / minutes;
  const fillers = countFillers(text);
  const fillerTotal = fillers.reduce((sum, item) => sum + item.count, 0);
  const cards: Suggestion[] = [
    {
      id: "pace",
      title: wpm > 170 ? "You are talking fast" : wpm < 110 ? "The pace is sparse" : "Speaking pace",
      body: `${wpm.toFixed(0)} words per minute across ${words.length} words. A clear briefing sits around 130–160.`,
      severity: wpm > 170 || wpm < 110 ? "watch" : "info",
    },
  ];
  if (fillerTotal > 0) {
    const listed = fillers
      .slice(0, 4)
      .map((item) => `"${item.word}" ×${item.count}`)
      .join(", ");
    cards.push({
      id: "fillers",
      title: "Filler words are carrying the sentences",
      body: `${fillerTotal} fillers (${listed}). Stop instead of filling, then finish the sentence.`,
      severity: fillerTotal > 8 ? "strong" : "watch",
    });
  }
  const repeats = repeatedStarts(words);
  if (repeats) {
    cards.push({
      id: "restarts",
      title: "Sentences restart before they land",
      body: repeats,
      severity: "watch",
    });
  }
  return cards;
}

function countFillers(text: string) {
  const lower = text.toLowerCase();
  const patterns = ["like", "um", "uh", "you know", "kind of", "sort of", "basically", "actually"];
  return patterns
    .map((word) => ({ word, count: lower.match(new RegExp(`\\b${word}\\b`, "g"))?.length ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);
}

function repeatedStarts(words: string[]) {
  let runs = 0;
  let example = "";
  for (let i = 1; i < words.length; i += 1) {
    if (words[i].toLowerCase().replace(/[^a-z']/g, "") === words[i - 1].toLowerCase().replace(/[^a-z']/g, "")) {
      runs += 1;
      if (!example) example = `${words[i - 1]} ${words[i]}`;
    }
  }
  if (runs < 2) return "";
  return `Words double up ${runs} times (“${example}”). Finish the clause, or pause in silence.`;
}

function extreme(points: Point[], which: "min" | "max") {
  return points.reduce((best, point) => (which === "max" ? (point.v > best.v ? point : best) : point.v < best.v ? point : best));
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
