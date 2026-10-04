export const AUDIENCE_QUESTIONS_MARKER = "— Audience questions —";

export function transcriptWithQuestions(presentation: string, questionsPart: string) {
  const head = presentation.trim();
  const tail = questionsPart.trim();
  if (head && tail) return `${head}\n\n${AUDIENCE_QUESTIONS_MARKER}\n\n${tail}`;
  if (tail) return `${AUDIENCE_QUESTIONS_MARKER}\n\n${tail}`;
  if (head) return `${head}\n\n${AUDIENCE_QUESTIONS_MARKER}`;
  return "";
}

/** Inserts the questions marker near a time ratio when the recording was transcribed as one piece. */
export function insertQuestionsMarker(text: string, ratio: number) {
  const clean = text.trim();
  if (!clean) return AUDIENCE_QUESTIONS_MARKER;
  const clamped = Math.min(1, Math.max(0, ratio));
  let index = Math.round(clean.length * clamped);
  const windowStart = Math.max(0, index - 80);
  const window = clean.slice(windowStart, Math.min(clean.length, index + 80));
  const rel = window.search(/[.?!]\s/);
  if (rel >= 0) index = windowStart + rel + 1;
  return transcriptWithQuestions(clean.slice(0, index), clean.slice(index));
}
