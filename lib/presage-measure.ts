import type { SmartSpectraSDK } from "@smartspectra/node-sdk";
import { presageLog, presageLogPath } from "./presage-log";
import type { SessionFrame } from "./schema";

export type PresageMeasureResult = {
  frames: Omit<SessionFrame, "id" | "sessionId">[];
  note: string | null;
};

type Sample = {
  timestampMs: number;
  pulseBpm: number | null;
  breathingRpm: number | null;
  hrvMs: number | null;
  expression: string | null;
};

type LiveMeasurement = {
  sdk: SmartSpectraSDK;
  samples: Sample[];
  lastUs: number;
  error: string | null;
  framesIn: number;
  framesThrough: number;
  framesDropped: number;
  metricEvents: number;
  lastSeenAt: number;
  validation: Record<string, number>;
  restarts: number;
  restartPending: boolean;
  windowStartedAt: number;
  windowFrames: number;
};

const MAX_RESTARTS = 3;

type PresageStore = {
  lives: Map<string, LiveMeasurement>;
  failures: Map<string, string>;
  starting: Map<string, Promise<LiveMeasurement>>;
  requests: Map<string, number>;
};

// The frames route and the finishing server action can load separate copies of this module.
const store = ((globalThis as { __speaksmartPresage?: PresageStore }).__speaksmartPresage ??= {
  lives: new Map(),
  failures: new Map(),
  starting: new Map(),
  requests: new Map(),
});
const { lives, failures, starting, requests } = store;
const STALE_MS = 30_000;

export function notePresageRequest(sessionId: string, detail: Record<string, unknown>) {
  const count = (requests.get(sessionId) ?? 0) + 1;
  requests.set(sessionId, count);
  if (count <= 3 || count % 10 === 0) presageLog(sessionId, "frames-request", { request: count, ...detail });
}

/**
 * The browser already owns the webcam, so Presage cannot open it again.
 * MediaRecorder files also come back as "input unavailable".
 * Frames grabbed from the preview are pushed here instead.
 */
export async function ingestPresageFrames(
  sessionId: string,
  frames: { bytes: Buffer; timestampUs: number }[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const live = await liveMeasurement(sessionId);
    live.lastSeenAt = Date.now();
    if (live.error) return { ok: false, error: live.error };
    const jpeg = await import("jpeg-js");
    const { PixelFormat } = await import("@smartspectra/node-sdk");
    for (const frame of frames) {
      if (live.restartPending) await restartPipeline(live, sessionId);
      if (live.error) return { ok: false, error: live.error };
      const timestampUs = frame.timestampUs;
      if (timestampUs <= live.lastUs) continue;
      live.lastUs = timestampUs;
      const decoded = jpeg.decode(frame.bytes, { useTArray: true, formatAsRGBA: true });
      if (live.framesIn === 0) {
        presageLog(sessionId, "first-frame", { width: decoded.width, height: decoded.height, timestampUs });
      }
      live.framesIn += 1;
      live.windowFrames += 1;
      try {
        live.sdk.sendFrame(decoded.data, decoded.width, decoded.height, decoded.width * 4, PixelFormat.kRGBA, timestampUs);
      } catch (error) {
        if (live.restartPending) continue;
        throw error;
      }
    }
    const elapsed = Date.now() - live.windowStartedAt;
    if (elapsed >= 10_000) {
      presageLog(sessionId, "throughput", {
        fps: Number(((live.windowFrames * 1000) / elapsed).toFixed(1)),
        framesIn: live.framesIn,
        framesThrough: live.framesThrough,
        framesDropped: live.framesDropped,
        metricEvents: live.metricEvents,
      });
      live.windowStartedAt = Date.now();
      live.windowFrames = 0;
    }
    return { ok: true };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = friendlyPresageError(raw || "Presage could not read the camera.");
    const live = lives.get(sessionId);
    if (live) live.error = message;
    else failures.set(sessionId, message);
    presageLog(sessionId, "ingest-failed", { message: raw, code: (error as { code?: unknown })?.code ?? null });
    return { ok: false, error: message.slice(0, 280) };
  }
}

