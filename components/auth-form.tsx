"use client";

import { authClient } from "@/lib/auth/client";
import Link from "next/link";
import { useActionState } from "react";
import { signInWithEmail, signUpWithEmail } from "@/app/actions";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const action = mode === "login" ? signInWithEmail : signUpWithEmail;
  const [state, formAction, pending] = useActionState(action, null);

  async function google() {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/dashboard",
    });
  }

  return (
    <div className="card mx-auto w-full max-w-md p-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {mode === "login" ? "Sign in" : "Create your account"}
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {mode === "login"
          ? "Sessions, recordings, and feedback stay on your account."
          : "One account. Every practice session saved automatically."}
      </p>

      <button type="button" onClick={google} className="btn btn-ghost mt-6 w-full">
        <GoogleIcon />
        Continue with Google
      </button>

      <div className="my-5 flex items-center gap-3 text-xs tracking-wide text-[var(--muted)] uppercase">
        <span className="h-px flex-1 bg-[var(--border)]" />
        or
        <span className="h-px flex-1 bg-[var(--border)]" />
      </div>

      <form action={formAction} className="space-y-3">
        {mode === "signup" ? (
          <div>
            <label className="label" htmlFor="name">
              Name
            </label>
            <input className="field" id="name" name="name" required placeholder="Alex Chen" />
          </div>
        ) : null}
        <div>
          <label className="label" htmlFor="email">
            Email
          </label>
          <input
            className="field"
            id="email"
            name="email"
            type="email"
            required
            placeholder="you@company.com"
          />
        </div>
        <div>
          <label className="label" htmlFor="password">
            Password
          </label>
          <input
            className="field"
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="••••••••"
          />
        </div>
        {state?.error ? <p className="text-sm text-rose-500">{state.error}</p> : null}
        <button type="submit" className="btn btn-primary w-full" disabled={pending}>
          {pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-[var(--muted)]">
        {mode === "login" ? (
          <>
            New here?{" "}
            <Link href="/signup" className="text-[var(--accent)]">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="text-[var(--accent)]">
              Sign in
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 35.3 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.2-3.5 5.8-6.7 7.2l6.3 5.3C37.3 42.1 44 37 44 24c0-1.3-.1-2.5-.4-3.5z" />
    </svg>
  );
}
