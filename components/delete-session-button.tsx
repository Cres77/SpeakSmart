"use client";

import { deleteSessionAction } from "@/app/actions";
import { deleteAsset, freewiliMotionKey, handMotionKey, recordingKey, slideshowKey } from "@/lib/idb";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function DeleteSessionButton({
  sessionId,
  title,
  onDeleted,
}: {
  sessionId: string;
  title: string;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending]);

  async function remove() {
    setPending(true);
    await Promise.allSettled([
      deleteSessionAction(sessionId),
      deleteAsset(slideshowKey(sessionId)),
      deleteAsset(recordingKey(sessionId)),
      deleteAsset(handMotionKey(sessionId)),
      deleteAsset(freewiliMotionKey(sessionId)),
    ]);
    setOpen(false);
    onDeleted?.();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        className="text-xs text-[var(--muted)] hover:text-rose-600"
        onClick={() => setOpen(true)}
      >
        Delete
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-[#0a2540]/40"
            aria-label="Close"
            onClick={() => {
              if (!pending) setOpen(false);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-session-title"
            className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-6 shadow-[var(--shadow)]"
          >
            <h2 id="delete-session-title" className="text-xl font-semibold tracking-tight">
              Delete session
            </h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              <span className="font-medium text-[var(--fg)]">{title}</span> and its recording will be
              removed. This can&apos;t be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={remove} disabled={pending}>
                {pending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
