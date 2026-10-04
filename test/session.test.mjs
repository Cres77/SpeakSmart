import assert from "node:assert/strict";
import test from "node:test";
import { CHART_BUCKET_MS } from "../shared/intensity-series.mjs";
import {
  SESSION_CAP_MS,
  SESSION_STORAGE_KEY,
  averageMovement,
  readSessions,
  recordBuzz,
  recordExcessive,
  recordGesture,
  recordSample,
  recordTransition,
  startSession,
  stopSession,
} from "../shared/session.mjs";

const startedAt = 1_700_000_000_000;

function sample(timestamp, x, movement) {
  return { timestamp, x, y: 0, z: 1, movement };
}

test("start records the current slide and empty event lists", () => {
  const session = startSession({
    startedAt,
    slide: {
      deckId: "deck-1",
      deckName: "Morning talk",
      fromIndex: 0,
      toIndex: 0,
      slideTitle: "Welcome",
    },
  });
  assert.equal(SESSION_STORAGE_KEY, "speaksmart.sessions");
  assert.equal(session.startedAt, startedAt);
  assert.equal(session.durationMs, 0);
  assert.equal(session.capped, false);
  assert.equal(session.samples.length, 0);
  assert.equal(session.transitions.length, 1);
  assert.equal(session.transitions[0].deckId, "deck-1");
  assert.equal(session.transitions[0].deckName, "Morning talk");
  assert.equal(session.transitions[0].fromIndex, 0);
  assert.equal(session.transitions[0].toIndex, 0);
  assert.equal(session.transitions[0].slideTitle, "Welcome");
  assert.deepEqual(session.gestures, []);
  assert.deepEqual(session.excessive, []);
  assert.deepEqual(session.buzzes, []);
});

test("samples keep the latest value in each chart bucket", () => {
  let session = startSession({ startedAt });
  session = recordSample(session, sample(startedAt, 0.1, 0.2));
  session = recordSample(session, sample(startedAt + CHART_BUCKET_MS - 1, 0.8, 0.6));
  assert.equal(CHART_BUCKET_MS, 250);
  assert.equal(session.samples.length, 1);
  assert.equal(session.samples[0].timestamp, startedAt + 249);
  assert.equal(session.samples[0].x, 0.8);
  assert.equal(session.samples[0].y, 0);
  assert.equal(session.samples[0].z, 1);
  assert.equal(session.samples[0].movement, 0.6);
  session = recordSample(session, sample(startedAt + CHART_BUCKET_MS, 0.3, 0.4));
  assert.equal(session.samples.length, 2);
  assert.equal(session.samples[1].x, 0.3);
  assert.equal(session.samples[0].x, 0.8);
});

test("a slide change is stored and stop keeps duration with empty events", () => {
  let session = startSession({
    startedAt,
    slide: { deckId: "deck-1", deckName: "Morning talk", fromIndex: 0, toIndex: 0, slideTitle: "Welcome" },
  });
  session = recordSample(session, sample(startedAt + 20, 0.2, 0.25));
  session = recordSample(session, sample(startedAt + 40, 0.2, 0.75));
  session = recordTransition(session, {
    timestamp: startedAt + 1000,
    deckId: "deck-1",
    deckName: "Morning talk",
    fromIndex: 0,
    toIndex: 1,
    slideTitle: "Close",
  });
  assert.equal(session.transitions.length, 2);
  assert.equal(session.transitions[1].fromIndex, 0);
  assert.equal(session.transitions[1].toIndex, 1);
  assert.equal(session.transitions[1].slideTitle, "Close");
  const saved = stopSession(session, startedAt + 5000);
  assert.equal(saved.durationMs, 5000);
  assert.equal(saved.samples.length, 1);
  assert.equal(averageMovement(saved), 0.75);
  assert.deepEqual(saved.gestures, []);
  assert.deepEqual(saved.excessive, []);
  assert.deepEqual(saved.buzzes, []);
  assert.equal(saved.feedback, undefined);
});

test("the 30-minute cap refuses new samples and keeps earlier ones", () => {
  let session = startSession({ startedAt });
  session = recordSample(session, sample(startedAt + SESSION_CAP_MS, 1, 0.2));
  assert.equal(session.samples.length, 1);
  assert.equal(session.capped, false);
  session = recordSample(session, sample(startedAt + SESSION_CAP_MS + 1, 9, 0.9));
  assert.equal(session.capped, true);
  assert.equal(session.samples.length, 1);
  assert.equal(session.samples[0].x, 1);
  assert.equal(session.samples[0].movement, 0.2);
  const loaded = readSessions(JSON.stringify({
    sessions: [{
      ...stopSession(session, startedAt + SESSION_CAP_MS + 5000),
      gestures: [{ name: "wave" }],
      excessive: [{ at: 1 }],
      buzzes: [{ at: 2 }],
    }],
  }));
  assert.equal(loaded.sessions.length, 1);
  assert.equal(loaded.sessions[0].samples[0].x, 1);
  assert.deepEqual(loaded.sessions[0].gestures, []);
  assert.deepEqual(loaded.sessions[0].excessive, []);
  assert.deepEqual(loaded.sessions[0].buzzes, []);
});

test("a practice keeps gesture and excessive events and drops invented ones", () => {
  let session = startSession({ startedAt });
  session = recordGesture(session, { timestamp: startedAt + 200, magnitude: 1.4, name: "wave" });
  session = recordGesture(session, { timestamp: startedAt + 10 });
  session = recordExcessive(session, { timestamp: startedAt + 1000, movement: 0.8 });
  session = recordExcessive(session, { movement: 1 });
  const saved = stopSession(session, startedAt + 5000);
  assert.deepEqual(saved.gestures, [{ timestamp: startedAt + 200, magnitude: 1.4 }]);
  assert.deepEqual(saved.excessive, [{ timestamp: startedAt + 1000, movement: 0.8 }]);
  assert.deepEqual(saved.buzzes, []);
  const loaded = readSessions(JSON.stringify({
    sessions: [{
      ...saved,
      gestures: [...saved.gestures, { name: "wave" }],
      buzzes: [{ at: 2 }],
    }],
  }));
  assert.deepEqual(loaded.sessions[0].gestures, saved.gestures);
  assert.deepEqual(loaded.sessions[0].excessive, saved.excessive);
  assert.deepEqual(loaded.sessions[0].buzzes, []);
});

test("a manual buzz sent during practice is stored as not played", () => {
  let session = startSession({ startedAt });
  session = recordBuzz(session, {
    timestamp: startedAt + 50,
    frequency: 350,
    duration: 150,
    amplitude: 0.2,
    played: false,
  });
  session = recordBuzz(session, {
    timestamp: startedAt + 80,
    frequency: 350,
    duration: 150,
    amplitude: 0.2,
    played: true,
  });
  const saved = stopSession(session, startedAt + 200);
  assert.deepEqual(saved.buzzes, [{
    timestamp: startedAt + 50,
    frequency: 350,
    duration: 150,
    amplitude: 0.2,
    played: false,
  }]);
  const loaded = readSessions(JSON.stringify({ sessions: [saved] }));
  assert.deepEqual(loaded.sessions[0].buzzes, saved.buzzes);
  assert.equal(loaded.sessions[0].buzzes.some((event) => event.played === true), false);
});
