import { and, asc, desc, eq, lt, ne } from "drizzle-orm";
import { db } from "./db";
import { generatePresageFrames, suggestionsFromFrames } from "./presage";
import { practiceSessions, sessionFrames, type PracticeSession } from "./schema";

export async function listSessions(userId: string): Promise<PracticeSession[]> {
  // Previews that were abandoned (tab closed, back button) never become sessions.
  const staleBefore = new Date(Date.now() - 60 * 60 * 1000);
  await db
    .delete(practiceSessions)
    .where(
      and(
        eq(practiceSessions.userId, userId),
        eq(practiceSessions.status, "draft"),
        lt(practiceSessions.createdAt, staleBefore),
      ),
    );

  return db
    .select()
    .from(practiceSessions)
    .where(and(eq(practiceSessions.userId, userId), ne(practiceSessions.status, "draft")))
    .orderBy(desc(practiceSessions.createdAt));
}

export async function getSessionForUser(id: string, userId: string) {
  const rows = await db
    .select()
    .from(practiceSessions)
    .where(eq(practiceSessions.id, id))
    .limit(1);
  const session = rows[0];
  if (!session || session.userId !== userId) return null;
  return session;
}

export async function createSession(
  userId: string,
  input: {
    title: string;
    slideshowName?: string | null;
    showCamera: boolean;
    notes?: string | null;
  },
) {
  const rows = await db
    .insert(practiceSessions)
    .values({
      userId,
      title: input.title.trim() || "Untitled session",
      slideshowName: input.slideshowName || null,
      showCamera: input.showCamera,
      notes: input.notes?.trim() || null,
      status: "draft",
    })
    .returning();
  return rows[0];
}

export async function updateSessionForUser(
  id: string,
  userId: string,
  patch: Partial<Pick<PracticeSession, "showCamera" | "status" | "title" | "notes" | "transcript">>,
) {
  const existing = await getSessionForUser(id, userId);
  if (!existing) return null;
  const rows = await db
    .update(practiceSessions)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(practiceSessions.id, id))
    .returning();
  return rows[0];
}

/** Discards a session that was never recorded. Analyzed sessions are left alone. */
export async function deleteDraftSession(id: string, userId: string) {
  const existing = await getSessionForUser(id, userId);
  if (!existing || existing.status !== "draft") return false;
  await db.delete(practiceSessions).where(eq(practiceSessions.id, id));
  return true;
}

/** Removes a session the user owns, including its frame-by-frame data. */
export async function deleteSession(id: string, userId: string) {
  const existing = await getSessionForUser(id, userId);
  if (!existing) return false;
  await db.delete(sessionFrames).where(eq(sessionFrames.sessionId, id));
  await db.delete(practiceSessions).where(eq(practiceSessions.id, id));
  return true;
}

export async function completeRecording(
  id: string,
  userId: string,
  durationSeconds: number,
  transcript?: string | null,
) {
  const existing = await getSessionForUser(id, userId);
  if (!existing) return null;

  const duration = Math.max(8, Math.round(durationSeconds));
  const frames = generatePresageFrames(id, duration);
  const suggestions = suggestionsFromFrames(frames);

  await db.delete(sessionFrames).where(eq(sessionFrames.sessionId, id));
  if (frames.length) {
    await db.insert(sessionFrames).values(
      frames.map((frame) => ({
        ...frame,
        sessionId: id,
      })),
    );
  }

  const rows = await db
    .update(practiceSessions)
    .set({
      status: "analyzed",
      durationSeconds: duration,
      suggestions,
      transcript: transcript ?? existing.transcript ?? null,
      updatedAt: new Date(),
    })
    .where(eq(practiceSessions.id, id))
    .returning();

  return rows[0];
}

export async function getFrames(sessionId: string) {
  return db
    .select()
    .from(sessionFrames)
    .where(eq(sessionFrames.sessionId, sessionId))
    .orderBy(asc(sessionFrames.timestampMs));
}
