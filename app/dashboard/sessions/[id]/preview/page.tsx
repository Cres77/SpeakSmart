import { auth } from "@/lib/auth/server";
import { getSessionForUser } from "@/lib/sessions";
import { Studio } from "@/components/studio";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/login");
  const item = await getSessionForUser(id, session.user.id);
  if (!item) notFound();

  return (
    <Studio
      sessionId={item.id}
      title={item.title}
      slideshowName={item.slideshowName}
      initialShowCamera={item.showCamera}
    />
  );
}
