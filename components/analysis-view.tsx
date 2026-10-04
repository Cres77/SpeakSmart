"use client";

import { DeleteSessionButton } from "@/components/delete-session-button";
import { getAsset, recordingKey } from "@/lib/idb";
import type { PracticeSession, SessionFrame, Suggestion } from "@/lib/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

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
  const frame = frames[selected] ?? frames[0];

  useEffect(() => {
    let url: string | null = null;
    (async () => {
      const blob = await getAsset(recordingKey(session.id));
      if (!blob) return;
      url = URL.createObjectURL(blob);
      setVideoUrl(url);
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [session.id]);

  const pulseSeries = useMemo(() => frames.map((f) => f.pulseBpm ?? 0), [frames]);
  const breathSeries = useMemo(() => frames.map((f) => f.breathingRpm ?? 0), [frames]);
  const gazeSeries = useMemo(() => frames.map((f) => f.gazeScore ?? 0), [frames]);

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
        </div>
        <DeleteSessionButton
          sessionId={session.id}
          title={session.title}
          onDeleted={() => router.push("/dashboard")}
        />
      </div>

      <div className="grid min-h-0 flex-1 overflow-hidden lg:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.4fr)_220px]">
        <section className="flex min-h-0 flex-col border-r border-[var(--border)]">
          <header className="shrink-0 px-4 py-3">
            <h2 className="text-sm font-semibold tracking-tight">AI suggestions</h2>
          </header>
          <ul className="min-h-0 flex-1 space-y-2 overflow-auto px-4 pb-4">
            {(session.suggestions ?? []).map((item: Suggestion) => (
              <li key={item.id} className="rounded-xl border border-[var(--border)] p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{item.title}</p>
                  <SeverityBadge severity={item.severity} />
                </div>
                <p className="mt-1.5 text-sm leading-5 text-[var(--muted)]">{item.body}</p>
              </li>
            ))}
            <li className="rounded-xl border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted)]">
              Transcript and filler-word notes (Groq) will land here.
            </li>
          </ul>
        </section>

        <section className="flex min-h-0 flex-col">
          <div className="grid shrink-0 grid-cols-3 gap-2 border-b border-[var(--border)] p-3 sm:grid-cols-6">
            {frame ? (
              <>
                <Stat label="Time" value={formatMs(frame.timestampMs)} />
                <Stat label="Pulse" value={`${frame.pulseBpm?.toFixed(0)}`} />
                <Stat label="Breath" value={`${frame.breathingRpm?.toFixed(1)}`} />
                <Stat label="HRV" value={`${frame.hrvMs?.toFixed(0)}`} />
                <Stat label="Gaze" value={`${frame.gazeScore?.toFixed(0)}`} />
                <Stat label="Posture" value={`${frame.postureScore?.toFixed(0)}`} />
              </>
            ) : null}
          </div>
          <div className="grid shrink-0 grid-cols-3 gap-0 border-b border-[var(--border)]">
            <Chart label="Pulse" values={pulseSeries} />
            <Chart label="Breathing" values={breathSeries} />
            <Chart label="Gaze" values={gazeSeries} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                  <th className="px-3 py-2 font-medium">t</th>
                  <th className="px-3 py-2 font-medium">Pulse</th>
                  <th className="px-3 py-2 font-medium">Breath</th>
                  <th className="px-3 py-2 font-medium">HRV</th>
                  <th className="px-3 py-2 font-medium">Gaze</th>
                  <th className="px-3 py-2 font-medium">Posture</th>
                  <th className="px-3 py-2 font-medium">Face</th>
                </tr>
              </thead>
              <tbody>
                {frames.map((row, i) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(i)}
                    className={`cursor-pointer ${i === selected ? "bg-[#f0efff]" : "hover:bg-[#f6f9fc]"}`}
                  >
                    <td className="px-3 py-1.5">{formatMs(row.timestampMs)}</td>
                    <td className="px-3 py-1.5">{row.pulseBpm?.toFixed(0)}</td>
                    <td className="px-3 py-1.5">{row.breathingRpm?.toFixed(1)}</td>
                    <td className="px-3 py-1.5">{row.hrvMs?.toFixed(0)}</td>
                    <td className="px-3 py-1.5">{row.gazeScore?.toFixed(0)}</td>
                    <td className="px-3 py-1.5">{row.postureScore?.toFixed(0)}</td>
                    <td className="px-3 py-1.5">{row.expression}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="hidden min-h-0 flex-col overflow-auto border-l border-[var(--border)] lg:flex">
          {videoUrl ? (
            <video src={videoUrl} controls className="aspect-video w-full bg-black" />
          ) : (
            <div className="grid aspect-video place-items-center bg-[#0b1220] text-xs text-white/40">
              Recording
            </div>
          )}
          <div className="space-y-2 p-3">
            <p className="text-xs font-semibold tracking-tight">More data</p>
            <Placeholder title="Expression timeline" body="Presage face series" />
            <Placeholder title="Speech (Groq)" body="WPM, pauses, fillers" />
            <Placeholder title="Voice recap" body="ElevenLabs playback" />
            <Placeholder title="Slide coverage" body="Time on each slide" />
          </div>
        </aside>
      </div>
    </div>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] p-3">
      <p className="text-xs font-medium">{title}</p>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">{body}</p>
    </div>
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

function SeverityBadge({ severity }: { severity: Suggestion["severity"] }) {
  const label = severity === "strong" ? "Focus" : severity === "watch" ? "Watch" : "Note";
  return (
    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] tracking-wide uppercase">
      {label}
    </span>
  );
}

function Chart({ label, values }: { label: string; values: number[] }) {
  if (!values.length) {
    return (
      <div className="border-r border-[var(--border)] p-3 last:border-r-0">
        <p className="text-[10px] tracking-wide text-[var(--muted)] uppercase">{label}</p>
        <div className="mt-2 h-16 rounded bg-[#f6f9fc]" />
      </div>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const d = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * 100;
      const y = 100 - ((v - min) / span) * 100;
      return `${i === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
  return (
    <div className="border-r border-[var(--border)] p-3 last:border-r-0">
      <p className="text-[10px] tracking-wide text-[var(--muted)] uppercase">{label}</p>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="mt-2 h-16 w-full">
        <path d={d} fill="none" stroke="#635bff" strokeWidth="1.8" />
      </svg>
    </div>
  );
}

function formatMs(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
