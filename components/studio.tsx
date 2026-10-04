"use client";

import { cancelSessionAction, finishRecordingAction, prepareAudienceQuestionsAction, setShowCameraAction } from "@/app/actions";
import { startHandCapture } from "@/lib/hand-capture";
import type { HandSample } from "@/lib/hand-motion";
import { startFreewiliLink, type FreewiliLink, type FreewiliReport } from "@/lib/freewili-link";
import { audienceQaKey, deleteAsset, freewiliMotionKey, getAsset, handMotionKey, putAsset, recordingKey, slideshowKey } from "@/lib/idb";
import { loadOpenCv } from "@/lib/opencv";
import { startPresageCapture } from "@/lib/presage-capture";
import { createRecordingMix, type RecordingMix } from "@/lib/recording-mix";
import { compressSlideImages, extractDeckText, loadSlides, releaseSlides, type Slide } from "@/lib/slides";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent } from "react";

type Phase = "preview" | "recording";
type QaBeat = "off" | "preparing" | "asking" | "answering" | "error";
type SpokenQuestion = { text: string; voice: string; audioBase64: string };

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
  const mixRef = useRef<RecordingMix | null>(null);
  const startedAt = useRef<number>(0);
  const activeThumb = useRef<HTMLButtonElement | null>(null);
  const endingRef = useRef(false);
  const qaRunning = useRef(false);
  const qaArmed = useRef(false);
  const qaStartedMs = useRef<number | null>(null);
  const qaChunkStart = useRef<number | null>(null);
  const presentationTranscript = useRef("");
  const questionsRef = useRef<{ text: string; voice: string }[]>([]);
  const advanceRef = useRef<(() => void) | null>(null);
  const questionSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const qaBeatRef = useRef<QaBeat>("off");
  const presageStopRef = useRef<((abort?: boolean) => Promise<unknown>) | null>(null);
  const handsStopRef = useRef<(() => Promise<HandSample[]>) | null>(null);
  const freewiliRef = useRef<FreewiliLink | null>(null);

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
  const [qaBeat, setQaBeat] = useState<QaBeat>("off");
  const [qaIndex, setQaIndex] = useState(0);
  const [qaQuestions, setQaQuestions] = useState<SpokenQuestion[]>([]);
  const [qaError, setQaError] = useState<string | null>(null);
  const [presageHint, setPresageHint] = useState<string | null>(null);
  const [handScore, setHandScore] = useState<number | null>(null);
  const [freewiliConnected, setFreewiliConnected] = useState(false);
  const [audienceQa, setAudienceQa] = useState(false);
  const [pending, startTransition] = useTransition();

  qaBeatRef.current = qaBeat;

  useEffect(() => {
    const link = startFreewiliLink(setFreewiliConnected);
    freewiliRef.current = link;
    return () => {
      freewiliRef.current = null;
      link.close();
    };
  }, []);

  const hasDeck = Boolean(slideshowName);
  const recording = phase === "recording";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pendingChoice = await getAsset<string>(audienceQaKey("pending"));
      if (pendingChoice === "1" || pendingChoice === "0") {
        await putAsset(audienceQaKey(sessionId), pendingChoice);
        await deleteAsset(audienceQaKey("pending"));
        if (!cancelled) setAudienceQa(pendingChoice === "1");
        return;
      }
      const saved = await getAsset<string>(audienceQaKey(sessionId));
      if (!cancelled) setAudienceQa(saved === "1");
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

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
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
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
      void handsStopRef.current?.();
      handsStopRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      mixRef.current?.close();
      mixRef.current = null;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  useEffect(() => {
    void loadOpenCv().catch(() => {});
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
      if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
      if (qaBeatRef.current !== "off" && e.key === " ") return;
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
    // Resume audio in this click, before any await, so the mixed recording is not silent.
    const stream = streamRef.current;
    mixRef.current?.close();
    let mix: RecordingMix | null = null;
    try {
      mix = stream ? createRecordingMix(stream) : null;
    } catch {
      mix = null;
    }
    mixRef.current = mix;
    const resume = mix?.context.resume();

    // Needs to run inside the click so the browser allows fullscreen.
    try {
      await rootRef.current?.requestFullscreen();
    } catch {
      // Fullscreen can be blocked; the layout still fills the window.
    }
    await resume;
    startedAt.current = Date.now();
    setElapsed(0);
    setIndex(0);

    const recordStream = mix?.recordStream ?? stream;
    if (recordStream && typeof MediaRecorder !== "undefined") {
      try {
        const mimeType = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(
          (type) => MediaRecorder.isTypeSupported(type),
        );
        const recorder = mimeType ? new MediaRecorder(recordStream, { mimeType }) : new MediaRecorder(recordStream);
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
    if (stream) {
      presageStopRef.current = startPresageCapture(sessionId, stream, startedAt.current, setPresageHint);
      setHandScore(null);
      handsStopRef.current = startHandCapture(stream, startedAt.current, (score) => {
        setHandScore((current) => (current === score ? current : score));
      });
    }
    try {
      freewiliRef.current?.begin();
    } catch {
      // Recording continues when the bridge is missing.
    }
    setPhase("recording");
  }

  async function endRecording() {
    if (endingRef.current) return;
    endingRef.current = true;
    let movement: FreewiliReport | null = null;
    try {
      movement = freewiliRef.current?.end() ?? null;
    } catch {
      movement = null;
    }
    const stopPresage = presageStopRef.current;
    presageStopRef.current = null;
    const stopHands = handsStopRef.current;
    handsStopRef.current = null;
    const handSamples = stopHands ? stopHands() : Promise.resolve([]);
    if (stopPresage) await stopPresage(false);
    const hands = await handSamples;
    if (hands.length) await putAsset(handMotionKey(sessionId), JSON.stringify(hands));
    if (movement) {
      try {
        await putAsset(freewiliMotionKey(sessionId), JSON.stringify(movement));
      } catch {
        // A missing movement summary does not block the recording.
      }
    }
    advanceRef.current?.();
    advanceRef.current = null;
    stopQuestionAudio();

    const duration = Math.max(1, Math.floor((Date.now() - startedAt.current) / 1000));
    const qa = qaArmed.current
      ? {
          startedMs: qaStartedMs.current ?? 0,
          presentationTranscript: presentationTranscript.current,
          questions: questionsRef.current,
          qaAudio: qaAudioFile(),
        }
      : null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      const recordedType = recorder.mimeType || "video/webm";
      if (chunksRef.current.length) {
        await putAsset(recordingKey(sessionId), new Blob(chunksRef.current, { type: recordedType }));
      }
    }
    mixRef.current?.close();
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    const recordedType = recorder?.mimeType || "video/webm";
    const recordingBlob = chunksRef.current.length
      ? new Blob(chunksRef.current, { type: recordedType })
      : null;
    startTransition(async () => {
      const video = recordingBlob ? recordingFile(recordingBlob) : null;
      await finishRecordingAction(sessionId, duration, video, qa);
    });
  }

  function qaAudioFile() {
    const mix = mixRef.current;
    const start = qaChunkStart.current;
    if (!mix || start == null) return null;
    const wav = mix.wavFrom(start);
    if (wav.size <= 44) return null;
    return new File([wav], "answers.wav", { type: "audio/wav" });
  }

  function stopQuestionAudio() {
    const source = questionSourceRef.current;
    questionSourceRef.current = null;
    if (!source) return;
    try {
      source.stop();
    } catch {
      // Already finished.
    }
    const mix = mixRef.current;
    if (mix) mix.micGain.gain.value = 1;
  }

  function advanceQuestion() {
    advanceRef.current?.();
    advanceRef.current = null;
  }

  async function startAudienceQa() {
    if (qaRunning.current || endingRef.current || pending) return;
    qaRunning.current = true;
    setQaError(null);
    setQaBeat("preparing");
    const mix = mixRef.current;
    void mix?.context.resume();
    const chunkAtClick = mix ? mix.chunkCount() : 0;
    const clockAtClick = Math.max(0, Date.now() - startedAt.current);

    try {
      const form = new FormData();
      if (mix) {
        const wav = mix.wavFrom(0, chunkAtClick);
        if (wav.size > 44) form.set("audio", new File([wav], "presentation.wav", { type: "audio/wav" }));
      }
      let deckText = "";
      if (slideshowName) {
        const deck = await getAsset(slideshowKey(sessionId));
        if (deck) deckText = await extractDeckText(deck, slideshowName);
      }
      form.set("deckText", deckText.slice(0, 12000));
      if (deckText.trim().length < 80 && slides.length) {
        const images = await compressSlideImages(slides);
        for (const image of images) form.append("slide", image);
      }
      if (endingRef.current) return;

      const result = await prepareAudienceQuestionsAction(sessionId, form);
      if (endingRef.current) return;
      if (!result.ok) {
        setQaError(explainQuestionError(result.error));
        setQaBeat("error");
        return;
      }

      presentationTranscript.current = result.presentationTranscript;
      questionsRef.current = result.questions.map((question) => ({ text: question.text, voice: question.voice }));
      qaChunkStart.current = chunkAtClick;
      qaStartedMs.current = clockAtClick;
      qaArmed.current = true;
      setQaQuestions(result.questions);
      setQaIndex(0);
      await playSequence(result.questions);
    } catch (error) {
      if (!endingRef.current) {
        setQaError(explainQuestionError(error instanceof Error ? error.message : ""));
        setQaBeat("error");
      }
    } finally {
      qaRunning.current = false;
    }
  }

  async function playSequence(questions: SpokenQuestion[]) {
    for (let i = 0; i < questions.length; i += 1) {
      if (endingRef.current) return;
      setQaIndex(i);
      setQaBeat("asking");
      const mix = mixRef.current;
      if (questions[i].audioBase64) {
        try {
          if (mix) await playMixedQuestion(mix, questions[i].audioBase64);
          else await playSpeakerQuestion(questions[i].audioBase64);
        } catch (error) {
          console.error(error);
        }
      }
      if (endingRef.current) return;
      setQaBeat("answering");
      if (i < questions.length - 1) {
        await new Promise<void>((resolve) => {
          advanceRef.current = resolve;
        });
      }
    }
  }

  async function replayQuestion() {
    const question = qaQuestions[qaIndex];
    if (!question?.audioBase64 || endingRef.current) return;
    setQaBeat("asking");
    try {
      const mix = mixRef.current;
      if (mix) await playMixedQuestion(mix, question.audioBase64);
      else await playSpeakerQuestion(question.audioBase64);
    } catch (error) {
      console.error(error);
    }
    if (!endingRef.current) setQaBeat("answering");
  }

  function playMixedQuestion(mix: RecordingMix, audioBase64: string) {
    return mix.context.decodeAudioData(bytesFromBase64(audioBase64).slice(0)).then(
      (audioBuffer) =>
        new Promise<void>((resolve) => {
          const source = mix.context.createBufferSource();
          questionSourceRef.current = source;
          source.buffer = audioBuffer;
          source.connect(mix.destination);
          source.connect(mix.context.destination);
          source.onended = () => {
            if (questionSourceRef.current === source) questionSourceRef.current = null;
            window.setTimeout(() => {
              const now = mix.context.currentTime;
              mix.micGain.gain.cancelScheduledValues(now);
              mix.micGain.gain.setValueAtTime(mix.micGain.gain.value, now);
              mix.micGain.gain.linearRampToValueAtTime(1, now + 0.08);
              resolve();
            }, 140);
          };
          const now = mix.context.currentTime;
          mix.micGain.gain.cancelScheduledValues(now);
          mix.micGain.gain.setValueAtTime(mix.micGain.gain.value, now);
          mix.micGain.gain.linearRampToValueAtTime(0, now + 0.04);
          source.start();
        }),
    );
  }

  // Leaving the preview throws the whole session away.
  async function cancelSession() {
    setCancelling(true);
    const stopPresage = presageStopRef.current;
    presageStopRef.current = null;
    const stopHands = handsStopRef.current;
    handsStopRef.current = null;
    if (stopPresage) await stopPresage(true).catch(() => {});
    if (stopHands) await stopHands().catch(() => {});
    await Promise.allSettled([
      cancelSessionAction(sessionId),
      deleteAsset(slideshowKey(sessionId)),
      deleteAsset(slideshowKey("pending")),
      deleteAsset(recordingKey(sessionId)),
      deleteAsset(audienceQaKey(sessionId)),
      deleteAsset(audienceQaKey("pending")),
      deleteAsset(handMotionKey(sessionId)),
      deleteAsset(freewiliMotionKey(sessionId)),
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
              {handScore != null ? (
                <span className="text-xs text-white/70 tabular-nums">Hands {handScore}</span>
              ) : null}
              <FreewiliStatus connected={freewiliConnected} />
              {presageHint ? <span className="max-w-sm truncate text-xs text-rose-200">{presageHint}</span> : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" className="btn btn-nav" onClick={toggleCamera}>
                {showCamera ? "Hide camera" : "Show camera"}
              </button>
              {qaBeat === "asking" || qaBeat === "answering" ? (
                qaBeat === "answering" && qaIndex < qaQuestions.length - 1 ? (
                  <button type="button" className="btn btn-nav" onClick={advanceQuestion}>
                    Next question
                  </button>
                ) : (
                  <span className="text-xs text-white/70">
                    Question {qaIndex + 1} of {qaQuestions.length}
                  </span>
                )
              ) : qaBeat === "preparing" ? (
                <span className="text-xs text-white/70">Writing questions…</span>
              ) : qaBeat === "error" ? (
                <span className="text-xs font-medium text-rose-200">Questions failed</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    if (audienceQa) void startAudienceQa();
                    else void endRecording();
                  }}
                  disabled={pending}
                >
                  {pending ? "Saving…" : audienceQa ? "Stop presentation" : "End session"}
                </button>
              )}
              {qaBeat === "preparing" || qaBeat === "asking" || qaBeat === "answering" ? (
                <button type="button" className="btn btn-danger" onClick={endRecording} disabled={pending}>
                  {pending ? "Saving…" : "End session"}
                </button>
              ) : null}
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
              <FreewiliStatus connected={freewiliConnected} />
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
              {audienceQa ? <span className="text-xs text-white/60">Q&A at the end</span> : null}
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

          {qaBeat !== "off" ? (
            <div className="absolute inset-x-0 top-4 z-30 flex justify-center px-4">
              <div className="w-full max-w-xl rounded-xl bg-[#0a2540]/95 p-4 shadow-2xl ring-1 ring-white/15">
                {qaBeat === "preparing" ? (
                  <>
                    <p className="text-sm font-medium">Writing audience questions</p>
                    <p className="mt-1 text-sm text-white/70">
                      Recording stays on. Three questions from this talk will be asked out loud, then you answer.
                    </p>
                  </>
                ) : null}
                {qaBeat === "error" ? (
                  <div role="alert" className="rounded-lg bg-rose-950 px-3 py-3">
                    <p className="text-sm font-medium text-rose-100">Audience questions didn’t start</p>
                    <p className="mt-2 text-sm leading-5 text-white">{qaError}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className="btn btn-nav px-3 py-1.5 text-sm" onClick={() => void startAudienceQa()}>
                        Try again
                      </button>
                      <button type="button" className="btn btn-danger px-3 py-1.5 text-sm" onClick={endRecording} disabled={pending}>
                        {pending ? "Saving…" : "End session"}
                      </button>
                    </div>
                  </div>
                ) : null}
                {qaBeat === "asking" || qaBeat === "answering" ? (
                  <>
                    <p className="text-xs tracking-wide text-white/50 uppercase">
                      {qaQuestions[qaIndex]?.voice ?? "Audience"} · question {qaIndex + 1} of {qaQuestions.length}
                    </p>
                    <p className="mt-2 text-lg leading-snug">{qaQuestions[qaIndex]?.text}</p>
                    <p className="mt-2 text-sm text-white/70">
                      {qaBeat === "asking" ? "Playing the question…" : "Your answer is being recorded."}
                    </p>
                    {qaBeat === "answering" ? (
                      <div className="mt-3 flex gap-2">
                        <button type="button" className="btn btn-nav px-3 py-1.5 text-sm" onClick={() => void replayQuestion()}>
                          Replay
                        </button>
                        {qaIndex < qaQuestions.length - 1 ? (
                          <button type="button" className="btn btn-accent px-3 py-1.5 text-sm" onClick={advanceQuestion}>
                            Next question
                          </button>
                        ) : (
                          <button type="button" className="btn btn-danger px-3 py-1.5 text-sm" onClick={endRecording} disabled={pending}>
                            {pending ? "Saving…" : "End session"}
                          </button>
                        )}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function explainQuestionError(message: string) {
  const text = message.trim();
  if (/unexpected end of form/i.test(text) || /body exceeded/i.test(text)) {
    return "The talk was too large to send, so the questions could not be written. End the session, or try again after a shorter presentation.";
  }
  if (!text || /server components render/i.test(text) || /failed to fetch/i.test(text)) {
    return "Audience questions failed before they could be written. Check the Gemini and ElevenLabs keys, then try again.";
  }
  return text;
}

function playSpeakerQuestion(audioBase64: string) {
  const url = URL.createObjectURL(new Blob([bytesFromBase64(audioBase64)], { type: "audio/mpeg" }));
  const audio = new Audio(url);
  return audio.play().then(
    () =>
      new Promise<void>((resolve) => {
        audio.onended = () => {
          URL.revokeObjectURL(url);
          resolve();
        };
      }),
  );
}

function bytesFromBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function recordingFile(blob: Blob) {
  const type = blob.type || "video/webm";
  const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
  return new File([blob], `recording.${ext}`, { type });
}

function FreewiliStatus({ connected }: { connected: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-white/55">
      <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-white/30"}`} />
      {connected ? "FreeWili connected" : "FreeWili not connected"}
    </span>
  );
}

function formatClock(total: number) {
  const m = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const s = (total % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
