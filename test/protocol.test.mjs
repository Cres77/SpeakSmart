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

test("sensor x y z is accepted and buzz stays reserved", () => {
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
  const buzz = inspectClientMessage({ type: "buzz", frequency: 350, duration: 150 });
  assert.equal(buzz.code, "reserved");
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
