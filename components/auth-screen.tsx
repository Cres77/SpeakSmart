import { SiteHeader } from "@/components/site-header";
import { Logo } from "@/components/logo";
import { AuthForm } from "@/components/auth-form";
import Link from "next/link";

export function AuthScreen({ mode }: { mode: "login" | "signup" }) {
  return (
    <div className="min-h-full bg-white">
      <header className="flex items-center justify-between px-5 py-4">
        <Logo />
        <Link href="/" className="btn btn-ghost text-sm">
          Home
        </Link>
      </header>
      <main className="px-5 py-16">
        <AuthForm mode={mode} />
      </main>
    </div>
  );
}

export function MarketingShell({
  signedIn,
  children,
}: {
  signedIn: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white">
      <SiteHeader signedIn={signedIn} />
      {children}
    </div>
  );
}
