import Link from "next/link";
import { Logo } from "./logo";

export function AppHeader({
  name,
  email,
}: {
  name?: string | null;
  email?: string | null;
}) {
  const initial = (name || email || "U").slice(0, 1).toUpperCase();
  return (
    <header className="z-40 shrink-0 border-b border-[var(--border)] bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
        <div className="flex items-center gap-6">
          <Logo />
          <nav className="flex items-center gap-4 text-sm text-[var(--muted)]">
            <Link href="/dashboard" className="hover:text-[var(--fg)]">
              Sessions
            </Link>
            <Link href="/dashboard/profile" className="hover:text-[var(--fg)]">
              Profile
            </Link>
          </nav>
        </div>
        <Link
          href="/dashboard/profile"
          className="flex items-center gap-2 rounded-full border border-[var(--border)] py-1 pr-3 pl-1 text-sm"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white">
            {initial}
          </span>
          <span className="hidden max-w-[140px] truncate sm:inline">{name || email}</span>
        </Link>
      </div>
    </header>
  );
}
