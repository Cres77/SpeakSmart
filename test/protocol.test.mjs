import assert from "node:assert/strict";
import test from "node:test";
import {
  browserHello,
  deviceDisconnect,
  deviceHeartbeat,
  deviceHello,
  deviceSensor,
  inspectClientMessage,
  reconnectRequest,
} from "../shared/protocol.mjs";

test("phase 1 coach messages pass inspection", () => {
  assert.equal(inspectClientMessage(deviceHello({ deviceId: "wrist-1", transport: "development-stand-in" })).ok, true);
  assert.equal(inspectClientMessage(deviceHeartbeat({ deviceId: "wrist-1" })).ok, true);
  assert.equal(inspectClientMessage(deviceDisconnect({ deviceId: "wrist-1", reason: "reconnect" })).ok, true);
  assert.equal(inspectClientMessage(browserHello()).role, "browser");
  assert.equal(inspectClientMessage(reconnectRequest()).type, "reconnect");
});

test("sensor x y z is accepted and a manual buzz has limits", () => {
  const sensor = inspectClientMessage(deviceSensor({
    deviceId: "dev-stand-in",
    transport: "development-stand-in",
    x: 0.25,
    y: -0.5,
    z: 1.5,
    timestamp: 1710000000100,
  }));
  assert.equal(sensor.ok, true);
  assert.equal(sensor.type, "sensor");
  const scored = inspectClientMessage({
    type: "sensor",
    role: "device",
    timestamp: 1,
    deviceId: "wrist-1",
    accel: { x: 0.12, y: 0.87, z: 9.71 },
    movement: 0.72,
  });
  assert.equal(scored.code, "invalid");
  const magnitude = inspectClientMessage({
    type: "sensor",
    role: "device",
    timestamp: 1,
    deviceId: "wrist-1",
    accel: { x: 0.12, y: 0.87, z: 9.71 },
    magnitude: 1.4,
  });
  assert.equal(magnitude.code, "invalid");
  const buzz = inspectClientMessage({
    type: "buzz",
    role: "browser",
    frequency: 350,
    duration: 150,
    amplitude: 0.2,
    timestamp: 1710000000100,
  });
  assert.equal(buzz.ok, true);
  assert.equal(buzz.role, "browser");
  const tooLong = inspectClientMessage({
    type: "buzz",
    role: "browser",
    frequency: 350,
    duration: 501,
    amplitude: 0.2,
    timestamp: 1,
  });
  assert.equal(tooLong.code, "invalid");
  const quiet = inspectClientMessage({
    type: "buzz",
    role: "browser",
    frequency: 350,
    duration: 0,
    amplitude: 0.2,
    timestamp: 1,
  });
  assert.equal(quiet.code, "invalid");
  const low = inspectClientMessage({
    type: "buzz",
    role: "browser",
    frequency: 49,
    duration: 150,
    amplitude: 0.2,
    timestamp: 1,
  });
  assert.equal(low.code, "invalid");
  const high = inspectClientMessage({
    type: "buzz",
    role: "browser",
    frequency: 2001,
    duration: 150,
    amplitude: 0.2,
    timestamp: 1,
  });
  assert.equal(high.code, "invalid");
  const played = inspectClientMessage({
    type: "buzz",
    role: "device",
    frequency: 350,
    duration: 150,
    amplitude: 0.2,
    played: true,
    timestamp: 1,
  });
  assert.equal(played.code, "invalid");
  const built = deviceSensor({
    deviceId: "dev-stand-in",
    transport: "development-stand-in",
    x: 1,
    y: 2,
    z: 3,
  });
  assert.equal(built.transport, "development-stand-in");
  assert.equal(built.movement, undefined);
  assert.equal(built.accel.g, undefined);
});
