import { AuthForm } from "./auth-form";
import { SiteHeader } from "./site-header";

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

export function AuthScreen({ mode }: { mode: "login" | "signup" }) {
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <SiteHeader signedIn={false} />
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <AuthForm mode={mode} />
      </div>
    </div>
  );
}
