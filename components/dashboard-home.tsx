"use client";

import { DeleteSessionButton } from "@/components/delete-session-button";
import { NewSessionModal } from "@/components/new-session-form";
import type { PracticeSession } from "@/lib/schema";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

function formatDate(d: Date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function statusLabel(status: string) {
  if (status === "analyzed") return "Analyzed";
  if (status === "recording") return "Recording";
  if (status === "draft") return "Ready";
  return status;
}

export function DashboardHome({
  email,
  sessions,
  openNew,
}: {
  email: string;
  sessions: PracticeSession[];
  openNew: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(openNew);
  const [removed, setRemoved] = useState<string[]>([]);
  const visible = sessions.filter((item) => !removed.includes(item.id));

  function close() {
    setOpen(false);
    if (openNew) router.replace("/dashboard");
  }

  return (
    <div className="h-full overflow-auto bg-white">
      <div className="mx-auto max-w-6xl px-5 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Sessions</h1>
            <p className="mt-1 text-sm text-[var(--muted)]">Practice talks saved to {email}.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            Create new session
          </button>
        </div>

        {visible.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-[var(--border)] p-10 text-center">
            <h2 className="text-lg font-semibold">No sessions yet</h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Start a rehearsal. You can upload slides, or just use the camera.
            </p>
            <button type="button" className="btn btn-accent mt-6" onClick={() => setOpen(true)}>
              Create new session
            </button>
          </div>
        ) : (
          <ul className="mt-8 divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)]">
            {visible.map((item) => {
              const href =
                item.status === "analyzed"
                  ? `/dashboard/sessions/${item.id}/analysis`
                  : `/dashboard/sessions/${item.id}/preview`;
              return (
                <li key={item.id} className="flex items-center gap-4 px-5 py-4 hover:bg-[#f6f9fc]">
                  <Link href={href} className="min-w-0 flex-1">
                    <p className="font-medium tracking-tight">{item.title}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {formatDate(item.createdAt)}
                      {item.slideshowName ? ` · ${item.slideshowName}` : " · No slides"}
                      {item.durationSeconds ? ` · ${item.durationSeconds}s` : ""}
                    </p>
                  </Link>
                  <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs">
                    {statusLabel(item.status)}
                  </span>
                  <DeleteSessionButton
                    sessionId={item.id}
                    title={item.title}
                    onDeleted={() => setRemoved((ids) => [...ids, item.id])}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <NewSessionModal open={open} onClose={close} />
    </div>
  );
}
