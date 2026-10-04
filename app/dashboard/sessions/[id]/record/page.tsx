import { redirect } from "next/navigation";

// Preview and recording now share one screen so "Start recording" can go fullscreen.
export default async function RecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/sessions/${id}/preview`);
}
