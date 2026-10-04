import { auth } from "@/lib/auth/server";
import { presageLog } from "@/lib/presage-log";
import { abortLivePresage, ingestPresageFrames, notePresageRequest } from "@/lib/presage-measure";
import { getSessionForUser } from "@/lib/sessions";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const form = await request.formData();
  const sessionId = String(form.get("sessionId") ?? "");
  if (!sessionId) return NextResponse.json({ ok: false, error: "Missing session." }, { status: 400 });

  const { data: session } = await auth.getSession();
  if (!session?.user) {
    presageLog(sessionId, "frames-rejected", { reason: "not signed in" });
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }
  const existing = await getSessionForUser(sessionId, session.user.id);
  if (!existing) {
    presageLog(sessionId, "frames-rejected", { reason: "session not found for user" });
    return NextResponse.json({ ok: false, error: "Session not found." }, { status: 404 });
  }

  const stats = form.get("stats");
  if (typeof stats === "string") presageLog(sessionId, "browser-capture", JSON.parse(stats));

  if (form.get("abort") === "1") {
    await abortLivePresage(sessionId);
    return NextResponse.json({ ok: true });
  }

  const files = form.getAll("frame");
  const stamps = form.getAll("timestampUs");
  const frames: { bytes: Buffer; timestampUs: number }[] = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (!(file instanceof File) || file.size < 32) continue;
    const timestampUs = Number(stamps[i]);
    if (!Number.isFinite(timestampUs)) continue;
    frames.push({ bytes: Buffer.from(await file.arrayBuffer()), timestampUs });
  }
  if (files.length) notePresageRequest(sessionId, { files: files.length, usable: frames.length });
  if (!frames.length) return NextResponse.json({ ok: true });

  const result = await ingestPresageFrames(sessionId, frames);
  if (!result.ok) return NextResponse.json(result, { status: 422 });
  return NextResponse.json({ ok: true });
}
