const RESERVED = new Set();
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function nowMs() {
  return Date.now();
}

function fail(code, message, type) {
  return { ok: false, code, message, type: type ?? null };
}

export function deviceHello({ deviceId, transport, timestamp = nowMs() }) {
  const message = {
    type: "hello",
    role: "device",
    timestamp,
    deviceId,
  };
  if (transport) message.transport = transport;
  return message;
}

export function deviceHeartbeat({ deviceId, timestamp = nowMs() }) {
  return { type: "heartbeat", role: "device", timestamp, deviceId };
}

export function deviceDisconnect({ deviceId, reason = "shutdown", timestamp = nowMs() }) {
  return { type: "disconnect", role: "device", timestamp, deviceId, reason };
}

export function browserHello({ timestamp = nowMs() } = {}) {
  return { type: "hello", role: "browser", timestamp };
}

export function reconnectRequest({ timestamp = nowMs() } = {}) {
  return { type: "reconnect", role: "browser", timestamp };
}

export function deviceSensor({ deviceId, x, y, z, g, timestamp = nowMs(), transport } = {}) {
  const message = {
    type: "sensor",
    role: "device",
    timestamp,
    deviceId,
    accel: { x, y, z },
  };
  if (g !== undefined) message.accel.g = g;
  if (transport) message.transport = transport;
  return message;
}

export function inspectClientMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return fail("invalid", "Message must be a JSON object.");
  }
  const { type } = message;
  if (typeof type !== "string" || !type) {
    return fail("invalid", "Message type is missing.");
  }
  if (RESERVED.has(type)) {
    return fail("reserved", "That message is reserved for a later phase and was not executed.", type);
  }
  if (type === "hello") return inspectHello(message);
  if (type === "heartbeat") return inspectHeartbeat(message);
  if (type === "disconnect") return inspectDisconnect(message);
  if (type === "reconnect") return inspectReconnect(message);
  if (type === "sensor") return inspectSensor(message);
  if (type === "buzz") return inspectBuzz(message);
  return fail("unknown", "Unknown message type.", type);
}

function inspectHello(message) {
  if (!Number.isFinite(message.timestamp)) {
    return fail("invalid", "hello requires a numeric timestamp.", "hello");
  }
  if (message.role === "browser") return { ok: true, type: "hello", role: "browser" };
  if (message.role !== "device") {
    return fail("invalid", "hello role must be browser or device.", "hello");
  }
  if (typeof message.deviceId !== "string" || !DEVICE_ID.test(message.deviceId)) {
    return fail("invalid", "device hello requires a deviceId.", "hello");
  }
  if (message.transport !== undefined && typeof message.transport !== "string") {
    return fail("invalid", "transport must be a string.", "hello");
  }
  return { ok: true, type: "hello", role: "device" };
}

function inspectHeartbeat(message) {
  if (message.role !== "device") return fail("invalid", "heartbeat is sent by the coach.", "heartbeat");
  if (!Number.isFinite(message.timestamp)) {
    return fail("invalid", "heartbeat requires a numeric timestamp.", "heartbeat");
  }
  if (typeof message.deviceId !== "string" || !DEVICE_ID.test(message.deviceId)) {
    return fail("invalid", "heartbeat requires a deviceId.", "heartbeat");
  }
  return { ok: true, type: "heartbeat", role: "device" };
}

function inspectDisconnect(message) {
  if (message.role !== "device") return fail("invalid", "disconnect is sent by the coach.", "disconnect");
  if (!Number.isFinite(message.timestamp)) {
    return fail("invalid", "disconnect requires a numeric timestamp.", "disconnect");
  }
  if (typeof message.deviceId !== "string" || !DEVICE_ID.test(message.deviceId)) {
    return fail("invalid", "disconnect requires a deviceId.", "disconnect");
  }
  return { ok: true, type: "disconnect", role: "device" };
}

function finiteAxis(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function inspectSensor(message) {
  if (message.role !== "device") return fail("invalid", "sensor is sent by the coach.", "sensor");
  if (!Number.isFinite(message.timestamp)) {
    return fail("invalid", "sensor requires a numeric timestamp.", "sensor");
  }
  if (typeof message.deviceId !== "string" || !DEVICE_ID.test(message.deviceId)) {
    return fail("invalid", "sensor requires a deviceId.", "sensor");
  }
  if (message.movement !== undefined) {
    return fail("invalid", "A coach-supplied movement score is not used.", "sensor");
  }
  if (message.magnitude !== undefined) {
    return fail("invalid", "A coach-supplied magnitude is not used.", "sensor");
  }
  if (message.transport !== undefined && typeof message.transport !== "string") {
    return fail("invalid", "transport must be a string.", "sensor");
  }
  const accel = message.accel;
  if (!accel || typeof accel !== "object" || Array.isArray(accel)) {
    return fail("invalid", "sensor requires accel x, y, and z.", "sensor");
  }
  if (!finiteAxis(accel.x) || !finiteAxis(accel.y) || !finiteAxis(accel.z)) {
    return fail("invalid", "accel x, y, and z must be finite numbers.", "sensor");
  }
  if (accel.g !== undefined && !finiteAxis(accel.g)) {
    return fail("invalid", "accel g must be a finite number when present.", "sensor");
  }
  return { ok: true, type: "sensor", role: "device" };
}

function inspectBuzz(message) {
  if (!Number.isFinite(message.timestamp)) {
    return fail("invalid", "buzz requires a numeric timestamp.", "buzz");
  }
  if (!Number.isFinite(message.frequency) || message.frequency < 50 || message.frequency > 2000) {
    return fail("invalid", "buzz frequency must be from 50 to 2000 Hz.", "buzz");
  }
  if (!Number.isFinite(message.duration) || message.duration <= 0 || message.duration > 500) {
    return fail("invalid", "buzz duration must be greater than 0 ms and at most 500 ms.", "buzz");
  }
  if (!Number.isFinite(message.amplitude)) {
    return fail("invalid", "buzz requires a numeric amplitude.", "buzz");
  }
  if (message.role === "device") {
    if (message.played !== false) {
      return fail("invalid", "The coach acknowledgement must say the tone was not played.", "buzz");
    }
    return { ok: true, type: "buzz", role: "device" };
  }
  if (message.role !== undefined && message.role !== "browser") {
    return fail("invalid", "buzz is sent by the website.", "buzz");
  }
  if (message.played !== undefined) {
    return fail("invalid", "The website does not report playback.", "buzz");
  }
  return { ok: true, type: "buzz", role: "browser" };
}

function inspectReconnect(message) {
  if (message.role !== "browser") {
    return fail("invalid", "reconnect is requested by the website.", "reconnect");
  }
  if (!Number.isFinite(message.timestamp)) {
    return fail("invalid", "reconnect requires a numeric timestamp.", "reconnect");
  }
  return { ok: true, type: "reconnect", role: "browser" };
}