export async function finishLivePresage(
  sessionId: string,
  durationSeconds: number,
  qaStartedMs: number | null,
): Promise<PresageMeasureResult | null> {
  const pendingStart = starting.get(sessionId);
  if (pendingStart) await pendingStart.catch(() => null);
  const live = lives.get(sessionId);
  const earlier = failures.get(sessionId) ?? null;
  const requestCount = requests.get(sessionId) ?? 0;
  failures.delete(sessionId);
  requests.delete(sessionId);
  if (!live) {
    presageLog(sessionId, "finish-without-measurement", { frameRequests: requestCount, earlierError: earlier });
    return {
      frames: [],
      note:
        earlier ??
        (requestCount
          ? `Presage got ${requestCount} frame uploads but never started measuring. See ${presageLogPath(sessionId)}.`
          : "No camera frames reached Presage during this recording. Keep the camera preview on while you record."),
    };
  }
  lives.delete(sessionId);
  await shutdown(live, sessionId);
  const summary = {
    frameRequests: requestCount,
    framesIn: live.framesIn,
    framesThrough: live.framesThrough,
    framesDropped: live.framesDropped,
    metricEvents: live.metricEvents,
    samples: live.samples.length,
    validation: live.validation,
    error: live.error,
  };
  presageLog(sessionId, "finish", summary);
  if (live.error) return { frames: [], note: live.error };
  if (!live.samples.length) {
    return {
      frames: [],
      note: `Presage read ${live.framesIn} frames but returned no vitals. ${validationHint(live.validation)}`.trim(),
    };
  }
  const frames = framesFromSamples(live.samples, durationSeconds, qaStartedMs);
  presageLog(sessionId, "frames-saved", { seconds: frames.length, samples: live.samples });
  return { frames, note: null };
}

export async function abortLivePresage(sessionId: string) {
  failures.delete(sessionId);
  requests.delete(sessionId);
  const live = lives.get(sessionId);
  if (!live) return;
  lives.delete(sessionId);
  presageLog(sessionId, "aborted", { framesIn: live.framesIn });
  await shutdown(live, sessionId);
}

async function liveMeasurement(sessionId: string) {
  const existing = lives.get(sessionId);
  if (existing) return existing;
  const pending = starting.get(sessionId);
  if (pending) return pending;
  const next = startMeasurement(sessionId).finally(() => starting.delete(sessionId));
  starting.set(sessionId, next);
  return next;
}

