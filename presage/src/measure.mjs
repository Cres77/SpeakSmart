import { createServer } from "node:http";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CameraSelection,
  PixelFormat,
  ProcessingStatus,
  SmartSpectraErrorCode,
  SmartSpectraLogLevel,
  SmartSpectraSDK,
  ValidationCode,
  breathingMetrics,
  cardioMetrics,
} from "@smartspectra/node-sdk";
import { decodeMetrics } from "@smartspectra/node-sdk/messages";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW_HTML = resolve(ROOT, "src/preview.html");
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT || 3847);
const LOG_DIR = resolve(ROOT, "logs");
const LOG_FILE = resolve(LOG_DIR, "presage.log");

mkdirSync(LOG_DIR, { recursive: true });
const logStream = createWriteStream(LOG_FILE, { flags: "w" });
let lastConsoleKey = "";
let lastConsoleCount = 0;

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

function formatExtra(extra) {
  if (extra === undefined) return "";
  if (typeof extra === "string") return ` ${extra}`;
  try {
    return ` ${JSON.stringify(extra)}`;
  } catch {
    return ` ${String(extra)}`;
  }
}

function flushRepeatedLog() {
  if (lastConsoleCount <= 1) return;
  const summary = `  ↳ repeated ${lastConsoleCount - 1} more time(s)`;
  console.log(summary);
  logStream.write(`${summary}\n`);
}

function closeLog() {
  flushRepeatedLog();
  logStream.end();
}

function writeLogLine(line) {
  logStream.write(`${line}\n`);
}

function logFile(section, message, extra) {
  const time = new Date().toISOString();
  writeLogLine(`[${time}] [${section}] ${message}${formatExtra(extra)}`);
}

function log(section, message, extra) {
  const time = new Date().toISOString();
  const line = `[${time}] [${section}] ${message}${formatExtra(extra)}`;
  writeLogLine(line);

  const key = `${section}\0${message}${formatExtra(extra)}`;
  if (key === lastConsoleKey) {
    lastConsoleCount += 1;
    return;
  }
  flushRepeatedLog();
  lastConsoleKey = key;
  lastConsoleCount = 1;
  console.log(line);
}

function last(arr) {
  return Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : undefined;
}

function fmtNumber(value, digits = 1) {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return value.toFixed(digits);
}

function readyNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function extractVitals(metrics) {
  const pulse = last(metrics?.cardio?.pulseRate);
  const breathing = last(metrics?.breathing?.rate);
  const hrv = last(metrics?.cardio?.hrv);
  return {
    pulseValue: pulse?.value,
    pulseConfidence: pulse?.confidence,
    breathingValue: breathing?.value,
    breathingConfidence: breathing?.confidence,
    hrvRmssd: hrv?.rmssd,
    hrvConfidence: hrv?.confidence,
    hrvStable: hrv?.stable,
  };
}

function emptyMetricCache() {
  return { value: undefined, at: 0, confidence: undefined, confidenceAt: 0, extra: undefined };
}

function rememberMetric(cache, value, confidence, extra, now) {
  if (readyNumber(value)) {
    cache.value = value;
    cache.at = now;
  }
  if (readyNumber(confidence)) {
    cache.confidence = confidence;
    cache.confidenceAt = now;
  }
  if (extra !== undefined) cache.extra = extra;
}

function formatCachedValue(cache, now, suffix) {
  const ageMs = now - cache.at;
  if (!readyNumber(cache.value) || !cache.at || ageMs > 60_000) return "collecting...";
  const ageSec = Math.round(ageMs / 1000);
  const stale = ageSec >= 15 ? ", recent" : "";
  return `${fmtNumber(cache.value)}${suffix} (${ageSec}s ago${stale})`;
}

function formatCachedConfidence(cache, now) {
  const ageMs = now - cache.confidenceAt;
  if (!readyNumber(cache.confidence) || !cache.confidenceAt || ageMs > 60_000) return "collecting...";
  return fmtNumber(cache.confidence);
}

function sampleRawLuma(buf, width, height, stride, pixelFormat) {
  let ySum = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let n = 0;
  const step = 8;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const [r, g, b] = readRgb(buf, width, height, stride, pixelFormat, x, y);
      rSum += r;
      gSum += g;
      bSum += b;
      ySum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n += 1;
    }
  }
  if (!n) return { y: 0, r: 0, g: 0, b: 0 };
  return { y: ySum / n, r: rSum / n, g: gSum / n, b: bSum / n };
}

const REQUESTED_CAPTURE = Object.freeze({
  width: 1280,
  height: 720,
  fps: 30,
});

