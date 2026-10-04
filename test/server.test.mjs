import assert from "node:assert/strict";
import test from "node:test";
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
    assert.equal(sample.movement, undefined);
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
