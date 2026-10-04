import { redirect } from "next/navigation";

export default async function RecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/dashboard/sessions/${id}/preview`);
}