function listCameras() {
  log("camera", "Discovering cameras via SmartSpectraSDK.availableCameras()...");
  log(
    "camera",
    "SDK CameraInfo fields are only: id, name, facing, lensType. No formats, resolution, or FPS list is exposed.",
  );
  const cameras = SmartSpectraSDK.availableCameras();
  if (!cameras.length) {
    log("camera", "No cameras found. Check that a webcam is connected and not used by another app.");
    return cameras;
  }
  log("camera", `Found ${cameras.length} camera(s):`);
  for (const camera of cameras) {
    console.log(`  - ${JSON.stringify({
      id: camera.id,
      name: camera.name ?? null,
      facing: camera.facing,
      lensType: camera.lensType,
    })}`);
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

function clampByte(value) {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

function yuvToRgb(y, u, v) {
  const c = y - 16;
  const d = u - 128;
  const e = v - 128;
  return [
    clampByte((298 * c + 409 * e + 128) >> 8),
    clampByte((298 * c - 100 * d - 208 * e + 128) >> 8),
    clampByte((298 * c + 516 * d + 128) >> 8),
  ];
}

function readRgb(buf, width, height, stride, pixelFormat, x, y) {
  if (pixelFormat === PixelFormat.kBGR) {
    const i = y * stride + x * 3;
    return [buf[i + 2], buf[i + 1], buf[i]];
  }
  if (pixelFormat === PixelFormat.kRGB) {
    const i = y * stride + x * 3;
    return [buf[i], buf[i + 1], buf[i + 2]];
  }
  if (pixelFormat === PixelFormat.kBGRA) {
    const i = y * stride + x * 4;
    return [buf[i + 2], buf[i + 1], buf[i]];
  }
  if (pixelFormat === PixelFormat.kRGBA) {
    const i = y * stride + x * 4;
    return [buf[i], buf[i + 1], buf[i + 2]];
  }
  if (pixelFormat === PixelFormat.kNV12 || pixelFormat === PixelFormat.kNV21) {
    const yVal = buf[y * stride + x];
    const uvRow = height + Math.floor(y / 2);
    const uvIndex = uvRow * stride + (x & ~1);
    const u = pixelFormat === PixelFormat.kNV12 ? buf[uvIndex] : buf[uvIndex + 1];
    const v = pixelFormat === PixelFormat.kNV12 ? buf[uvIndex + 1] : buf[uvIndex];
    return yuvToRgb(yVal, u, v);
  }
  if (pixelFormat === PixelFormat.kYUYV) {
    const i = y * stride + x * 2;
    const yVal = buf[i];
    const u = buf[i - (x % 2) * 2 + 1];
    const v = buf[i - (x % 2) * 2 + 3];
    return yuvToRgb(yVal, u, v);
  }
  return [0, 0, 0];
}

function frameToRgba(buf, width, height, stride, pixelFormat) {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = readRgb(buf, width, height, stride, pixelFormat, x, y);
      const destX = width - 1 - x;
      const dest = (y * width + destX) * 4;
      out[dest] = r;
      out[dest + 1] = g;
      out[dest + 2] = b;
      out[dest + 3] = 255;
    }
  }
  return out;
}

function startPreviewServer({ getLatestUi, getPreviewFrame }) {
  const clients = new Set();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PREVIEW_PORT}`);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(readFileSync(PREVIEW_HTML));
      return;
    }

    if (req.method === "GET" && url.pathname === "/preview.rgba") {
      const frame = getPreviewFrame();
      if (!frame) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Width": String(frame.width),
        "X-Height": String(frame.height),
        "Content-Length": frame.rgba.length,
      });
      res.end(frame.rgba);
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

  log("sdk", `Writing full log to ${LOG_FILE}`);
  log("sdk", `Package version: ${SmartSpectraSDK.version}`);
  log("sdk", "Initializing SmartSpectraSDK...");

  const sdk = new SmartSpectraSDK({
    apiKey,
    requestedMetrics: [...breathingMetrics, ...cardioMetrics],
    logLevel: SmartSpectraLogLevel.kInfo,
  });

  log("sdk", "SDK constructed. Requested breathing + cardio metrics.");

  const ui = {
    hint: "Waiting for SDK camera frames…",
    metrics: "Waiting for metrics…",
    resolution: "waiting",
    fps: "waiting",
  };
  let pushUi = () => {};
  let lastValidationKey = "";
  let lastValidationAt = 0;
  let lastProcessingStatus = sdk.processingStatus;
  let videoFrames = 0;
  let videoFpsWindowStart = Date.now();
  let lastVideoSize = "";
  let latestPreviewFrame = null;
  let lastPreviewAt = 0;
  let lastStatusPrint = 0;
  let lastValidationLabel = "collecting...";
  let lastValidationOk = false;
  const pulseCache = emptyMetricCache();
  const breathingCache = emptyMetricCache();
  const hrvCache = emptyMetricCache();
  const LUMA_AT_SEC = [0, 1, 2, 3, 5, 10];
  let lumaStartedAt = 0;
  let nextLumaIndex = 0;

  function printStatus() {
    const now = Date.now();
    const fps = ui.fps === "waiting" ? "collecting..." : ui.fps;
    const signal = lastValidationOk ? "OK" : lastValidationLabel === "collecting..."
      ? "collecting..."
      : "positioning/motion issue";
    const block = [
      "PRESAGE STATUS",
      "---------------",
      `FPS: ${fps}`,
      `Validation: ${lastValidationLabel}`,
      `Signal: ${signal}`,
      `Pulse: ${formatCachedValue(pulseCache, now, " bpm")}`,
      `Breathing: ${formatCachedValue(breathingCache, now, "/min")}`,
      `Pulse confidence: ${formatCachedConfidence(pulseCache, now)}`,
      `Breathing confidence: ${formatCachedConfidence(breathingCache, now)}`,
      `HRV RMSSD: ${formatCachedValue(hrvCache, now, " ms")}`,
      `HRV confidence: ${formatCachedConfidence(hrvCache, now)}`,
      `HRV stable: ${typeof hrvCache.extra === "boolean" && now - hrvCache.at <= 60_000 ? hrvCache.extra : "collecting..."}`,
    ].join("\n");
    ui.metrics = block;
    console.log(`\n${block}\n`);
    logFile("metrics-display", block.replaceAll("\n", " | "));
    pushUi();
  }

  sdk.on("processingStatus", (status) => {
    lastProcessingStatus = status;
    log("processing", `${processingNames[status] ?? status} (${status})`);
  });

  sdk.on("validationStatus", (code, timestampUs, hint) => {
    const name = validationNames[code] ?? String(code);
    const key = `${code}:${hint || ""}`;
    const now = Date.now();
    const isNew = key !== lastValidationKey;
    const isFpsWarning = code === ValidationCode.kFrameRateTooLow;
    const gapMs = isFpsWarning ? 2000 : 5000;
    if (!isNew && now - lastValidationAt < gapMs) return;
    lastValidationKey = key;
    lastValidationAt = now;

    if (code === ValidationCode.kOk) {
      lastValidationLabel = "OK";
      lastValidationOk = true;
      ui.hint = "OK — signal looks usable. Stay still for metrics.";
      logFile("validation", `OK (${name}) hint="${hint || ""}" at ${timestampUs} µs`);
    } else {
      lastValidationLabel = hint || name;
      lastValidationOk = false;
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

    const incoming = extractVitals(decoded);
    const now = Date.now();
    rememberMetric(pulseCache, incoming.pulseValue, incoming.pulseConfidence, undefined, now);
    rememberMetric(breathingCache, incoming.breathingValue, incoming.breathingConfidence, undefined, now);
    rememberMetric(hrvCache, incoming.hrvRmssd, incoming.hrvConfidence, incoming.hrvStable, now);
    logFile(
      "metrics",
      `received ts=${timestampUs} pulse=${incoming.pulseValue ?? "none"} breathing=${incoming.breathingValue ?? "none"} hrvRmssd=${incoming.hrvRmssd ?? "none"}`,
    );
    if (now - lastStatusPrint >= 1000) {
      lastStatusPrint = now;
      printStatus();
    }
  });

  sdk.on("error", (code, message, retryable) => {
    const statusNow = sdk.processingStatus;
    log(
      "error",
      `${errorNames[code] ?? "unknown"} (${code}): ${message} retryable=${retryable}`,
    );
    log(
      "error",
      `processingStatus immediately before=${processingNames[lastProcessingStatus] ?? lastProcessingStatus} (${lastProcessingStatus}) now=${processingNames[statusNow] ?? statusNow} (${statusNow})`,
    );
    ui.hint = `Presage error ${errorNames[code] ?? code}: ${message}`;
    pushUi();
  });

  sdk.on("videoOutput", (buf, width, height, stride, pixelFormat, timestampUs) => {
    videoFrames += 1;
    const size = `${width}x${height} stride=${stride} format=${pixelFormat} bytes=${buf.length}`;
    if (size !== lastVideoSize) {
      lastVideoSize = size;
      ui.resolution = `${width}x${height}`;
      log("camera", `videoOutput first/changed frame: ${size} ts=${timestampUs} µs`);
      pushUi();
    }
    const now = Date.now();
    if (!lumaStartedAt) lumaStartedAt = now;
    const lumaAgeSec = (now - lumaStartedAt) / 1000;
    if (nextLumaIndex < LUMA_AT_SEC.length && lumaAgeSec >= LUMA_AT_SEC[nextLumaIndex]) {
      const mark = LUMA_AT_SEC[nextLumaIndex];
      const luma = sampleRawLuma(buf, width, height, stride, pixelFormat);
      const line = `${mark.toFixed(1)}s: Y=${luma.y.toFixed(1)} R=${luma.r.toFixed(1)} G=${luma.g.toFixed(1)} B=${luma.b.toFixed(1)}`;
      if (nextLumaIndex === 0) {
        log("luminance", "FRAME LUMINANCE from raw videoOutput (not preview-adjusted)");
      }
      log("luminance", line);
      nextLumaIndex += 1;
    }
    if (now - lastPreviewAt >= 80) {
      try {
        latestPreviewFrame = {
          width,
          height,
          rgba: frameToRgba(buf, width, height, stride, pixelFormat),
        };
        lastPreviewAt = now;
      } catch (err) {
        log("error", `preview convert failed: ${err?.message || err}`);
      }
    }
    const elapsed = now - videoFpsWindowStart;
    if (elapsed >= 2000) {
      const fps = (videoFrames * 1000) / elapsed;
      ui.fps = fps.toFixed(1);
      logFile("camera", `videoOutput measured FPS=${fps.toFixed(1)} over ${elapsed}ms (${videoFrames} frames)`);
      videoFrames = 0;
      videoFpsWindowStart = now;
      pushUi();
    }
  });

  let previewServer;
  try {
    const cameras = listCameras();
    const cameraId = process.env.CAMERA_ID?.trim();
    const selected = cameraId
      ? cameras.find((camera) => camera.id === cameraId)
      : cameras[0];
    const selection = cameraId
      ? CameraSelection.byId(cameraId)
      : CameraSelection.default;

    log("camera", cameraId
      ? `Selecting CameraSelection.byId(${cameraId})`
      : "Selecting CameraSelection.default");
    if (selected) {
      log("camera", `Matched discovered camera: name=${selected.name ?? "unnamed"} id=${selected.id} facing=${selected.facing} lens=${selected.lensType}`);
    } else if (cameraId) {
      log("camera", `CAMERA_ID was set but did not match a discovered camera. SDK will still request that id.`);
    }
    log(
      "camera",
      `Requesting useCamera options width=${REQUESTED_CAPTURE.width} height=${REQUESTED_CAPTURE.height} fps=${REQUESTED_CAPTURE.fps}`,
    );
    log(
      "camera",
      "SDK CameraOptions are only width, height, fps, frameTransform. No exposure, gain, brightness, or white-balance controls.",
    );

    const preview = await startPreviewServer({
      getLatestUi: () => ui,
      getPreviewFrame: () => latestPreviewFrame,
    });
    previewServer = preview.server;
    pushUi = preview.pushUi;

    sdk.useCamera(selection, REQUESTED_CAPTURE);
    sdk.start();
    log("sdk", `start() returned. processingStatus=${processingNames[sdk.processingStatus] ?? sdk.processingStatus} (${sdk.processingStatus})`);
    setTimeout(() => {
      if (!latestPreviewFrame) {
        log("camera", "No videoOutput frames yet, so the preview image is still blank. The SDK still owns the webcam.");
      }
    }, 5000);

    const previewUrl = `http://127.0.0.1:${PREVIEW_PORT}/`;
    log("camera", `Opening SDK camera preview: ${previewUrl}`);
    openBrowser(previewUrl);
    ui.hint = "Live preview is the SDK camera feed. Sit so face + upper chest are visible.";
    pushUi();
    log("camera", "Press Ctrl+C to stop and release the camera.");
  } catch (err) {
    log("error", `Failed to start: ${err?.message || err} code=${err?.code} retryable=${err?.retryable}`);
    if (err?.code === SmartSpectraErrorCode.kInputUnavailable || /inputunavailable/i.test(String(err?.message))) {
      console.error("The requested camera/mode did not open. Discovered cameras:");
      listCameras();
    }
    await sdk.destroy();
    previewServer?.close();
    closeLog();
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
    closeLog();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

const args = process.argv.slice(2);
if (args.includes("--list-cameras")) {
  try {
    listCameras();
    closeLog();
  } catch (err) {
    console.error("Camera discovery failed:", err?.message || err);
    closeLog();
    process.exit(1);
  }
} else {
  await startMeasurement();
}
