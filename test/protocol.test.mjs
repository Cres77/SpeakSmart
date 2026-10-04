import assert from "node:assert/strict";
import test from "node:test";
import {
  browserHello,
  deviceDisconnect,
  deviceHeartbeat,
  deviceHello,
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

test("sensor and buzz are reserved", () => {
  const sensor = inspectClientMessage({
    type: "sensor",
    timestamp: 1,
    deviceId: "wrist-1",
    accel: { x: 0.12, y: 0.87, z: 9.71 },
    movement: 0.72,
  });
  const buzz = inspectClientMessage({ type: "buzz", frequency: 350, duration: 150 });
  assert.equal(sensor.code, "reserved");
  assert.equal(buzz.code, "reserved");
});
