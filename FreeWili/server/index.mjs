import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { config as fileConfig } from "../shared/config.mjs";
import { createMovementTracker } from "../shared/movement.mjs";
import { inspectClientMessage } from "../shared/protocol.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(root, "web");
const MAX_FRAME = 4096;

const files = {
  "/": { file: join(webRoot, "index.html"), type: "text/html; charset=utf-8" },
  "/styles.css": { file: join(webRoot, "styles.css"), type: "text/css; charset=utf-8" },
  "/app.js": { file: join(webRoot, "app.js"), type: "text/javascript; charset=utf-8" },
  "/intensity-series.mjs": {
    file: join(root, "shared/intensity-series.mjs"),
    type: "text/javascript; charset=utf-8",
  },
  "/deck.mjs": {
    file: join(root, "shared/deck.mjs"),
    type: "text/javascript; charset=utf-8",
  },
  "/session.mjs": {
    file: join(root, "shared/session.mjs"),
    type: "text/javascript; charset=utf-8",
  },
  "/summary.mjs": {
    file: join(root, "shared/summary.mjs"),
    type: "text/javascript; charset=utf-8",
  },
  "/motion.mjs": {
    file: join(root, "shared/motion.mjs"),
    type: "text/javascript; charset=utf-8",
  },
  "/config.json": {
    file: join(root, "shared/config.json"),
    type: "application/json; charset=utf-8",
  },
  "/buzz.mjs": {
    file: join(root, "shared/buzz.mjs"),
    type: "text/javascript; charset=utf-8",
  },
  "/calibration.mjs": {
    file: join(root, "shared/calibration.mjs"),
    type: "text/javascript; charset=utf-8",
  },
  "/chart.js": {
    file: join(root, "node_modules/chart.js/dist/chart.umd.js"),
    type: "text/javascript; charset=utf-8",
  },
};

