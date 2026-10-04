/// <reference lib="webworker" />

type FrameSource = VideoFrame | ImageBitmap;
type Queued = { source: FrameSource; timestampUs: number };
type Encoded = { blob: Blob; timestampUs: number };

const TARGET_WIDTH = 640;
const MAX_QUEUE = 12;
const FLUSH_MS = 400;

const scope = self as unknown as DedicatedWorkerGlobalScope;
const canvas = new OffscreenCanvas(TARGET_WIDTH, 360);
const context = canvas.getContext("2d");
const queue: Queued[] = [];
const encoded: Encoded[] = [];
const stats = {
  received: 0,
  encoded: 0,
  dropped: 0,
  sent: 0,
  uploads: 0,
  failedUploads: 0,
  width: 0,
  height: 0,
  source: "",
  startedAt: Date.now(),
  lastError: "",
};
let sessionId = "";
let pumping = false;
let chain: Promise<void> = Promise.resolve();
let flushTimer: ReturnType<typeof setInterval> | null = null;
let reported = false;
let stopped = false;

scope.onmessage = (event: MessageEvent) => {
  const message = event.data as
    | { type: "init"; sessionId: string; source: string }
    | { type: "frame"; source: FrameSource; timestampUs: number }
    | { type: "stop"; abort: boolean };
  if (message.type === "init") {
    sessionId = message.sessionId;
    stats.source = message.source;
    flushTimer = setInterval(() => void flush(false, false), FLUSH_MS);
    return;
  }
  if (message.type === "frame") {
    stats.received += 1;
    if (stopped || queue.length >= MAX_QUEUE) {
      message.source.close();
      stats.dropped += 1;
      return;
    }
    queue.push({ source: message.source, timestampUs: message.timestampUs });
    void pump();
    return;
  }
  if (message.type === "stop") void stop(message.abort);
};

async function pump() {
  if (pumping || !context) return;
  pumping = true;
  try {
    while (queue.length) {
      const item = queue.shift()!;
      const sourceWidth = "displayWidth" in item.source ? item.source.displayWidth : item.source.width;
      const sourceHeight = "displayHeight" in item.source ? item.source.displayHeight : item.source.height;
      const width = Math.min(TARGET_WIDTH, sourceWidth);
      const height = Math.round((width * sourceHeight) / sourceWidth / 2) * 2;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      stats.width = sourceWidth;
      stats.height = sourceHeight;
      context.drawImage(item.source, 0, 0, width, height);
      item.source.close();
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
      stats.encoded += 1;
      encoded.push({ blob, timestampUs: item.timestampUs });
    }
  } finally {
    pumping = false;
  }
}

function flush(abort: boolean, final: boolean) {
  const frames = encoded.splice(0, encoded.length).sort((a, b) => a.timestampUs - b.timestampUs);
  if (!frames.length && !abort && !final) return chain;
  chain = chain.then(() => send(frames, abort, final)).catch((error: unknown) => {
    stats.failedUploads += 1;
    report(error instanceof Error ? error.message : "Presage frame upload failed.");
  });
  return chain;
}

async function send(frames: Encoded[], abort: boolean, final: boolean) {
  const form = new FormData();
  form.set("sessionId", sessionId);
  if (abort) form.set("abort", "1");
  if (final || stats.uploads === 0 || stats.uploads % 25 === 0) {
    const seconds = Math.max(1, (Date.now() - stats.startedAt) / 1000);
    form.set("stats", JSON.stringify({ ...stats, final, fps: Number((stats.received / seconds).toFixed(1)) }));
  }
  for (const frame of frames) {
    form.append("frame", new File([frame.blob], "frame.jpg", { type: "image/jpeg" }));
    form.append("timestampUs", String(frame.timestampUs));
  }
  stats.uploads += 1;
  stats.sent += frames.length;
  const response = await fetch("/api/presage/frames", { method: "POST", body: form });
  const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
  if (!response.ok || payload?.ok === false) {
    stats.failedUploads += 1;
    report(payload?.error || `Presage frame upload failed (${response.status}).`);
  }
}

function report(message: string) {
  stats.lastError = message;
  if (reported) return;
  reported = true;
  scope.postMessage({ type: "error", message });
}

async function stop(abort: boolean) {
  stopped = true;
  if (flushTimer) clearInterval(flushTimer);
  if (abort) {
    for (const item of queue.splice(0, queue.length)) item.source.close();
  } else {
    while (pumping || queue.length) {
      await pump();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  await flush(abort, true);
  scope.postMessage({ type: "stopped" });
}
