/* Practice sessions. These are not slide decks and they are not coach messages.
 * The page stores them in localStorage under SESSION_STORAGE_KEY.
 * gestures and excessive hold events the motion rules recorded during that practice.
 * buzzes stays empty.
 */

import { CHART_BUCKET_MS } from "./intensity-series.mjs";

export const SESSION_STORAGE_KEY = "speaksmart.sessions";
export const SESSION_CAP_MS = 30 * 60 * 1000;

function gestureEvent(event) {
  if (!event || !Number.isFinite(event.timestamp) || !Number.isFinite(event.magnitude)) return null;
  return { timestamp: event.timestamp, magnitude: event.magnitude };
}

function excessiveEvent(event) {
  if (!event || !Number.isFinite(event.timestamp) || !Number.isFinite(event.movement)) return null;
  return { timestamp: event.timestamp, movement: event.movement };
}

function transition(change) {
  return {
    timestamp: change.timestamp,
    deckId: typeof change.deckId === "string" ? change.deckId : "",
    deckName: typeof change.deckName === "string" ? change.deckName : "",
    fromIndex: change.fromIndex,
    toIndex: change.toIndex,
    slideTitle: typeof change.slideTitle === "string" ? change.slideTitle : "",
  };
}

export function startSession({ startedAt, slide } = {}) {
  const transitions = [];
  if (slide && Number.isInteger(slide.toIndex)) {
    transitions.push(transition({
      timestamp: startedAt,
      deckId: slide.deckId,
      deckName: slide.deckName,
      fromIndex: Number.isInteger(slide.fromIndex) ? slide.fromIndex : slide.toIndex,
      toIndex: slide.toIndex,
      slideTitle: slide.slideTitle,
    }));
  }
  return {
    id: crypto.randomUUID(),
    startedAt,
    durationMs: 0,
    capped: false,
    samples: [],
    transitions,
    gestures: [],
    excessive: [],
    buzzes: [],
  };
}

export function recordGesture(session, event) {
  const stored = gestureEvent(event);
  if (!session || !stored) return session;
  return { ...session, gestures: [...session.gestures, stored] };
}

export function recordExcessive(session, event) {
  const stored = excessiveEvent(event);
  if (!session || !stored) return session;
  return { ...session, excessive: [...session.excessive, stored] };
}

export function recordSample(session, sample) {
  if (!session || !sample) return session;
  const { timestamp, x, y, z, movement } = sample;
  if (![timestamp, x, y, z, movement].every((value) => Number.isFinite(value))) return session;
  if (timestamp < session.startedAt) return session;
  if (timestamp > session.startedAt + SESSION_CAP_MS) {
    return session.capped ? session : { ...session, capped: true };
  }
  const point = {
    timestamp,
    x,
    y,
    z,
    movement: Math.min(1, Math.max(0, movement)),
  };
  const samples = session.samples;
  const last = samples[samples.length - 1];
  const bucket = Math.floor(timestamp / CHART_BUCKET_MS);
  if (last && bucket < Math.floor(last.timestamp / CHART_BUCKET_MS)) return session;
  if (last && bucket === Math.floor(last.timestamp / CHART_BUCKET_MS)) {
    return { ...session, samples: [...samples.slice(0, -1), point] };
  }
  return { ...session, samples: [...samples, point] };
}

export function recordTransition(session, change) {
  if (!session || !change) return session;
  if (!Number.isFinite(change.timestamp) || !Number.isInteger(change.fromIndex) || !Number.isInteger(change.toIndex)) {
    return session;
  }
  if (change.fromIndex === change.toIndex) return session;
  return {
    ...session,
    transitions: [...session.transitions, transition(change)],
  };
}

export function stopSession(session, stoppedAt) {
  return {
    id: session.id,
    startedAt: session.startedAt,
    durationMs: Math.max(0, stoppedAt - session.startedAt),
    capped: session.capped === true,
    samples: session.samples,
    transitions: session.transitions,
    gestures: session.gestures.map((event) => ({ timestamp: event.timestamp, magnitude: event.magnitude })),
    excessive: session.excessive.map((event) => ({ timestamp: event.timestamp, movement: event.movement })),
    buzzes: [],
  };
}

export function averageMovement(session) {
  if (!session.samples.length) return null;
  let sum = 0;
  for (const sample of session.samples) sum += sample.movement;
  return sum / session.samples.length;
}

export function emptySessions() {
  return { sessions: [] };
}

function isSample(sample) {
  return sample && [sample.timestamp, sample.x, sample.y, sample.z, sample.movement].every((value) => Number.isFinite(value));
}

function isTransition(change) {
  return change && Number.isFinite(change.timestamp) && Number.isInteger(change.fromIndex) && Number.isInteger(change.toIndex);
}

export function readSessions(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return emptySessions();
    }
  }
  if (!parsed || !Array.isArray(parsed.sessions)) return emptySessions();
  const sessions = [];
  for (const session of parsed.sessions) {
    if (!session || typeof session.id !== "string" || !Number.isFinite(session.startedAt)) continue;
    sessions.push({
      id: session.id,
      startedAt: session.startedAt,
      durationMs: Number.isFinite(session.durationMs) ? session.durationMs : 0,
      capped: session.capped === true,
      samples: Array.isArray(session.samples) ? session.samples.filter(isSample).map((sample) => ({
        timestamp: sample.timestamp,
        x: sample.x,
        y: sample.y,
        z: sample.z,
        movement: sample.movement,
      })) : [],
      transitions: Array.isArray(session.transitions) ? session.transitions.filter(isTransition).map(transition) : [],
      gestures: Array.isArray(session.gestures) ? session.gestures.map(gestureEvent).filter(Boolean) : [],
      excessive: Array.isArray(session.excessive) ? session.excessive.map(excessiveEvent).filter(Boolean) : [],
      buzzes: [],
    });
  }
  return { sessions };
}
