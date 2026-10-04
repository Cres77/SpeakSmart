import { config } from "../shared/config.mjs";
import { deviceDisconnect, deviceHeartbeat, deviceHello } from "../shared/protocol.mjs";

/* Development stand-in. This process is not a FreeWili and does not read sensors.
 * It only opens a WebSocket and speaks hello / heartbeat / disconnect.
 */

const host = process.env.SPEAKSMART_HOST || "127.0.0.1";
const port = Number(process.env.SPEAKSMART_PORT || config.serverPort);
const deviceId = process.env.SPEAKSMART_DEVICE_ID || "dev-stand-in";
const url = `ws://${host}:${port}/ws`;

let stopped = false;
let socket = null;
let heartbeat = null;
let retry = null;
let reconnecting = false;

function connect() {
  if (stopped) return;
  const ws = new WebSocket(url);
  socket = ws;

  ws.addEventListener("open", () => {
    console.log(`development stand-in (not a FreeWili) connected as ${deviceId}`);
    ws.send(JSON.stringify(deviceHello({ deviceId, transport: "development-stand-in" })));
    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(deviceHeartbeat({ deviceId })));
      }
    }, config.heartbeatIntervalMs);
  });

  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.type !== "reconnect" || ws.readyState !== WebSocket.OPEN) return;
    reconnecting = true;
    ws.send(JSON.stringify(deviceDisconnect({ deviceId, reason: "reconnect" })));
    ws.close();
  });

  ws.addEventListener("close", () => {
    clearInterval(heartbeat);
    heartbeat = null;
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