async function startMeasurement(sessionId: string) {
  for (const [otherId, other] of lives) {
    if (Date.now() - other.lastSeenAt < STALE_MS) {
      throw new Error("Presage is already measuring another recording in this app.");
    }
    lives.delete(otherId);
    presageLog(otherId, "stale-measurement-closed", { framesIn: other.framesIn });
    await shutdown(other, otherId);
  }
  const key = process.env.PRESAGE_API_KEY?.trim();
  if (!key) throw new Error("Add PRESAGE_API_KEY to .env.local to measure this recording.");

  const {
    FrameTransform,
    ProcessingStatus,
    SmartSpectraLogLevel,
    SmartSpectraSDK,
    ValidationCode,
    breathingMetrics,
    cardioMetrics,
    decodeMetrics,
  } = await import("@smartspectra/node-sdk");
  const statusName = nameOf(ProcessingStatus);
  const validationName = nameOf(ValidationCode);
  const samples: Sample[] = [];
  // Same metric set as the presage/ reference; face metrics (landmarks, blinking) are not needed for vitals.
  const requestedMetrics = [...breathingMetrics, ...cardioMetrics];
  const sdk = new SmartSpectraSDK({
    apiKey: key,
    requestedMetrics,
    logLevel: SmartSpectraLogLevel.kInfo,
  });
  const live: LiveMeasurement = {
    sdk,
    samples,
    lastUs: 0,
    error: null,
    framesIn: 0,
    framesThrough: 0,
    framesDropped: 0,
    metricEvents: 0,
    lastSeenAt: Date.now(),
    validation: {},
    restarts: 0,
    restartPending: false,
    windowStartedAt: Date.now(),
    windowFrames: 0,
  };
  presageLog(sessionId, "start", { requestedMetrics });
  sdk.on("error", (code, message, retryable) => {
    const willRestart = retryable && live.restarts < MAX_RESTARTS;
    presageLog(sessionId, "sdk-error", { code, message, retryable, willRestart, framesIn: live.framesIn });
    if (willRestart) live.restartPending = true;
    else live.error = friendlyPresageError(message || "Presage stopped reading the camera.");
  });
  sdk.on("processingStatus", (status) => {
    presageLog(sessionId, "processing-status", { status, name: statusName(status) });
    if (status === ProcessingStatus.kError && !live.error && !live.restartPending) {
      live.error = "Presage stopped reading the camera.";
    }
  });
  let lastValidation = -1;
  sdk.on("validationStatus", (code, timestampUs, hint) => {
    const name = validationName(code);
    live.validation[name] = (live.validation[name] ?? 0) + 1;
    if (code !== lastValidation) presageLog(sessionId, "validation", { code, name, hint, timestampUs });
    lastValidation = code;
  });
  sdk.on("frameSentThrough", (sent) => {
    if (sent) live.framesThrough += 1;
    else live.framesDropped += 1;
  });
  sdk.on("metrics", (buf, timestampUs) => {
    live.metricEvents += 1;
    const decoded = decodeMetrics(buf);
    if (Buffer.isBuffer(decoded)) {
      presageLog(sessionId, "metrics-undecoded", { bytes: buf.length, timestampUs });
      return;
    }
    const payload = toPlain(decoded) as MetricsPayload;
    const sample = sampleFromMetrics(payload, timestampUs);
    samples.push(sample);
    presageLog(sessionId, "metrics", { timestampUs, sample, raw: withoutLandmarks(payload) });
  });
  sdk.useCustomInput(FrameTransform.kNone);
  try {
    sdk.start();
  } catch (error) {
    presageLog(sessionId, "start-failed", {
      message: error instanceof Error ? error.message : String(error),
      code: (error as { code?: unknown })?.code ?? null,
    });
    await shutdown(live, sessionId);
    throw error;
  }
  presageLog(sessionId, "started", { status: statusName(sdk.processingStatus) });
  lives.set(sessionId, live);
  return live;
}

async function restartPipeline(live: LiveMeasurement, sessionId: string) {
  live.restartPending = false;
  live.restarts += 1;
  try {
    await live.sdk.stopAsync().catch(() => {});
    live.sdk.reset();
    const { FrameTransform } = await import("@smartspectra/node-sdk");
    live.sdk.useCustomInput(FrameTransform.kNone);
    live.sdk.start();
    presageLog(sessionId, "restarted", { restart: live.restarts, framesIn: live.framesIn });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    presageLog(sessionId, "restart-failed", { restart: live.restarts, message });
    live.error = friendlyPresageError(message || "Presage stopped and could not restart.");
  }
}

function nameOf(table: Record<string, number>) {
  const names = new Map(Object.entries(table).map(([name, value]) => [value, name]));
  return (value: number) => names.get(value) ?? String(value);
}

function validationHint(validation: Record<string, number>) {
  const worst = Object.entries(validation)
    .filter(([name]) => name !== "kOk")
    .sort((a, b) => b[1] - a[1])[0];
  if (!worst) return "";
  const hints: Record<string, string> = {
    kNoFaceFound: "It mostly could not find a face.",
    kChestNotVisible: "It mostly could not see your upper chest.",
    kTooDark: "The room was too dark.",
    kTooBright: "The image was too bright.",
    kExcessiveMotion: "There was too much motion.",
    kFrameRateTooLow: "The frame rate was too low.",
    kFaceTooFar: "Your face was too far from the camera.",
    kFaceTooClose: "Your face was too close to the camera.",
    kFaceNotCentered: "Your face was off center.",
  };
  return hints[worst[0]] ?? `Most common status: ${worst[0]}.`;
}

function toPlain(message: unknown) {
  return JSON.parse(JSON.stringify(message, (_key, value) => (typeof value === "bigint" ? Number(value) : value)));
}

