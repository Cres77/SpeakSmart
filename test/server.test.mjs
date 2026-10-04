import assert from "node:assert/strict";
import test from "node:test";
import { config } from "../shared/config.mjs";
import { createMovementTracker, SMOOTH_WINDOW } from "../shared/movement.mjs";
import { browserHello, deviceHeartbeat, deviceHello, deviceSensor, reconnectRequest } from "../shared/protocol.mjs";
import { startCoachServer } from "../server/index.mjs";

function waitFor(socket, predicate, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("timed out waiting for a websocket message"));
    }, timeout);
    function onMessage(event) {
      const message = JSON.parse(event.data);
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(message);
    }
    socket.addEventListener("message", onMessage);
  });
}

function opened(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("socket failed")), { once: true });
  });
}

async function browser(url) {
  const socket = new WebSocket(url);
  await opened(socket);
  const first = waitFor(socket, (message) => message.type === "link");
  socket.send(JSON.stringify(browserHello()));
  return { socket, first: await first };
}

test("coach hello, heartbeat, sensor, and reserved buzz", async () => {
  const app = await startCoachServer({
    port: 0,
    standIn: false,
    heartbeatTimeoutMs: 350,
    reconnectGraceMs: 400,
  });
  try {
    const page = await browser(`ws://127.0.0.1:${app.port}/ws`);
    assert.equal(page.first.status, "disconnected");

    const coach = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
    await opened(coach);
    const connected = waitFor(page.socket, (message) => message.status === "connected");
    coach.send(JSON.stringify(deviceHello({ deviceId: "wrist-1" })));
    const link = await connected;
    assert.equal(link.deviceId, "wrist-1");
    assert.equal(link.transport, null);

    const seen = waitFor(page.socket, (message) => message.type === "link" && message.lastSeen >= link.lastSeen);
    coach.send(JSON.stringify(deviceHeartbeat({ deviceId: "wrist-1", timestamp: link.lastSeen + 10 })));
    const beat = await seen;
    assert.equal(beat.status, "connected");
    assert.equal(beat.lastSeen, link.lastSeen + 10);

    const sampleWait = waitFor(page.socket, (message) => message.type === "sensor");
    coach.send(JSON.stringify(deviceSensor({
      deviceId: "wrist-1",
      x: 0.25,
      y: -0.5,
      z: 1.5,
      timestamp: 1710000001234,
    })));
    const sample = await sampleWait;
    assert.equal(sample.deviceId, "wrist-1");
    assert.equal(sample.timestamp, 1710000001234);
    assert.deepEqual(sample.accel, { x: 0.25, y: -0.5, z: 1.5 });
    assert.equal(sample.movement, 0);
    assert.equal(sample.transport, undefined);

    const reserved = waitFor(page.socket, (message) => message.type === "error");
    page.socket.send(JSON.stringify({ type: "buzz", frequency: 350, duration: 150 }));
    const error = await reserved;
    assert.equal(error.code, "reserved");
    assert.equal(error.for, "buzz");

    const down = waitFor(page.socket, (message) => message.status === "disconnected");
    coach.close();
    assert.equal((await down).deviceId, null);
    page.socket.close();
  } finally {
    await app.close();
  }
});

test("reconnect keeps the page on Connecting until the coach returns", async () => {
  const app = await startCoachServer({ port: 0, standIn: false, reconnectGraceMs: 1500 });
  try {
    const page = await browser(`ws://127.0.0.1:${app.port}/ws`);
    const coach = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
    await opened(coach);
    const up = waitFor(page.socket, (message) => message.status === "connected");
    coach.send(JSON.stringify(deviceHello({ deviceId: "wrist-1" })));
    await up;

    const asked = waitFor(coach, (message) => message.type === "reconnect");
    const connecting = waitFor(page.socket, (message) => message.status === "connecting");
    page.socket.send(JSON.stringify(reconnectRequest()));
    await asked;
    await connecting;

    coach.send(
      JSON.stringify({
        type: "disconnect",
        role: "device",
        timestamp: Date.now(),
        deviceId: "wrist-1",
        reason: "reconnect",
      }),
    );
    coach.close();

    const again = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
    await opened(again);
    const restored = waitFor(page.socket, (message) => message.status === "connected" && message.deviceId === "wrist-1");
    again.send(JSON.stringify(deviceHello({ deviceId: "wrist-1" })));
    assert.equal((await restored).status, "connected");
    page.socket.close();
    again.close();
  } finally {
    await app.close();
  }
});

