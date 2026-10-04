export type TranscriptResult = {
  text: string;
  language?: string;
  duration?: number;
};

export async function transcribeAudio(file: File | Blob, filename = "recording.webm"): Promise<TranscriptResult> {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new Error("XAI_API_KEY is not set.");

  const body = new FormData();
  body.append("model", "grok-voice-transcribe-2.0");
  body.append("language", "en");
  body.append("format", "true");
  body.append("filler_words", "true");
  // xAI ignores fields that come after the file on streamable uploads.
  body.append("file", file, filename);

  const res = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `Grok transcription failed (${res.status}).`);
  }

  const data = (await res.json()) as { text?: string; language?: string; duration?: number };
  return {
    text: (data.text ?? "").trim(),
    language: data.language,
    duration: data.duration,
  };
}
