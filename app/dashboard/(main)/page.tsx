import { auth } from "@/lib/auth/server";
import { listSessions } from "@/lib/sessions";
import { DashboardHome } from "@/components/dashboard-home";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/login");
  const { new: isNew } = await searchParams;
  const sessions = await listSessions(session.user.id);

  return (
    <DashboardHome
      email={session.user.email ?? ""}
      sessions={sessions}
      openNew={isNew === "1"}
    />
  );
}
