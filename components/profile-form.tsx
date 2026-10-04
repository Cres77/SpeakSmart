"use client";

import { signOutAction, updateProfileAction } from "@/app/actions";
import { useActionState } from "react";

export function ProfileForm({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  const [state, formAction, pending] = useActionState(updateProfileAction, null);

  return (
    <div className="grid gap-6 md:grid-cols-[1.2fr_0.8fr]">
      <form action={formAction} className="card p-6">
        <h2 className="text-lg font-semibold tracking-tight">Profile</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">Simple account details for this workspace.</p>
        <div className="mt-5 space-y-3">
          <div>
            <label className="label" htmlFor="name">
              Name
            </label>
            <input className="field" id="name" name="name" defaultValue={name} required />
          </div>
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input className="field" id="email" value={email} disabled />
          </div>
        </div>
        {state?.error ? <p className="mt-3 text-sm text-rose-500">{state.error}</p> : null}
        {state?.ok ? <p className="mt-3 text-sm text-emerald-600">Saved.</p> : null}
        <button type="submit" className="btn btn-primary mt-5" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </form>

      <aside className="card p-6">
        <h2 className="text-lg font-semibold tracking-tight">Session</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Sign out ends this browser session.
        </p>
        <form action={signOutAction} className="mt-6">
          <button type="submit" className="btn btn-ghost">
            Sign out
          </button>
        </form>
      </aside>
    </div>
  );
}
