"use client";

import { cancelSessionAction, finishRecordingAction, setShowCameraAction } from "@/app/actions";
import { deleteAsset, getAsset, putAsset, recordingKey, slideshowKey } from "@/lib/idb";
import { loadSlides, releaseSlides, type Slide } from "@/lib/slides";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";

type Phase = "preview" | "recording";

export function Studio({
  sessionId,
  title,
  slideshowName,
  initialShowCamera,
}: {
  sessionId: string;
  title: string;
  slideshowName: string | null;
  initialShowCamera: boolean;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAt = useRef<number>(0);
  const activeThumb = useRef<HTMLButtonElement | null>(null);

  const [phase, setPhase] = useState<Phase>("preview");
  const [showCamera, setShowCamera] = useState(initialShowCamera);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [slideState, setSlideState] = useState<"idle" | "loading" | "ready" | "error">(
    slideshowName ? "loading" : "idle",
  );
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [camError, setCamError] = useState<string | null>(null);
  const [streamReady, setStreamReady] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cameraWidth, setCameraWidth] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const hasDeck = Boolean(slideshowName);
  const recording = phase === "recording";

  // Load + render the deck, one image per slide.
  useEffect(() => {
    if (!slideshowName) return;
    let cancelled = false;
    let rendered: Slide[] = [];
    (async () => {
      try {
        let blob = await getAsset(slideshowKey(sessionId));
        if (!blob) {
          const pendingSlide = await getAsset(slideshowKey("pending"));
          if (pendingSlide) {
            await putAsset(slideshowKey(sessionId), pendingSlide);
            await deleteAsset(slideshowKey("pending"));
            blob = pendingSlide;
          }
        }
        if (!blob) throw new Error("missing deck");
        rendered = await loadSlides(blob, slideshowName);
        if (cancelled) {
          releaseSlides(rendered);
          return;
        }
        setSlides(rendered);
        setSlideState(rendered.length ? "ready" : "error");
      } catch {
        if (!cancelled) setSlideState("error");
      }
    })();
    return () => {
      cancelled = true;
      releaseSlides(rendered);
    };
  }, [sessionId, slideshowName]);

  // Camera + mic.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setStreamReady(true);
      } catch {
        setCamError("Camera permission is needed for the presenter preview.");
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  // The <video> can move in the layout; make sure it keeps its stream.
  useEffect(() => {
    if (videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [showCamera, hasDeck, phase, streamReady]);

  // Recording clock.
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  // Arrow keys change slides in both preview and while presenting.
  const go = useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(slides.length - 1, Math.max(0, i + delta)));
    },
    [slides.length],
  );

  useEffect(() => {
    if (!hasDeck) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        go(1);
      } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Home") {
        setIndex(0);
      } else if (e.key === "End") {
        setIndex(Math.max(0, slides.length - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasDeck, go, slides.length]);

  useEffect(() => {
    activeThumb.current?.scrollIntoView({ block: "nearest" });
  }, [index, slideState]);

  async function toggleCamera() {
    const next = !showCamera;
    setShowCamera(next);
    await setShowCameraAction(sessionId, next);
  }

  async function startRecording() {
    // Needs to run inside the click so the browser allows fullscreen.
    try {
      await rootRef.current?.requestFullscreen();
    } catch {
      // Fullscreen can be blocked; the layout still fills the window.
    }
    startedAt.current = Date.now();
    setElapsed(0);
    setIndex(0);

    const stream = streamRef.current;
    if (stream && typeof MediaRecorder !== "undefined") {
      try {
        const recorder = new MediaRecorder(stream);
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size) chunksRef.current.push(e.data);
        };
        recorder.start();
        recorderRef.current = recorder;
      } catch {
        recorderRef.current = null;
      }
    }
    setPhase("recording");
  }

  async function endRecording() {
    const duration = Math.max(1, Math.floor((Date.now() - startedAt.current) / 1000));
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      if (chunksRef.current.length) {
        await putAsset(recordingKey(sessionId), new Blob(chunksRef.current, { type: "video/webm" }));
      }
    }
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    startTransition(async () => {
      await finishRecordingAction(sessionId, duration);
    });
  }

  // Leaving the preview throws the whole session away.
  async function cancelSession() {
    setCancelling(true);
    await Promise.allSettled([
      cancelSessionAction(sessionId),
      deleteAsset(slideshowKey(sessionId)),
      deleteAsset(slideshowKey("pending")),
      deleteAsset(recordingKey(sessionId)),
    ]);
    router.push("/dashboard");
  }

  const current = slides[index];

  function cameraMaxWidth() {
    const stage = stageRef.current;
    if (!stage) return 960;
    return Math.max(160, stage.clientWidth - (hasDeck ? 40 : 32));
  }

  function onCameraResizeDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = event.currentTarget.parentElement?.offsetWidth ?? cameraWidth ?? 224;
    const max = cameraMaxWidth();
    function move(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const next = startW + Math.max(dx, dy * (16 / 9));
      setCameraWidth(Math.min(max, Math.max(160, next)));
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      ref={rootRef}
      className="relative flex h-full flex-col overflow-hidden bg-black text-white"
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-[#0a2540] px-4">
        {recording ? (
          <>
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex items-center gap-2 text-sm font-medium tabular-nums">
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
                {formatClock(elapsed)}
              </span>
              {hasDeck && slides.length ? (
                <span className="text-xs text-white/60">
                  Slide {index + 1} of {slides.length}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" className="btn btn-nav" onClick={toggleCamera}>
                {showCamera ? "Hide camera" : "Show camera"}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={endRecording}
                disabled={pending}
              >
                {pending ? "Saving…" : "End session"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={cancelSession}
                disabled={cancelling}
                className="text-sm text-white/70 hover:text-white disabled:opacity-60"
              >
                {cancelling ? "Cancelling…" : "Cancel"}
              </button>
              <span className="hidden h-4 w-px bg-white/15 sm:block" />
              <p className="truncate text-sm font-medium">Preview · {title}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {hasDeck && slides.length ? (
                <span className="mr-1 hidden text-xs text-white/60 sm:inline">
                  Slide {index + 1} of {slides.length} · use ← →
                </span>
              ) : null}
              <button type="button" className="btn btn-nav px-3 py-1.5 text-sm" onClick={toggleCamera}>
                {showCamera ? "Hide camera" : "Show camera"}
              </button>
              <button
                type="button"
                className="btn btn-accent px-3 py-1.5 text-sm"
                onClick={startRecording}
                disabled={cancelling}
              >
                Start recording
              </button>
            </div>
          </>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Google Slides–style filmstrip (preview only). */}
        {hasDeck && !recording ? (
          <nav
            aria-label="Slides"
            className="w-44 shrink-0 space-y-3 overflow-x-hidden overflow-y-auto border-r border-white/10 bg-[#0e1726] p-3"
          >
            {slideState === "loading" ? (
              <p className="text-xs text-white/50">Rendering slides…</p>
            ) : null}
            {slides.map((slide, i) => (
              <button
                key={slide.src}
                ref={i === index ? activeThumb : undefined}
                type="button"
                onClick={() => setIndex(i)}
                className="flex w-full min-w-0 items-start gap-2 text-left"
              >
                <span className="w-4 shrink-0 pt-1 text-right text-[11px] text-white/50">{i + 1}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slide.src}
                  alt={`Slide ${i + 1}`}
                  className={`aspect-video min-w-0 flex-1 rounded-sm bg-white object-contain ${
                    i === index ? "ring-2 ring-[#7a73ff]" : "opacity-80 ring-1 ring-white/15 hover:opacity-100"
                  }`}
                />
              </button>
            ))}
          </nav>
        ) : null}

        <div
          ref={stageRef}
          className={`relative min-w-0 flex-1 ${
            hasDeck ? (recording ? "bg-black" : "bg-[#1b2433]") : "bg-black"
          }`}
        >
          {hasDeck ? (
            <div
              className={`absolute inset-0 flex items-center justify-center ${recording ? "" : "p-8"}`}
            >
              {current ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={current.src}
                  alt={`Slide ${index + 1}`}
                  className={`max-h-full max-w-full bg-white object-contain ${
                    recording ? "" : "shadow-2xl"
                  }`}
                />
              ) : (
                <p className="text-sm text-white/60">
                  {slideState === "error"
                    ? "Couldn't read this deck. Upload a PDF or image."
                    : "Rendering slides…"}
                </p>
              )}
            </div>
          ) : null}

          <div
            className={
              showCamera
                ? `absolute z-10 overflow-hidden shadow-2xl ${
                    hasDeck
                      ? "right-5 bottom-5 rounded-lg border border-white/25"
                      : "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg"
                  }`
                : "hidden"
            }
            style={showCamera ? { width: cameraWidth ?? (hasDeck ? 224 : "min(80%, 960px)"), aspectRatio: "16 / 9" } : undefined}
          >
            <video ref={videoRef} autoPlay muted playsInline className="h-full w-full object-cover" />
            {showCamera ? (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize camera"
                onPointerDown={onCameraResizeDown}
                className="absolute right-0 bottom-0 z-20 h-6 w-6 cursor-nwse-resize touch-none"
              >
                <span className="absolute right-1.5 bottom-1.5 block h-2.5 w-2.5 border-r-2 border-b-2 border-white drop-shadow" />
              </div>
            ) : null}
          </div>

          {!hasDeck && !showCamera ? (
            <div className="grid h-full place-items-center text-sm text-white/50">Camera hidden</div>
          ) : null}

          {camError ? (
            <p className="absolute bottom-4 left-4 z-20 rounded-lg bg-black/70 px-3 py-2 text-sm text-rose-200">
              {camError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatClock(total: number) {
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