function sendJson(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

export async function startCoachServer(options = {}) {
  const port = options.port ?? Number(process.env.SPEAKSMART_PORT || fileConfig.serverPort);
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? fileConfig.heartbeatTimeoutMs;
  const reconnectGraceMs = options.reconnectGraceMs ?? fileConfig.reconnectGraceMs;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? fileConfig.heartbeatIntervalMs;
  const standIn = options.standIn ?? process.env.SPEAKSMART_STANDIN === "1";
  const usbBridge = options.usbBridge === true;
  const standInStdio = options.standInStdio ?? "inherit";
  const movementTracker = createMovementTracker(fileConfig.movementThreshold);

  const browsers = new Set();
  let device = null;
  let deviceId = null;
  let transport = null;
  let lastSeen = null;
  let status = "disconnected";
  let reconnectPending = false;
  let graceTimer = null;
  let heartbeatTimer = null;
  let standInChild = null;
  let usbChild = null;
  let boundPort = port;
  let session = 0;

  function linkMessage() {
    return {
      type: "link",
      timestamp: Date.now(),
      status,
      deviceId,
      transport,
      lastSeen,
      session,
    };
  }

  function sendBrowsers(message) {
    const payload = JSON.stringify(message);
    for (const browser of browsers) {
      if (browser.readyState === WebSocket.OPEN) browser.send(payload);
    }
  }

  function broadcast() {
    sendBrowsers(linkMessage());
  }

  function setDisconnected() {
    status = "disconnected";
    deviceId = null;
    transport = null;
    lastSeen = null;
    movementTracker.reset();
    broadcast();
  }

  function setConnecting() {
    status = "connecting";
    broadcast();
  }

  function setConnected(next) {
    status = "connected";
    deviceId = next.deviceId;
    transport = next.transport ?? null;
    lastSeen = next.lastSeen;
    broadcast();
  }

  function clearGrace() {
    clearTimeout(graceTimer);
    graceTimer = null;
  }

  function armGrace() {
    clearGrace();
    graceTimer = setTimeout(() => {
      if (status === "connecting" && !device) {
        reconnectPending = false;
        setDisconnected();
      }
    }, reconnectGraceMs);
  }

  function clearHeartbeat() {
    clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }

  function armHeartbeat() {
    clearHeartbeat();
    heartbeatTimer = setTimeout(() => {
      reconnectPending = false;
      const current = device;
      device = null;
      clearGrace();
      setDisconnected();
      current?.close();
    }, heartbeatTimeoutMs);
  }

  function ensureStandIn() {
    if (!standIn) return;
    if (standInChild && standInChild.exitCode === null && !standInChild.killed) return;
    const script = fileURLToPath(new URL("./dev-stand-in.mjs", import.meta.url));
    standInChild = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        SPEAKSMART_HOST: "127.0.0.1",
        SPEAKSMART_PORT: String(boundPort),
      },
      stdio: standInStdio,
    });
  }

  function ensureUsbBridge() {
    if (!usbBridge || standIn) return;
    if (usbChild && usbChild.exitCode === null && !usbChild.killed) return;
    const python = "python3";
    const probe = spawnSync(python, ["-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"]);
    if (probe.error || probe.status !== 0) {
      console.error(
        "Python 3.10 or newer is required to open the FreeWili over USB.\n" +
          "Install Python, then run:\n" +
          "  python3 -m pip install -r bridge/requirements.txt",
      );
      return;
    }
    const script = fileURLToPath(new URL("../bridge/coach_bridge.py", import.meta.url));
    usbChild = spawn(python, [script], {
      cwd: root,
      env: {
        ...process.env,
        SPEAKSMART_HOST: "127.0.0.1",
        SPEAKSMART_PORT: String(boundPort),
        PYTHONDONTWRITEBYTECODE: "1",
      },
      stdio: "inherit",
    });
  }

  function sendError(socket, result) {
    sendJson(socket, {
      type: "error",
      timestamp: Date.now(),
      code: result.code,
      for: result.type,
      message: result.message,
    });
  }

  function adoptDevice(socket, message) {
    if (device && device !== socket) {
      const previous = device;
      device = null;
      previous.close();
    }
    browsers.delete(socket);
    device = socket;
    clearGrace();
    reconnectPending = false;
    session += 1;
    movementTracker.reset();
    setConnected({
      deviceId: message.deviceId,
      transport: message.transport,
      lastSeen: message.timestamp,
    });
    sendJson(socket, { type: "welcome", timestamp: Date.now(), heartbeatIntervalMs });
    armHeartbeat();
  }

  const httpServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ok: true, status, transport }));
      return;
    }
    const entry = req.method === "GET" ? files[url.pathname] : undefined;
    if (!entry) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": entry.type, "Cache-Control": "no-store" });
    res.end(readFileSync(entry.file));
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (socket) => {
    let role = "unknown";
    const helloTimer = setTimeout(() => {
      if (role === "unknown") socket.close();
    }, 5000);

    socket.on("message", (data, isBinary) => {
      if (isBinary || data.length > MAX_FRAME) {
        sendError(socket, { code: "invalid", type: null, message: "Message is too large." });
        return;
      }
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        sendError(socket, { code: "invalid", type: null, message: "Message must be JSON." });
        return;
      }
      const result = inspectClientMessage(message);
      if (!result.ok) {
        sendError(socket, result);
        return;
      }

      if (result.type === "hello" && result.role === "browser") {
        role = "browser";
        clearTimeout(helloTimer);
        browsers.add(socket);
        sendJson(socket, linkMessage());
        return;
      }

      if (result.type === "hello" && result.role === "device") {
        role = "device";
        clearTimeout(helloTimer);
        adoptDevice(socket, message);
        return;
      }

      if (result.type === "calibration" && result.role === "browser") {
        if (role !== "browser") {
          sendError(socket, { code: "invalid", type: "calibration", message: "Send hello before other coach messages." });
          return;
        }
        if (result.clear) movementTracker.reset();
        else movementTracker.setBaseline(message.baseline);
        return;
      }

      if (result.type === "buzz" && result.role === "browser") {
        if (role !== "browser") {
          sendError(socket, { code: "invalid", type: "buzz", message: "Send hello before other coach messages." });
          return;
        }
        if (!device) {
          sendError(socket, { code: "invalid", type: "buzz", message: "No coach is connected." });
          return;
        }
        sendJson(device, {
          type: "buzz",
          frequency: message.frequency,
          duration: message.duration,
          amplitude: message.amplitude,
          timestamp: message.timestamp,
        });
        return;
      }

      if (result.type === "buzz" && result.role === "device") {
        if (socket !== device) {
          sendError(socket, { code: "invalid", type: "buzz", message: "Send hello before other coach messages." });
          return;
        }
        const ack = {
          type: "buzz",
          frequency: message.frequency,
          duration: message.duration,
          amplitude: message.amplitude,
          played: false,
          timestamp: message.timestamp,
        };
        if (typeof message.note === "string" && message.note) ack.note = message.note;
        sendBrowsers(ack);
        return;
      }

      if (result.type === "reconnect" && role === "browser") {
        reconnectPending = true;
        setConnecting();
        if (device) sendJson(device, { type: "reconnect", timestamp: Date.now() });
        else {
          ensureStandIn();
          ensureUsbBridge();
        }
        armGrace();
        return;
      }

      if (socket !== device) {
        sendError(socket, { code: "invalid", type: result.type, message: "Send hello before other coach messages." });
        return;
      }

      if (message.deviceId !== deviceId) {
        sendError(socket, { code: "invalid", type: result.type, message: "deviceId does not match this link." });
        return;
      }

      if (result.type === "heartbeat") {
        lastSeen = message.timestamp;
        if (status === "connected") broadcast();
        armHeartbeat();
        return;
      }

      if (result.type === "sensor") {
        const movement = movementTracker.sample(message.accel.x, message.accel.y, message.accel.z);
        const reading = {
          type: "sensor",
          role: "device",
          timestamp: message.timestamp,
          deviceId: message.deviceId,
          accel: {
            x: message.accel.x,
            y: message.accel.y,
            z: message.accel.z,
          },
          movement,
          magnitude: movementTracker.smoothedMagnitude,
          scored: movementTracker.scored,
        };
        if (Number.isFinite(message.accel.g)) reading.accel.g = message.accel.g;
        if (transport) reading.transport = transport;
        sendBrowsers(reading);
        return;
      }

      if (result.type === "disconnect") {
        if (message.reason === "reconnect") {
          reconnectPending = true;
          setConnecting();
          armGrace();
        } else {
          reconnectPending = false;
        }
        socket.close();
      }
    });

    socket.on("close", () => {
      clearTimeout(helloTimer);
      browsers.delete(socket);
      if (device !== socket) return;
      device = null;
      clearHeartbeat();
      if (reconnectPending) {
        setConnecting();
        armGrace();
        return;
      }
      clearGrace();
      setDisconnected();
    });

    socket.on("error", () => {});
  });

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, "0.0.0.0", resolve);
  });
  boundPort = httpServer.address().port;
  if (standIn) ensureStandIn();
  else ensureUsbBridge();

  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}/`,
    async close() {
      clearGrace();
      clearHeartbeat();
      if (standInChild && standInChild.exitCode === null) standInChild.kill("SIGTERM");
      if (usbChild && usbChild.exitCode === null) usbChild.kill("SIGTERM");
      for (const browser of browsers) browser.close();
      if (device) device.close();
      await new Promise((resolve) => {
        wss.close(() => httpServer.close(resolve));
      });
    },
  };
}

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

if (isMain()) {
  const standIn = process.env.SPEAKSMART_STANDIN === "1";
  const serial = process.env.FREEWILI_SERIAL || "FW4923";
  const app = await startCoachServer({ standIn, usbBridge: !standIn });
  console.log(`SpeakSmart coach  ${app.url}`);
  console.log(
    standIn
      ? "Development stand-in is on. It is not a FreeWili."
      : `USB bridge is on. Looking for FreeWili ${serial}.`,
  );
  const shutdown = () => {
    app.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
