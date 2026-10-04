"use server";

import { auth } from "@/lib/auth/server";
import { speakAudienceQuestions } from "@/lib/eleven";
import { measurementBrief } from "@/lib/analysis-coach";
import { generateAudienceQuestions, writeSessionCoaching } from "@/lib/gemini";
import { finishLivePresage } from "@/lib/presage-measure";
import type { AudienceQuestion, Suggestion } from "@/lib/schema";
import { insertQuestionsMarker, transcriptWithQuestions } from "@/lib/transcript-marker";
import { transcribeAudio } from "@/lib/xai";
import {
  completeRecording,
  createSession,
  deleteDraftSession,
  deleteSession,
  getFrames,
  getSessionForUser,
  updateSessionForUser,
} from "@/lib/sessions";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

async function requireUser() {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/login");
  return session.user;
}

export async function signInWithEmail(prevState: { error: string } | null, formData: FormData) {
  const { error } = await auth.signIn.email({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (error) return { error: error.message || "Could not sign in." };
  redirect("/dashboard");
}

export async function signUpWithEmail(prevState: { error: string } | null, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const name = String(formData.get("name") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  const { error } = await auth.signUp.email({ email, name, password });
  if (error) return { error: error.message || "Could not create account." };
  redirect("/dashboard");
}

export async function signOutAction() {
  await auth.signOut();
  redirect("/");
}

export async function updateProfileAction(prevState: { error?: string; ok?: boolean } | null, formData: FormData) {
  await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };
  const { error } = await auth.updateUser({ name });
  if (error) return { error: error.message || "Could not update profile." };
  return { ok: true };
}

export async function createSessionAction(prevState: { error: string } | null, formData: FormData) {
  const user = await requireUser();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { error: "Give this session a title." };
  const showCamera = formData.get("showCamera") === "on";
  const notes = String(formData.get("notes") ?? "");
  const slideshowName = String(formData.get("slideshowName") ?? "") || null;
  const session = await createSession(user.id, { title, showCamera, notes, slideshowName });
  redirect(`/dashboard/sessions/${session.id}/preview`);
}

export async function setShowCameraAction(sessionId: string, showCamera: boolean) {
  const user = await requireUser();
  await updateSessionForUser(sessionId, user.id, { showCamera });
}

export async function cancelSessionAction(sessionId: string) {
  const user = await requireUser();
  await deleteDraftSession(sessionId, user.id);
}

export async function deleteSessionAction(sessionId: string) {
  const user = await requireUser();
  await deleteSession(sessionId, user.id);
  revalidatePath("/dashboard");
}

export async function prepareAudienceQuestionsAction(
  sessionId: string,
  formData: FormData,
): Promise<
  | { ok: true; presentationTranscript: string; questions: { text: string; voice: string; audioBase64: string }[] }
  | { ok: false; error: string }
> {
  const user = await requireUser();
  const existing = await getSessionForUser(sessionId, user.id);
  if (!existing) return { ok: false, error: "Session not found." };

  const audio = formData.get("audio");
  const deckText = String(formData.get("deckText") ?? "").slice(0, 12000);
  const images: { mime: string; base64: string }[] = [];
  for (const value of formData.getAll("slide")) {
    if (!(value instanceof File) || value.size === 0 || value.size > 600_000) continue;
    const bytes = Buffer.from(await value.arrayBuffer());
    images.push({ mime: value.type || "image/jpeg", base64: bytes.toString("base64") });
    if (images.length >= 6) break;
  }

  let presentationTranscript = "";
  let transcribeError = "";
  if (audio instanceof File && audio.size > 44) {
    try {
      presentationTranscript = (await transcribeAudio(audio, audio.name || "presentation.wav")).text;
    } catch (error) {
      console.error("Grok transcription failed", error);
      transcribeError = error instanceof Error ? error.message : "The talk could not be transcribed.";
    }
  }

  if (!presentationTranscript.trim() && !deckText.trim() && images.length === 0) {
    return {
      ok: false,
      error: transcribeError || "Say a little more, or add slides, so there is something to ask about.",
    };
  }

  try {
    const written = await generateAudienceQuestions({ transcript: presentationTranscript, deckText, images });
    const questions = await speakAudienceQuestions(written);
    return { ok: true, presentationTranscript, questions };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not prepare audience questions.";
    return { ok: false, error: message.slice(0, 280) };
  }
}

export async function finishRecordingAction(
  sessionId: string,
  durationSeconds: number,
  recording?: File | null,
  qa?: {
    startedMs: number;
    presentationTranscript: string;
    questions: AudienceQuestion[];
    qaAudio?: File | null;
  } | null,
) {
  const user = await requireUser();
  let transcript: string | null = null;
  const qaMeta =
    qa && Number.isFinite(qa.startedMs)
      ? {
          startedMs: Math.max(0, Math.round(qa.startedMs)),
          questions: qa.questions.slice(0, 3).map((question) => ({
            text: question.text,
            voice: question.voice,
          })),
        }
      : null;

  if (qa && Number.isFinite(qa.startedMs)) {
    const head = qa.presentationTranscript.trim();
    let answers = "";
    if (qa.qaAudio && qa.qaAudio.size > 44) {
      try {
        answers = (await transcribeAudio(qa.qaAudio, "answers.wav")).text;
      } catch (error) {
        console.error("Grok transcription failed", error);
      }
    }
    const tail = answers.trim() ? `Your answers:\n${answers.trim()}` : "";
    if (qa.qaAudio && qa.qaAudio.size > 44) {
      transcript = transcriptWithQuestions(head, tail) || null;
    } else if (recording && recording.size > 0) {
      try {
        const full = (await transcribeAudio(recording, recording.name || "recording.webm")).text;
        const ratio = durationSeconds > 0 ? qa.startedMs / (durationSeconds * 1000) : 1;
        transcript = insertQuestionsMarker(full, ratio);
      } catch (error) {
        console.error("Grok transcription failed", error);
        transcript = transcriptWithQuestions(head, tail) || null;
      }
    } else {
      transcript = transcriptWithQuestions(head, tail) || null;
    }
  } else if (recording && recording.size > 0) {
    try {
      const result = await transcribeAudio(recording, recording.name || "recording.webm");
      transcript = result.text || null;
    } catch (error) {
      console.error("Grok transcription failed", error);
    }
  }

  const presage = await finishLivePresage(sessionId, durationSeconds, qaMeta?.startedMs ?? null);
  await completeRecording(sessionId, user.id, durationSeconds, transcript, qaMeta, presage);
  redirect(`/dashboard/sessions/${sessionId}/analysis`);
}

export async function writeCoachingAction(
  sessionId: string,
): Promise<{ ok: true; notes: Suggestion[] } | { ok: false; error: string }> {
  const user = await requireUser();
  const existing = await getSessionForUser(sessionId, user.id);
  if (!existing) return { ok: false, error: "Session not found." };
  const frames = await getFrames(sessionId);
  try {
    const written = await writeSessionCoaching(
      measurementBrief({
        frames,
        transcript: existing.transcript,
        durationSeconds: existing.durationSeconds,
        qaStartedMs: existing.qaStartedMs,
      }),
    );
    const notes: Suggestion[] = written.map((note, index) => ({
      id: `coach2-${index}`,
      title: note.title,
      body: note.body,
      severity: note.severity,
    }));
    const kept = (existing.suggestions ?? []).filter((item) => !item.id.startsWith("coach"));
    await updateSessionForUser(sessionId, user.id, { suggestions: [...notes, ...kept] });
    return { ok: true, notes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not write coaching." };
  }
}

export async function transcribeSessionAction(
  sessionId: string,
  formData: FormData,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const existing = await getSessionForUser(sessionId, user.id);
  if (!existing) return { ok: false, error: "Session not found." };
  const audio = formData.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return { ok: false, error: "No recording to transcribe." };
  }
  try {
    const result = await transcribeAudio(audio, audio.name || "recording.webm");
    await updateSessionForUser(sessionId, user.id, { transcript: result.text });
    revalidatePath(`/dashboard/sessions/${sessionId}/analysis`);
    return { ok: true, text: result.text };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Transcription failed." };
  }
}
