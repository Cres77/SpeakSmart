"use client";

import { transcribeSessionAction, writeCoachingAction } from "@/app/actions";
import { buildSessionSuggestions, sessionScores } from "@/lib/analysis-coach";
import { DeleteSessionButton } from "@/components/delete-session-button";
import { parseFreewiliReport, type FreewiliReport } from "@/lib/freewili-link";
import { handAt, handMovementNote, type HandSample } from "@/lib/hand-motion";
import { freewiliMotionKey, getAsset, handMotionKey, recordingKey } from "@/lib/idb";
import type { PracticeSession, SessionFrame, Suggestion } from "@/lib/schema";
import { AUDIENCE_QUESTIONS_MARKER } from "@/lib/transcript-marker";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";

export function AnalysisView({
  session,
  frames,
}: {
  session: PracticeSession;
  frames: SessionFrame[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState(session.transcript ?? "");
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const transcribeStarted = useRef(false);
  const coachStarted = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rowRef = useRef<HTMLTableRowElement>(null);
  const [coachNotes, setCoachNotes] = useState<Suggestion[]>(
    (session.suggestions ?? []).filter((item) => item.id.startsWith("coach2-")),
  );
  const [coachState, setCoachState] = useState<"idle" | "writing" | "ready" | "error">("idle");
  const [coachError, setCoachError] = useState<string | null>(null);
  const [hands, setHands] = useState<HandSample[]>([]);
  const [freewili, setFreewili] = useState<FreewiliReport | null>(null);
  const frame = frames[selected] ?? frames[0];

  async function transcribe(blob: Blob) {
    setTranscribing(true);
    setTranscribeError(null);
    const data = new FormData();
    const type = blob.type || "video/webm";
    const ext = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : "webm";
    data.set("audio", new File([blob], `recording.${ext}`, { type }));
    const result = await transcribeSessionAction(session.id, data);
    setTranscribing(false);
    if (result.ok) setTranscript(result.text);
    else setTranscribeError(result.error);
  }

  useEffect(() => {
    let url: string | null = null;
    (async () => {
      const blob = await getAsset(recordingKey(session.id));
      if (!blob) return;
      setRecording(blob);
      url = URL.createObjectURL(blob);
      setVideoUrl(url);
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [session.id]);

  useEffect(() => {
    void getAsset<string>(handMotionKey(session.id)).then((raw) => {
      if (typeof raw !== "string") return;
      try {
        const parsed = JSON.parse(raw) as HandSample[];
        if (Array.isArray(parsed)) setHands(parsed.filter((sample) => Number.isFinite(sample.handMovement)));
      } catch {
        setHands([]);
      }
    });
  }, [session.id]);

  useEffect(() => {
    void getAsset<string>(freewiliMotionKey(session.id)).then((raw) => {
      if (typeof raw !== "string") {
        setFreewili(null);
        return;
      }
      setFreewili(parseFreewiliReport(raw));
    });
  }, [session.id]);

  useEffect(() => {
    if (!recording || transcript || transcribeStarted.current) return;
    transcribeStarted.current = true;
    void transcribe(recording);
  }, [recording, transcript]);

  const durationMs = Math.max(session.durationSeconds * 1000, frames.at(-1)?.timestampMs ?? 0);
  const suggestions = useMemo(
    () =>
      buildSessionSuggestions({
        frames,
        transcript,
        durationSeconds: session.durationSeconds,
        qaStartedMs: session.qaStartedMs,
        note: frames.length ? null : session.suggestions?.find((item) => item.id === "presage-note")?.body,
      }),
    [frames, transcript, session.durationSeconds, session.qaStartedMs, session.suggestions],
  );
  const scores = useMemo(
    () => sessionScores({ frames, transcript, durationSeconds: session.durationSeconds }),
    [frames, transcript, session.durationSeconds],
  );
  const tips = (coachNotes.length ? coachNotes : suggestions).slice(0, 10);
  const handNote = useMemo(() => handMovementNote(hands), [hands]);
  const showGaze = frames.some((row) => row.gazeScore != null);
  const showPosture = frames.some((row) => row.postureScore != null);
  const columnCount = 5 + Number(showGaze) + Number(showPosture) + Number(hands.length > 0);
  const charts = useMemo(() => {
    const series = chartSeries(frames);
    if (!hands.length) return series;
    return [
      ...series,
      {
        label: "Hands",
        unit: "/100",
        points: frames.map((item) => ({ t: item.timestampMs, v: handAt(hands, item.timestampMs) })),
      },
    ];
  }, [frames, hands]);

  useEffect(() => {
    if (!frames.length || coachNotes.length || coachStarted.current) return;
    coachStarted.current = true;
    setCoachState("writing");
    void writeCoachingAction(session.id).then((result) => {
      if (result.ok) {
        setCoachNotes(result.notes);
        setCoachState("ready");
      } else {
        setCoachError(result.error);
        setCoachState("error");
      }
    });
  }, [frames.length, coachNotes.length, session.id]);

  function showFrame(index: number) {
    const next = frames[index];
    if (!next) return;
    setSelected(index);
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    const seek = () => {
      video.currentTime = next.timestampMs / 1000;
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
  }

  useEffect(() => {
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/dashboard" className="text-sm text-[var(--muted)] hover:text-[var(--fg)]">
            Exit
          </Link>
          <span className="hidden h-4 w-px bg-[var(--border)] sm:block" />
          <p className="truncate text-sm font-medium">{session.title}</p>
          <span className="hidden text-xs text-[var(--muted)] sm:inline">{session.durationSeconds}s</span>
          {session.qaStartedMs != null ? (
            <span className="hidden text-xs text-[var(--muted)] md:inline">
              Questions {formatMs(session.qaStartedMs)}
            </span>
          ) : null}
        </div>
        <DeleteSessionButton
          sessionId={session.id}
          title={session.title}
          onDeleted={() => router.push("/dashboard")}
        />
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)_minmax(400px,480px)]">
        <section className="flex min-h-0 flex-col overflow-auto border-r border-[var(--border)] px-4 py-4">
          <h2 className="text-sm font-semibold tracking-tight">Overview</h2>
          <p className="mt-4 text-[10px] tracking-wide text-[var(--muted)] uppercase">Overall</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">
            {scores.overall == null ? "—" : scores.overall}
            <span className="ml-1 text-base font-medium text-[var(--muted)]">/ 100</span>
          </p>
          <ul className="mt-6 space-y-4">
            {scores.metrics.map((metricScore) => (
              <li key={metricScore.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{metricScore.label}</p>
                  <p className="text-sm tabular-nums">
                    {metricScore.score}
                    <span className="text-[var(--muted)]"> / 100</span>
                  </p>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#f6f9fc]">
                  <div className="h-full rounded-full bg-[#635bff]" style={{ width: `${metricScore.score}%` }} />
                </div>
                <p className="mt-1 text-xs text-[var(--muted)]">{metricScore.detail}</p>
              </li>
            ))}
          </ul>
          {scores.metrics.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">End a recording to score this session.</p>
          ) : null}
          <FreewiliGrade report={freewili} />
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-[var(--border)] p-3 sm:grid-cols-4">
            {frame ? (
              <>
                <Stat label="Time" value={formatMs(frame.timestampMs)} />
                <Stat label="Pulse" value={metric(frame.pulseBpm, 0)} />
                <Stat label="Breath" value={metric(frame.breathingRpm, 1)} />
                <Stat label="HRV" value={metric(frame.hrvMs, 0)} />
                {hands.length ? <Stat label="Hands" value={metric(handAt(hands, frame.timestampMs), 0)} /> : null}
              </>
            ) : null}
          </div>
          <div className={`grid shrink-0 gap-0 border-b border-[var(--border)] ${charts.length > 1 ? "grid-cols-1 xl:grid-cols-2" : ""}`}>
            {charts.map((chart) => (
              <TimelineChart
                key={chart.label}
                label={chart.label}
                unit={chart.unit}
                points={chart.points}
                durationMs={durationMs}
                selectedMs={frame?.timestampMs ?? 0}
                qaStartedMs={session.qaStartedMs}
                onPick={(timeMs) => showFrame(nearestFrame(frames, timeMs))}
              />
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                  <th className="px-3 py-2 font-medium">t</th>
                  <th className="px-3 py-2 font-medium">Pulse</th>
                  <th className="px-3 py-2 font-medium">Breath</th>
                  <th className="px-3 py-2 font-medium">HRV</th>
                  {showGaze ? <th className="px-3 py-2 font-medium">Gaze</th> : null}
                  {showPosture ? <th className="px-3 py-2 font-medium">Posture</th> : null}
                  {hands.length ? <th className="px-3 py-2 font-medium">Hands</th> : null}
                  <th className="px-3 py-2 font-medium">Face</th>
                </tr>
              </thead>
              <tbody>
                {frames.map((row, i) => (
                  <Fragment key={row.id}>
                    {row.segment === "questions" && frames[i - 1]?.segment !== "questions" ? (
                      <tr className="bg-[#efeaff]">
                        <td colSpan={columnCount} className="px-3 py-2 text-xs font-medium text-[#3d348b]">
                          Audience questions start · {formatMs(row.timestampMs)}
                        </td>
                      </tr>
                    ) : null}
                    <tr
                      ref={i === selected ? rowRef : undefined}
                      onClick={() => showFrame(i)}
                      className={`cursor-pointer ${
                        i === selected
                          ? "bg-[#f0efff]"
                          : row.segment === "questions"
                            ? "bg-[#f7f5ff] hover:bg-[#f3f0ff]"
                            : "hover:bg-[#f6f9fc]"
                      }`}
                    >
                      <td className="px-3 py-1.5">{formatMs(row.timestampMs)}</td>
                      <td className="px-3 py-1.5">{metric(row.pulseBpm, 0)}</td>
                      <td className="px-3 py-1.5">{metric(row.breathingRpm, 1)}</td>
                      <td className="px-3 py-1.5">{metric(row.hrvMs, 0)}</td>
                      {showGaze ? <td className="px-3 py-1.5">{metric(row.gazeScore, 0)}</td> : null}
                      {showPosture ? <td className="px-3 py-1.5">{metric(row.postureScore, 0)}</td> : null}
                      {hands.length ? <td className="px-3 py-1.5">{metric(handAt(hands, row.timestampMs), 0)}</td> : null}
                      <td className="px-3 py-1.5">{row.expression || "—"}</td>
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden border-t border-[var(--border)] lg:border-t-0 lg:border-l">
          {videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="h-[min(42vh,420px)] w-full shrink-0 bg-black object-contain"
            />
          ) : (
            <div className="grid h-48 shrink-0 place-items-center bg-[#0b1220] text-xs text-white/40">
              Recording stays in this browser
            </div>
          )}
          {frame ? (
            <p className="shrink-0 px-3 py-2 text-xs text-[var(--muted)]">
              Frame {formatMs(frame.timestampMs)}
              {frame.expression ? ` · ${frame.expression}` : ""}
              {frame.segment === "questions" ? " · audience questions" : ""}
            </p>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto border-t border-[var(--border)] px-3 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold tracking-tight">AI suggestions</h2>
              <span className="text-[10px] text-[var(--muted)]">{tips.length}/10</span>
            </div>
            {coachState === "writing" ? (
              <p className="mt-1 text-xs text-[var(--muted)]">Writing a short read…</p>
            ) : null}
            {coachError ? <p className="mt-1 text-xs text-rose-500">{coachError}</p> : null}
            <ul className="mt-3 space-y-2">
              {handNote ? <SuggestionCard item={handNote} /> : null}
              {tips.map((item) => (
                <SuggestionCard key={item.id} item={clarifyPresageSuggestion(item)} />
              ))}
            </ul>
            <div className="mt-4 rounded-xl border border-[var(--border)] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Transcript</p>
                <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] tracking-wide uppercase">
                  Grok
                </span>
              </div>
              {transcript ? (
                <TranscriptBody text={transcript} />
              ) : (
                <p className="mt-1.5 text-sm leading-5 text-[var(--muted)]">
                  {transcribing
                    ? "Transcribing your recording…"
                    : recording
                      ? "Waiting to transcribe this recording."
                      : "This recording isn’t on this browser, so it can’t be transcribed here."}
                </p>
              )}
              {session.audienceQuestions?.length ? (
                <ol className="mt-3 space-y-2">
                  {session.audienceQuestions.map((question, index) => (
                    <li key={`${question.voice}-${index}`} className="text-sm leading-5 text-[var(--muted)]">
                      <span className="font-medium text-[var(--fg)]">
                        {index + 1}. {question.voice}
                      </span>
                      {" — "}
                      {question.text}
                    </li>
                  ))}
                </ol>
              ) : null}
              {transcribeError ? <p className="mt-2 text-sm text-rose-500">{transcribeError}</p> : null}
              {recording && transcribeError ? (
                <button
                  type="button"
                  className="btn btn-ghost mt-3 px-3 py-1.5 text-xs"
                  disabled={transcribing}
                  onClick={() => {
                    transcribeStarted.current = true;
                    void transcribe(recording);
                  }}
                >
                  {transcribing ? "Transcribing…" : "Try again"}
                </button>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TranscriptBody({ text }: { text: string }) {
  const markerAt = text.indexOf(AUDIENCE_QUESTIONS_MARKER);
  if (markerAt < 0) {
    return <p className="mt-1.5 text-sm leading-5 text-[var(--muted)] whitespace-pre-wrap">{text}</p>;
  }
  const before = text.slice(0, markerAt).trim();
  const after = text.slice(markerAt + AUDIENCE_QUESTIONS_MARKER.length).trim();
  return (
    <div className="mt-1.5 space-y-2">
      {before ? <p className="text-sm leading-5 text-[var(--muted)] whitespace-pre-wrap">{before}</p> : null}
      <p className="text-xs font-medium tracking-wide text-[#3d348b] uppercase">Audience questions</p>
      {after ? <p className="text-sm leading-5 text-[var(--muted)] whitespace-pre-wrap">{after}</p> : null}
    </div>
  );
}

function SuggestionCard({ item }: { item: Suggestion }) {
  return (
    <li className="rounded-xl border border-[var(--border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{item.title}</p>
        <SeverityBadge severity={item.severity} />
      </div>
      <p className="mt-1.5 text-sm leading-6 text-[var(--muted)]">{item.body}</p>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#f6f9fc] px-2 py-1.5">
      <dt className="text-[10px] tracking-wide text-[var(--muted)] uppercase">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

function clarifyPresageSuggestion(item: Suggestion): Suggestion {
  if (!/input is unavailable/i.test(item.body)) return item;
  return {
    ...item,
    title: "Presage never opened this recording",
    body: "SmartSpectra was handed the saved video, and that file is not a camera it can open. Record again with your face in the preview. Measurement now uses those live frames.",
  };
}

function FreewiliGrade({ report }: { report: FreewiliReport | null }) {
  return (
    <div className="mt-8 border-t border-[var(--border)] pt-6">
      <h3 className="text-sm font-semibold tracking-tight">Hand movement</h3>
      {!report ? (
        <p className="mt-2 text-sm text-[var(--muted)]">No FreeWili movement was recorded for this session.</p>
      ) : (
        <>
          <p className="mt-3 text-4xl font-semibold tracking-tight">
            {report.grade.letter}
            <span className="ml-2 text-base font-medium text-[var(--muted)] tabular-nums">{report.grade.score} / 100</span>
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-2">
            <Mini label="Duration" value={formatMs(report.durationMs)} />
            <Mini label="Average intensity" value={`${report.averageIntensity}%`} />
            <Mini label="Gestures" value={String(report.gestures)} />
            <Mini label="Excessive" value={String(report.excessive)} />
            <Mini label="Stillness" value={`${report.stillnessPercent}%`} />
            <Mini label="Start buzz" value={buzzLabel(report)} />
          </dl>
          <IntensityChart series={report.series} durationMs={report.durationMs} />
          {report.lines?.length ? (
            <ul className="mt-3 space-y-1.5 text-xs text-[var(--muted)]">
              {report.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] tracking-wide text-[var(--muted)] uppercase">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function buzzLabel(report: FreewiliReport) {
  const buzz = report.buzzes?.find((item) => item.reason === "record-start");
  if (!buzz) return "Not sent";
  return buzz.played ? "Played" : "Sent";
}

function IntensityChart({
  series,
  durationMs,
}: {
  series: { t: number; intensity: number }[];
  durationMs: number;
}) {
  const points = Array.isArray(series) ? series.filter((point) => Number.isFinite(point.t) && Number.isFinite(point.intensity)) : [];
  if (!points.length) return null;
  const duration = Math.max(durationMs, points[points.length - 1]?.t ?? 0, 1);
  let drawing = false;
  const d = points
    .map((point) => {
      const x = (point.t / duration) * 100;
      const y = 8 + (1 - Math.min(100, Math.max(0, point.intensity)) / 100) * 84;
      const cmd = drawing ? "L" : "M";
      drawing = true;
      return `${cmd} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <div className="mt-4">
      <p className="text-[10px] tracking-wide text-[var(--muted)] uppercase">Intensity</p>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="mt-1 h-24 w-full">
        <path d={d} fill="none" stroke="#635bff" strokeWidth="1.6" />
      </svg>
      <div className="flex justify-between text-[10px] text-[var(--muted)]">
        <span>0:00</span>
        <span>{formatMs(duration)}</span>
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: Suggestion["severity"] }) {
  const label = severity === "strong" ? "Focus" : severity === "watch" ? "Watch" : "Note";
  return (
    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] tracking-wide uppercase">
      {label}
    </span>
  );
}

function TimelineChart({
  label,
  unit,
  points,
  durationMs,
  selectedMs,
  qaStartedMs,
  onPick,
}: {
  label: string;
  unit: string;
  points: { t: number; v: number | null }[];
  durationMs: number;
  selectedMs: number;
  qaStartedMs: number | null;
  onPick: (timeMs: number) => void;
}) {
  const duration = Math.max(durationMs, 1);
  const values = points.map((point) => point.v).filter((value): value is number => value != null);
  if (!values.length) {
    return (
      <div className="border-b border-[var(--border)] p-3 xl:border-r xl:border-b-0">
        <p className="text-[10px] tracking-wide text-[var(--muted)] uppercase">{label}</p>
        <div className="mt-2 h-44 rounded bg-[#f6f9fc]" />
      </div>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 0.001);
  let drawing = false;
  const d = points
    .map((point) => {
      if (point.v == null) {
        drawing = false;
        return "";
      }
      const x = (point.t / duration) * 100;
      const y = 8 + (1 - (point.v - min) / span) * 84;
      const cmd = drawing ? "L" : "M";
      drawing = true;
      return `${cmd} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
  const changes = points.filter((point, index) => point.v != null && (index === 0 || points[index - 1]?.v !== point.v));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({ ratio, label: formatMs(ratio * duration) }));
  const selectedX = (Math.min(duration, Math.max(0, selectedMs)) / duration) * 100;
  const qaX = qaStartedMs == null ? null : (qaStartedMs / duration) * 100;

  return (
    <div className="border-b border-[var(--border)] p-3 xl:border-r xl:border-b-0 xl:last:border-r-0">
      <div className="flex items-baseline justify-between">
        <p className="text-[10px] tracking-wide text-[var(--muted)] uppercase">{label}</p>
        <p className="text-[10px] text-[var(--muted)]">
          {min.toFixed(0)}–{max.toFixed(0)} {unit}
        </p>
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="mt-2 h-44 w-full cursor-crosshair"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
          onPick(ratio * duration);
        }}
      >
        <line x1={selectedX} x2={selectedX} y1="4" y2="96" stroke="#0a2540" strokeWidth="0.6" />
        {qaX != null ? <line x1={qaX} x2={qaX} y1="4" y2="96" stroke="#7a73ff" strokeWidth="0.5" /> : null}
        <path d={d} fill="none" stroke="#635bff" strokeWidth="1.4" />
        {changes.map((point) => (
          <circle
            key={point.t}
            cx={(point.t / duration) * 100}
            cy={8 + (1 - ((point.v ?? min) - min) / span) * 84}
            r="0.9"
            fill="#0a2540"
          />
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-[var(--muted)]">
        {ticks.map((tick) => (
          <span key={tick.ratio}>{tick.label}</span>
        ))}
      </div>
    </div>
  );
}

function chartSeries(frames: SessionFrame[]) {
  const specs: { label: string; unit: string; key: "pulseBpm" | "breathingRpm" | "hrvMs" }[] = [
    { label: "Pulse", unit: "bpm", key: "pulseBpm" },
    { label: "Breathing", unit: "/min", key: "breathingRpm" },
    { label: "HRV", unit: "ms", key: "hrvMs" },
  ];
  return specs
    .map((spec) => ({
      label: spec.label,
      unit: spec.unit,
      points: frames.map((frame) => ({ t: frame.timestampMs, v: frame[spec.key] })),
    }))
    .filter((chart) => chart.points.some((point) => point.v != null));
}

function nearestFrame(frames: SessionFrame[], timeMs: number) {
  let best = 0;
  let bestGap = Number.POSITIVE_INFINITY;
  frames.forEach((frame, index) => {
    const gap = Math.abs(frame.timestampMs - timeMs);
    if (gap < bestGap) {
      best = index;
      bestGap = gap;
    }
  });
  return best;
}

function metric(value: number | null | undefined, digits: number) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
