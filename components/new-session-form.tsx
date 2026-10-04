"use client";

import { createSessionAction } from "@/app/actions";
import { putAsset, slideshowKey } from "@/lib/idb";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";

export function NewSessionForm({ onCancel }: { onCancel?: () => void }) {
  const [state, formAction, pending] = useActionState(createSessionAction, null);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<File | null>(null);

  async function onSubmit(formData: FormData) {
    if (fileRef.current) {
      await putAsset(slideshowKey("pending"), fileRef.current);
      formData.set("slideshowName", fileRef.current.name);
    }
    // The await above ends the form action's transition, so re-enter one.
    startTransition(() => formAction(formData));
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="title">
          Title
        </label>
        <input className="field" id="title" name="title" required placeholder="Q3 board update" autoFocus />
      </div>
      <div>
        <label className="label" htmlFor="slides">
          Slideshow <span className="font-normal text-[var(--muted)]">(optional)</span>
        </label>
        <input
          id="slides"
          className="field"
          type="file"
          accept=".pdf,application/pdf,image/*"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            fileRef.current = file;
            setFileName(file?.name ?? "");
          }}
        />
        <p className="mt-1 text-xs text-[var(--muted)]">
          {fileName || "PDF or image. Export PowerPoint, Keynote, or Google Slides as PDF."}
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="showCamera" defaultChecked className="accent-[#635bff]" />
        Show camera
      </label>
      {state?.error ? <p className="text-sm text-rose-500">{state.error}</p> : null}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel ? (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Starting…" : "Start preview"}
        </button>
      </div>
    </form>
  );
}

export function NewSessionModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-[#0a2540]/40" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-[var(--border)] bg-white p-6 shadow-[var(--shadow)]">
        <h2 className="text-xl font-semibold tracking-tight">New session</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Optional slides. More options later.</p>
        <div className="mt-5">
          <NewSessionForm onCancel={onClose} />
        </div>
      </div>
    </div>
  );
}