function withoutLandmarks(payload: MetricsPayload) {
  const face = payload.face as (MetricsPayload["face"] & { landmarks?: unknown[] }) | undefined;
  if (!face?.landmarks) return payload;
  return { ...payload, face: { ...face, landmarks: `<${face.landmarks.length} landmark sets>` } };
}

async function shutdown(live: LiveMeasurement, sessionId: string) {
  try {
    await live.sdk.stopAsync();
  } catch {
    // The pipeline may already be stopped.
  }
  try {
    await live.sdk.destroy();
  } catch (error) {
    presageLog(sessionId, "shutdown-failed", { message: error instanceof Error ? error.message : String(error) });
  }
}

function friendlyPresageError(message: string) {
  if (/input is unavailable/i.test(message)) {
    return "Presage could not use this camera input. Keep your face in the preview and record again.";
  }
  return message.slice(0, 280);
}

type MetricPoint = { value?: number };
type MetricsPayload = {
  breathing?: { rate?: MetricPoint[] };
  cardio?: { pulseRate?: MetricPoint[]; hrv?: { rmssd?: number }[] };
  face?: { expression?: unknown[] };
};

function sampleFromMetrics(metrics: MetricsPayload, timestampUs: number): Sample {
  const pulse = last(metrics.cardio?.pulseRate);
  const breathing = last(metrics.breathing?.rate);
  const hrv = last(metrics.cardio?.hrv);
  return {
    timestampMs: Math.max(0, Math.round(timestampUs / 1000)),
    pulseBpm: num(pulse?.value),
    breathingRpm: num(breathing?.value),
    hrvMs: num(hrv?.rmssd),
    expression: expressionLabel(last(metrics.face?.expression)),
  };
}

function framesFromSamples(samples: Sample[], durationSeconds: number, qaStartedMs: number | null) {
  const lastMs = samples.reduce((max, sample) => Math.max(max, sample.timestampMs), 0);
  const seconds = Math.max(Math.round(durationSeconds), Math.ceil(lastMs / 1000));
  const frames: Omit<SessionFrame, "id" | "sessionId">[] = [];
  let pulse: number | null = null;
  let breath: number | null = null;
  let hrv: number | null = null;
  let expression: string | null = null;
  let cursor = 0;

  for (let sec = 0; sec <= seconds; sec += 1) {
    const end = (sec + 1) * 1000;
    while (cursor < samples.length && samples[cursor].timestampMs < end) {
      const sample = samples[cursor];
      if (sample.pulseBpm != null) pulse = sample.pulseBpm;
      if (sample.breathingRpm != null) breath = sample.breathingRpm;
      if (sample.hrvMs != null) hrv = sample.hrvMs;
      if (sample.expression) expression = sample.expression;
      cursor += 1;
    }
    frames.push({
      timestampMs: sec * 1000,
      pulseBpm: pulse,
      breathingRpm: breath,
      hrvMs: hrv,
      gazeScore: null,
      postureScore: null,
      expression,
      segment: qaStartedMs != null && sec * 1000 >= qaStartedMs ? "questions" : "presentation",
    });
  }
  return frames;
}

function last<T>(list: T[] | undefined) {
  if (!list?.length) return undefined;
  return list[list.length - 1];
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(1)) : null;
}

const EXPRESSION_TYPES = ["", "angry", "contempt", "disgust", "fear", "happy", "neutral", "sad", "surprise"];

function expressionLabel(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const scores = (raw as { scores?: { type?: unknown; confidence?: unknown }[] }).scores;
  if (!Array.isArray(scores)) return null;
  let best: { label: string; confidence: number } | null = null;
  for (const score of scores) {
    const label =
      typeof score.type === "number" ? EXPRESSION_TYPES[score.type] : String(score.type ?? "").toLowerCase();
    const confidence = typeof score.confidence === "number" ? score.confidence : 0;
    if (!label || label === "unspecified") continue;
    if (!best || confidence > best.confidence) best = { label, confidence };
  }
  return best?.label ?? null;
}