test("development stand-in is labeled and can reconnect", async () => {
  const app = await startCoachServer({
    port: 0,
    standIn: true,
    standInStdio: "ignore",
    reconnectGraceMs: 2000,
  });
  try {
    const page = await browser(`ws://127.0.0.1:${app.port}/ws`);
    const up = page.first.status === "connected"
      ? page.first
      : await waitFor(page.socket, (message) => message.status === "connected", 3000);
    assert.equal(up.transport, "development-stand-in");
    assert.equal(up.deviceId, "dev-stand-in");

    const statuses = [];
    const done = waitFor(
      page.socket,
      (message) => {
        if (message.type !== "link") return false;
        statuses.push(message.status);
        return statuses.includes("connecting") && message.status === "connected";
      },
      3000,
    );
    page.socket.send(JSON.stringify(reconnectRequest()));
    await done;
    assert.ok(statuses.includes("connecting"));
    page.socket.close();
  } finally {
    await app.close();
  }
});

function collectSensors(socket, count, timeout = 2500) {
  const received = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error(`timed out after ${received.length} of ${count} sensor frames`));
    }, timeout);
    function onMessage(event) {
      const message = JSON.parse(event.data);
      if (message.type !== "sensor") return;
      received.push(message);
      if (received.length < count) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(received);
    }
    socket.addEventListener("message", onMessage);
  });
}

test("server scores samples and does not trust a coach movement field", async () => {
  const app = await startCoachServer({ port: 0, standIn: false });
  try {
    const page = await browser(`ws://127.0.0.1:${app.port}/ws`);
    const coach = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
    await opened(coach);
    const up = waitFor(page.socket, (message) => message.status === "connected");
    coach.send(JSON.stringify(deviceHello({ deviceId: "wrist-1" })));
    await up;

    const tracker = createMovementTracker(config.movementThreshold);
    const samples = [];
    for (let i = 0; i < 10; i += 1) samples.push({ x: 0, y: 0, z: 1 });
    for (let i = 0; i < SMOOTH_WINDOW; i += 1) {
      samples.push({ x: config.movementThreshold, y: 0, z: 1 });
    }
    const incoming = collectSensors(page.socket, samples.length);
    for (const sample of samples) {
      coach.send(JSON.stringify(deviceSensor({
        deviceId: "wrist-1",
        x: sample.x,
        y: sample.y,
        z: sample.z,
        timestamp: 1710000002000,
      })));
    }
    const forwarded = await incoming;
    forwarded.forEach((message, index) => {
      assert.equal(message.movement, tracker.sample(samples[index].x, samples[index].y, samples[index].z));
      assert.equal(message.transport, undefined);
      assert.equal(Object.hasOwn(message, "movement"), true);
    });
    assert.ok(forwarded[9].movement < 0.02);
    assert.ok(forwarded.at(-1).movement >= 0.95 && forwarded.at(-1).movement <= 1);

    coach.close();
    const again = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
    await opened(again);
    const restored = waitFor(page.socket, (message) => message.status === "connected");
    again.send(JSON.stringify(deviceHello({ deviceId: "wrist-1" })));
    await restored;

    const halfTracker = createMovementTracker(config.movementThreshold);
    const halfSamples = [];
    for (let i = 0; i < 5; i += 1) halfSamples.push({ x: 0, y: 0, z: 1 });
    for (let i = 0; i < SMOOTH_WINDOW; i += 1) {
      halfSamples.push({ x: config.movementThreshold / 2, y: 0, z: 1 });
    }
    const halfIncoming = collectSensors(page.socket, halfSamples.length);
    for (const sample of halfSamples) {
      again.send(JSON.stringify(deviceSensor({
        deviceId: "wrist-1",
        x: sample.x,
        y: sample.y,
        z: sample.z,
        timestamp: 1710000003000,
      })));
    }
    const halfForwarded = await halfIncoming;
    halfForwarded.forEach((message, index) => {
      assert.equal(message.movement, halfTracker.sample(halfSamples[index].x, halfSamples[index].y, halfSamples[index].z));
    });
    const halfScore = halfForwarded.at(-1).movement;
    assert.ok(halfScore > 0.4 && halfScore < 0.75, halfScore);

    let leaked = false;
    page.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type === "sensor") leaked = true;
    });
    const rejected = waitFor(again, (message) => message.type === "error");
    again.send(JSON.stringify({
      type: "sensor",
      role: "device",
      timestamp: 1710000004000,
      deviceId: "wrist-1",
      accel: { x: 0, y: 0, z: 1 },
      movement: 0.99,
    }));
    const error = await rejected;
    assert.equal(error.code, "invalid");
    assert.equal(error.for, "sensor");
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(leaked, false);
    page.socket.close();
    again.close();
  } finally {
    await app.close();
  }
});
