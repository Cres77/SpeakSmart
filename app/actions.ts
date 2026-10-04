"use server";

import { auth } from "@/lib/auth/server";
import {
  completeRecording,
  createSession,
  deleteDraftSession,
  deleteSession,
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

export async function finishRecordingAction(sessionId: string, durationSeconds: number) {
  const user = await requireUser();
  await completeRecording(sessionId, user.id, durationSeconds);
  redirect(`/dashboard/sessions/${sessionId}/analysis`);
}
