import { boolean, index, integer, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

export type Suggestion = {
  id: string;
  title: string;
  body: string;
  severity: "info" | "watch" | "strong";
};

export const practiceSessions = pgTable(
  "practice_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("draft"),
    slideshowName: text("slideshow_name"),
    showCamera: boolean("show_camera").notNull().default(true),
    notes: text("notes"),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    suggestions: jsonb("suggestions").$type<Suggestion[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("practice_sessions_user_id_idx").on(table.userId),
    index("practice_sessions_created_at_idx").on(table.createdAt),
  ],
);

export const sessionFrames = pgTable(
  "session_frames",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => practiceSessions.id, { onDelete: "cascade" }),
    timestampMs: integer("timestamp_ms").notNull(),
    pulseBpm: real("pulse_bpm"),
    breathingRpm: real("breathing_rpm"),
    hrvMs: real("hrv_ms"),
    gazeScore: real("gaze_score"),
    postureScore: real("posture_score"),
    expression: text("expression"),
  },
  (table) => [index("session_frames_session_id_idx").on(table.sessionId, table.timestampMs)],
);

export type PracticeSession = typeof practiceSessions.$inferSelect;
export type SessionFrame = typeof sessionFrames.$inferSelect;
