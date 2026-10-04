import { createHandTracker } from "./hand-motion";
import type { HandSample } from "./hand-motion";
import { loadOpenCv } from "./opencv";

const SAMPLE_MS = 200;
const FRAME_WIDTH = 160;

/**
 * Samples the camera a few times a second and scores hand movement from 1 to 100.
 * The returned stop function resolves with one averaged sample per second.
 */
export function startHandCapture(
  stream: MediaStream,
  startedAtMs: number,
  onScore: (score: number) => void,
) {
  const source = stream.getVideoTracks()[0];
  const track = source?.clone();
  const samples: HandSample[] = [];
  let bucket: number[] = [];
  let bucketSecond = 0;
  let shown: number | null = null;
  let closed = false;
  let clearTimer = () => {};
  let closeTracker = () => {};
  let releaseVideo = () => {};

  const ready = (async () => {
    if (!track) return;
    const cv = await loadOpenCv();
    if (closed) return;
    const tracker = createHandTracker(cv);
    closeTracker = () => tracker.close();

    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    releaseVideo = () => {
      video.pause();
      video.srcObject = null;
    };
    await video.play().catch(() => {});
    if (closed) return;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    let busy = false;
    const timer = window.setInterval(() => {
      if (closed || busy || video.readyState < 2 || !video.videoWidth) return;
      busy = true;
      try {
        const height = Math.max(1, Math.round((FRAME_WIDTH * video.videoHeight) / video.videoWidth));
        canvas.width = FRAME_WIDTH;
        canvas.height = height;
        context.drawImage(video, 0, 0, FRAME_WIDTH, height);
        const frame = context.getImageData(0, 0, FRAME_WIDTH, height);
        const score = tracker.read(frame.data, FRAME_WIDTH, height);
        if (score == null) return;
        const second = Math.floor(Math.max(0, Date.now() - startedAtMs) / 1000);
        if (second !== bucketSecond) {
          flush(bucketSecond);
          bucketSecond = second;
        }
        bucket.push(score);
        shown = shown == null ? score : shown * 0.6 + score * 0.4;
        onScore(Math.min(100, Math.max(1, Math.round(shown))));
      } catch (error) {
        console.error("Hand tracking failed", error);
        window.clearInterval(timer);
      } finally {
        busy = false;
      }
    }, SAMPLE_MS);
    clearTimer = () => window.clearInterval(timer);
  })().catch((error) => {
    console.error("OpenCV failed to start", error);
  });

  function flush(second: number) {
    if (!bucket.length) return;
    const average = bucket.reduce((sum, score) => sum + score, 0) / bucket.length;
    samples.push({ timestampMs: second * 1000, handMovement: Math.min(100, Math.max(1, Math.round(average))) });
    bucket = [];
  }

  return async function stop() {
    closed = true;
    await ready;
    clearTimer();
    flush(bucketSecond);
    closeTracker();
    releaseVideo();
    track?.stop();
    return samples;
  };
}
