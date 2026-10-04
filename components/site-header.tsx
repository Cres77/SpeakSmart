import Link from "next/link";
import { Logo } from "./logo";

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-40 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-6xl items-center justify-between gap-4 px-6">
        <Logo />
        <div className="flex items-center gap-4">
          {signedIn ? (
            <Link href="/dashboard" className="btn btn-accent">
              Dashboard <span aria-hidden>›</span>
            </Link>
          ) : (
            <>
              <Link href="/login" className="hidden text-sm hover:text-[var(--accent)] sm:inline">
                Sign in
              </Link>
              <Link href="/signup" className="btn btn-accent">
                Get started <span aria-hidden>›</span>
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
