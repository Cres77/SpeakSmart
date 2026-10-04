type TrackProcessor = { readable: ReadableStream<VideoFrame> };
type TrackProcessorConstructor = new (init: { track: MediaStreamTrack }) => TrackProcessor;

const FALLBACK_INTERVAL_MS = 33;

/**
 * Streams camera frames to Presage while a recording is running.
 * SmartSpectra wants at least 25 fps, so frames are read straight off the camera track
 * and encoded in a worker instead of being sampled from the on-screen preview.
 */
export function startPresageCapture(
  sessionId: string,
  stream: MediaStream,
  startedAtMs: number,
  onError: (message: string) => void,
) {
  const sourceTrack = stream.getVideoTracks()[0];
  const worker = new Worker(new URL("./presage-worker.ts", import.meta.url), { type: "module" });
  const Processor = (globalThis as { MediaStreamTrackProcessor?: TrackProcessorConstructor }).MediaStreamTrackProcessor;
  const track = sourceTrack?.clone();
  let closed = false;
  let resolveStopped: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  worker.onmessage = (event: MessageEvent<{ type: string; message?: string }>) => {
    if (event.data.type === "error" && event.data.message) onError(event.data.message);
    if (event.data.type === "stopped") resolveStopped();
  };
  worker.postMessage({ type: "init", sessionId, source: Processor ? "track-processor" : "video-element" });

  let cleanup = () => {};
  if (!track) {
    onError("No camera track to send to Presage.");
  } else if (Processor) {
    const reader = new Processor({ track }).readable.getReader();
    let firstFrameUs: number | null = null;
    let firstWallUs = 0;
    void (async () => {
      while (!closed) {
        const { value: frame, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done || !frame) break;
        if (closed) {
          frame.close();
          break;
        }
        if (firstFrameUs == null) {
          firstFrameUs = frame.timestamp;
          firstWallUs = Math.max(0, (Date.now() - startedAtMs) * 1000);
        }
        const timestampUs = Math.round(firstWallUs + (frame.timestamp - firstFrameUs));
        worker.postMessage({ type: "frame", source: frame, timestampUs }, [frame]);
      }
    })();
    cleanup = () => {
      void reader.cancel().catch(() => {});
    };
  } else {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    void video.play().catch(() => {});
    let grabbing = false;
    const timer = window.setInterval(() => {
      if (closed || grabbing || video.readyState < 2) return;
      grabbing = true;
      const timestampUs = Math.max(0, Math.round((Date.now() - startedAtMs) * 1000));
      createImageBitmap(video)
        .then((bitmap) => worker.postMessage({ type: "frame", source: bitmap, timestampUs }, [bitmap]))
        .catch(() => {})
        .finally(() => {
          grabbing = false;
        });
    }, FALLBACK_INTERVAL_MS);
    cleanup = () => {
      window.clearInterval(timer);
      video.srcObject = null;
    };
  }

  return async function stop(abort = false) {
    if (closed) return;
    closed = true;
    cleanup();
    worker.postMessage({ type: "stop", abort });
    await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 15_000))]);
    track?.stop();
    worker.terminate();
  };
}
