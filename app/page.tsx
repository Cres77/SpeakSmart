import { auth } from "@/lib/auth/server";
import { MarketingShell } from "@/components/auth-screen";
import Link from "next/link";
import type { CSSProperties } from "react";

export const dynamic = "force-dynamic";

const bands: { y: number; w: string; c1: string; c2: string }[] = [
  { y: 0, w: "62%", c1: "#ffb347", c2: "#ff7a59" },
  { y: 74, w: "78%", c1: "#ff6b8b", c2: "#e255c4" },
  { y: 148, w: "92%", c1: "#b266ff", c2: "#7a5cff" },
  { y: 222, w: "84%", c1: "#5b7dff", c2: "#2f9bff" },
  { y: 296, w: "66%", c1: "#3fd0ff", c2: "#7af0e0" },
];

export default async function Home() {
  const { data: session } = await auth.getSession();
  const signedIn = Boolean(session?.user);
  const cta = signedIn ? "/dashboard" : "/signup";

  return (
    <MarketingShell signedIn={signedIn}>
      <section className="relative min-h-0 flex-1 overflow-hidden">
        <div className="sash hidden md:block" style={{ left: "46%" }} aria-hidden>
          {bands.map((b) => (
            <i
              key={b.y}
              style={
                {
                  "--y": `${b.y}px`,
                  "--c1": b.c1,
                  "--c2": b.c2,
                  width: b.w,
                } as CSSProperties
              }
            />
          ))}
        </div>

        <div className="relative flex h-full items-center">
          <div className="mx-auto w-full max-w-6xl px-6">
            <h1 className="display max-w-[14ch] text-5xl sm:text-6xl lg:text-7xl">
              Practice presenting, <span className="text-[var(--accent)]">get sharper</span> every run.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-7 text-[var(--muted)]">
              Record yourself with your slides, then review AI feedback and a frame-by-frame look at
              your delivery.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={cta} className="btn btn-accent btn-lg">
                {signedIn ? "Open dashboard" : "Get started"} <span aria-hidden>›</span>
              </Link>
              {!signedIn ? (
                <Link href="/login" className="btn btn-outline btn-lg">
                  Sign in
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <footer className="shrink-0 border-t border-[var(--border)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 text-sm text-[var(--muted)]">
          <p>Neon · Presage · Groq · ElevenLabs</p>
          <p>© {new Date().getFullYear()} Speaksmart</p>
        </div>
      </footer>
    </MarketingShell>
  );
}
