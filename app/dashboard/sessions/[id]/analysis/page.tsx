import { auth } from "@/lib/auth/server";
import { getFrames, getSessionForUser } from "@/lib/sessions";
import { AnalysisView } from "@/components/analysis-view";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/login");
  const item = await getSessionForUser(id, session.user.id);
  if (!item) notFound();
  const frames = await getFrames(item.id);

  return <AnalysisView session={item} frames={frames} />;
}
