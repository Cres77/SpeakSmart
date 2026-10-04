import { config } from "../shared/config.mjs";
import { deviceDisconnect, deviceHeartbeat, deviceHello, deviceSensor } from "../shared/protocol.mjs";

/* Development stand-in. This process is not a FreeWili.
 * Sensor numbers below are synthetic. They are not AccelData and have no unit.
 */

const host = process.env.SPEAKSMART_HOST || "127.0.0.1";
const port = Number(process.env.SPEAKSMART_PORT || config.serverPort);
const deviceId = process.env.SPEAKSMART_DEVICE_ID || "dev-stand-in";
const url = `ws://${host}:${port}/ws`;

let stopped = false;
let socket = null;
let heartbeat = null;
let samples = null;
let retry = null;
let reconnecting = false;

function syntheticAxes(now) {
  const seconds = now / 1000;
  return {
    x: Math.sin(seconds),
    y: Math.cos(seconds * 0.7),
    z: Math.sin(seconds * 0.3),
  };
}

function connect() {
  if (stopped) return;
  const ws = new WebSocket(url);
  socket = ws;

  ws.addEventListener("open", () => {
    console.log(`development stand-in (not a FreeWili) connected as ${deviceId}`);
    ws.send(JSON.stringify(deviceHello({ deviceId, transport: "development-stand-in" })));
    clearInterval(heartbeat);
    clearInterval(samples);
    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(deviceHeartbeat({ deviceId })));
      }
    }, config.heartbeatIntervalMs);
    const period = Math.max(1, Math.round(1000 / config.sampleRateHz));
    samples = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const axes = syntheticAxes(Date.now());
      ws.send(JSON.stringify(deviceSensor({
        deviceId,
        transport: "development-stand-in",
        x: axes.x,
        y: axes.y,
        z: axes.z,
      })));
    }, period);
  });

  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.type === "buzz" && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "buzz",
        role: "device",
        frequency: message.frequency,
        duration: message.duration,
        amplitude: message.amplitude,
        played: false,
        timestamp: Date.now(),
      }));
      return;
    }
    if (message.type !== "reconnect" || ws.readyState !== WebSocket.OPEN) return;
    reconnecting = true;
    ws.send(JSON.stringify(deviceDisconnect({ deviceId, reason: "reconnect" })));
    ws.close();
  });

  ws.addEventListener("close", () => {
    clearInterval(heartbeat);
    clearInterval(samples);
    heartbeat = null;
    samples = null;
    if (stopped) return;
    const delay = reconnecting ? 200 : 800;
    reconnecting = false;
    clearTimeout(retry);
    retry = setTimeout(connect, delay);
  });

  ws.addEventListener("error", () => {});
}

function stop() {
  stopped = true;
  clearTimeout(retry);
  clearInterval(heartbeat);
  clearInterval(samples);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(deviceDisconnect({ deviceId, reason: "shutdown" })));
  }
  socket?.close();
}

process.on("SIGTERM", () => {
  stop();
  process.exit(0);
});
process.on("SIGINT", () => {
  stop();
  process.exit(0);
});

connect();
