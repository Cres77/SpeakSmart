import { auth } from "@/lib/auth/server";
import { AppHeader } from "@/components/app-header";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MainShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/login");

  return (
    <div className="flex h-full flex-col">
      <AppHeader name={session.user.name} email={session.user.email} />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
