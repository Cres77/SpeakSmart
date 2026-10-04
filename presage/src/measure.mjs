import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FrameTransform,
  PixelFormat,
  ProcessingStatus,
  SmartSpectraErrorCode,
  SmartSpectraLogLevel,
  SmartSpectraSDK,
  ValidationCode,
  breathingMetrics,
  cardioMetrics,
  decodeMetrics,
} from "@smartspectra/node-sdk";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW_HTML = resolve(ROOT, "src/preview.html");
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT || 3847);

loadDotEnv(resolve(ROOT, ".env"));

const processingNames = invertEnum(ProcessingStatus);
const validationNames = invertEnum(ValidationCode);
const errorNames = invertEnum(SmartSpectraErrorCode);

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function invertEnum(obj) {
  const out = {};
  for (const [name, value] of Object.entries(obj)) {
    if (typeof value === "number") out[value] = name;
  }
  return out;
}

function log(section, message, extra) {
  const time = new Date().toISOString();
  if (extra === undefined) {
    console.log(`[${time}] [${section}] ${message}`);
    return;
  }
  console.log(`[${time}] [${section}] ${message}`, extra);
}

function last(arr) {
  return Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : undefined;
}

function pick(obj, ...keys) {
  if (!obj) return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

function fmtNumber(value, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return value.toFixed(digits);
}

function fmtMeasurement(sample) {
  if (!sample) return "waiting";
  const value = pick(sample, "value");
  const confidence = pick(sample, "confidence");
  const stable = pick(sample, "stable");
  return `${fmtNumber(value)} (quality/confidence=${fmtNumber(confidence)}%, stable=${stable ?? "n/a"})`;
}

function fmtHrv(sample) {
  if (!sample) return "waiting";
  const rmssd = pick(sample, "rmssd");
  const sdnn = pick(sample, "sdnn");
  const meanNn = pick(sample, "meanNn", "mean_nn");
  const confidence = pick(sample, "confidence");
  const stable = pick(sample, "stable");
  return `rmssd=${fmtNumber(rmssd, 2)} ms, sdnn=${fmtNumber(sdnn, 2)} ms, meanNN=${fmtNumber(meanNn, 2)} ms (quality/confidence=${fmtNumber(confidence)}%, stable=${stable ?? "n/a"})`;
}

function nowUs() {
  return Number(process.hrtime.bigint() / 1000n);
}

function listCameras() {
  log("camera", "Discovering cameras (no API key required)...");
  const cameras = SmartSpectraSDK.availableCameras();
  if (!cameras.length) {
    log("camera", "No cameras found. Check that a webcam is connected and not used by another app.");
    return cameras;
  }
  log("camera", `Found ${cameras.length} camera(s):`);
  for (const camera of cameras) {
    console.log(
      `  - id=${camera.id}  name=${camera.name ?? "unnamed"}  facing=${camera.facing}  lens=${camera.lensType}`,
    );
  }
  return cameras;
}

function requireApiKey() {
  const apiKey = process.env.PRESAGE_API_KEY?.trim();
  if (apiKey) return apiKey;
  console.error("Missing PRESAGE_API_KEY.");
  console.error(`Copy ${resolve(ROOT, ".env.example")} to ${resolve(ROOT, ".env")} and paste your key after PRESAGE_API_KEY=`);
  process.exit(1);
}

function openBrowser(url) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function startPreviewServer({ onFrame, getLatestUi }) {
  const clients = new Set();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PREVIEW_PORT}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(readFileSync(PREVIEW_HTML));
      return;
    }

    if (req.method === "GET" && url.pathname === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`data: ${JSON.stringify(getLatestUi())}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (req.method === "POST" && url.pathname === "/frame") {
      const width = Number(req.headers["x-width"]);
      const height = Number(req.headers["x-height"]);
      const body = await readBody(req);
      try {
        onFrame(body, width, height);
        res.writeHead(204);
        res.end();
      } catch (err) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(String(err?.message || err));
      }
      return;
    }

    res.writeHead(404);
    res.end("not found");
  });

  function pushUi() {
    const payload = `data: ${JSON.stringify(getLatestUi())}\n\n`;
    for (const client of clients) client.write(payload);
  }

  return new Promise((resolveStart, reject) => {
    server.on("error", reject);
    server.listen(PREVIEW_PORT, "127.0.0.1", () => {
      resolveStart({ server, pushUi });
    });
  });
}

async function startMeasurement() {
  const apiKey = requireApiKey();
  listCameras();

  log("sdk", `Package version: ${SmartSpectraSDK.version}`);
  log("sdk", "Initializing SmartSpectraSDK...");

  const sdk = new SmartSpectraSDK({
    apiKey,
    requestedMetrics: [...breathingMetrics, ...cardioMetrics],
    logLevel: SmartSpectraLogLevel.kInfo,
  });

  log("sdk", "SDK constructed. Requested breathing + cardio metrics.");

  const ui = {
    hint: "Waiting for the browser camera…",
    metrics: "Waiting for metrics…",
  };
  let pushUi = () => {};
  let lastValidationKey = "";
  let lastValidationAt = 0;
  let framesAccepted = 0;

  sdk.on("processingStatus", (status) => {
    log("processing", `${processingNames[status] ?? status} (${status})`);
  });

  sdk.on("validationStatus", (code, timestampUs, hint) => {
    const name = validationNames[code] ?? String(code);
    const key = `${code}:${hint || ""}`;
    const now = Date.now();
    const isNew = key !== lastValidationKey;
    if (!isNew && now - lastValidationAt < 5000) return;
    lastValidationKey = key;
    lastValidationAt = now;

    if (code === ValidationCode.kOk) {
      ui.hint = "OK — signal looks usable. Stay still for metrics.";
      log("validation", `OK — signal looks usable. Waiting for metrics. (${name})`);
    } else {
      ui.hint = `${hint || name}  [${name}]`;
      log("validation", `${ui.hint}  (positioning hint, not a crash)`);
    }
    pushUi();
  });

  sdk.on("metrics", (buf, timestampUs) => {
    const decoded = decodeMetrics(buf);
    if (Buffer.isBuffer(decoded)) {
      log("metrics", `Received ${decoded.length} bytes at ${timestampUs} µs but decodeMetrics returned a raw buffer.`);
      return;
    }

    const pulse = last(pick(decoded?.cardio, "pulseRate", "pulse_rate"));
    const breathing = last(pick(decoded?.breathing, "rate"));
    const hrv = last(pick(decoded?.cardio, "hrv"));
    const lines = [
      `pulse_rate_bpm:      ${fmtMeasurement(pulse)}`,
      `breathing_rate_brpm: ${fmtMeasurement(breathing)}`,
      `hrv:                 ${fmtHrv(hrv)}`,
    ];
    ui.metrics = lines.join("\n");
    log("metrics", `timestamp=${timestampUs} µs`);
    for (const line of lines) console.log(`  ${line}`);
    pushUi();
  });

  sdk.on("error", (code, message, retryable) => {
    log(
      "error",
      `${errorNames[code] ?? code} (${code}): ${message} retryable=${retryable}`,
    );
    ui.hint = `Presage error: ${message}`;
    pushUi();
  });

  let previewServer;
  try {
    log("camera", "Using browser webcam preview, then sending frames into SmartSpectra.");
    sdk.useCustomInput(FrameTransform.kNone);
    sdk.start();
    log("sdk", "start() returned. Waiting for browser frames.");

    const preview = await startPreviewServer({
      getLatestUi: () => ui,
      onFrame(body, width, height) {
        if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
          throw new Error("invalid frame size");
        }
        if (body.length < width * height * 4) {
          throw new Error(`frame too small: got ${body.length} bytes for ${width}x${height}`);
        }
        sdk.sendFrame(body, width, height, width * 4, PixelFormat.kRGBA, nowUs());
        framesAccepted += 1;
        if (framesAccepted === 1 || framesAccepted % 150 === 0) {
          log("camera", `Accepted ${framesAccepted} preview frame(s) at ${width}x${height}.`);
        }
      },
    });
    previewServer = preview.server;
    pushUi = preview.pushUi;

    const previewUrl = `http://127.0.0.1:${PREVIEW_PORT}/`;
    log("camera", `Opening camera preview: ${previewUrl}`);
    openBrowser(previewUrl);
    ui.hint = "Allow the camera in the browser window that just opened.";
    pushUi();
    log("camera", "Press Ctrl+C to stop and release the camera.");
  } catch (err) {
    log("error", `Failed to start: ${err?.message || err}`);
    await sdk.destroy();
    previewServer?.close();
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log("sdk", `Received ${signal}. Stopping and releasing camera...`);
    previewServer?.close();
    try {
      await sdk.stopAsync();
      log("sdk", "stopAsync() finished.");
    } catch (err) {
      log("error", `stopAsync failed: ${err?.message || err}`);
    }
    try {
      await sdk.destroy();
      log("sdk", "destroy() finished. Camera/SDK released.");
    } catch (err) {
      log("error", `destroy failed: ${err?.message || err}`);
    }
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

const args = process.argv.slice(2);
if (args.includes("--list-cameras")) {
  try {
    listCameras();
  } catch (err) {
    console.error("Camera discovery failed:", err?.message || err);
    process.exit(1);
  }
} else {
  await startMeasurement();
}
