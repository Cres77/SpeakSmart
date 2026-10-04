const MODEL = "gemini-3.5-flash-lite";

export async function generateAudienceQuestions(input: {
  transcript: string;
  deckText: string;
  images: { mime: string; base64: string }[];
}): Promise<string[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Add GEMINI_API_KEY to .env.local to write audience questions.");

  const transcript = input.transcript.trim().slice(-14000);
  const deckText = input.deckText.trim().slice(0, 12000);
  const prompt = [
    transcript ? `Transcript of the presentation so far:\n${transcript}` : "No transcript was captured.",
    deckText ? `Slide text:\n${deckText}` : input.images.length ? "Slides are attached as images." : "No slides were uploaded.",
    "Write exactly 3 questions a real audience member would ask out loud at the end.",
    "Make them specific to this presentation. Vary them: one clarification, one challenge or tradeoff, and one about what happens next.",
    "Sound spoken and natural. Each question is one or two sentences. Do not number them.",
  ].join("\n\n");

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: prompt }];
  for (const image of input.images.slice(0, 6)) {
    parts.push({ inlineData: { mimeType: image.mime || "image/jpeg", data: image.base64 } });
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "You write short, realistic audience questions for the end of a presentation. Reply with JSON only.",
            },
          ],
        },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              questions: {
                type: "ARRAY",
                items: { type: "STRING" },
              },
            },
            required: ["questions"],
          },
          thinkingConfig: { thinkingLevel: "MINIMAL" },
        },
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(geminiError(detail, res.status));
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  const raw = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join("");
  return parseQuestions(raw);
}

function geminiError(detail: string, status: number) {
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Keep the raw body.
  }
  return detail || `Could not write audience questions (${status}).`;
}

export async function writeSessionCoaching(brief: string): Promise<
  { title: string; body: string; severity: "info" | "watch" | "strong" }[]
> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Add GEMINI_API_KEY to .env.local to write coaching.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: "You coach someone who just practiced a presentation. Use only the measurements and transcript you are given. Do not invent gaze, posture, or heart-rate variability when the brief says they are missing. Each note is one or two short sentences, under 40 words. Reply with JSON only.",
            },
          ],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${brief}\n\nWrite 6 short coaching notes. Each body is one or two sentences and under 40 words. Name a timestamp or a quoted phrase when you have one. Vary severity: info, watch, or strong.`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              notes: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    title: { type: "STRING" },
                    body: { type: "STRING" },
                    severity: { type: "STRING" },
                  },
                  required: ["title", "body", "severity"],
                },
              },
            },
            required: ["notes"],
          },
          thinkingConfig: { thinkingLevel: "MINIMAL" },
        },
      }),
    },
  );
  if (!res.ok) throw new Error(geminiError(await res.text(), res.status));
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
  };
  const raw = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join("");
  const parsed = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/, "")) as {
    notes?: { title?: unknown; body?: unknown; severity?: unknown }[];
  };
  const notes = (parsed.notes ?? [])
    .map((note) => ({
      title: String(note.title ?? "").trim(),
      body: String(note.body ?? "").trim(),
      severity: (note.severity === "strong" || note.severity === "watch" ? note.severity : "info") as
        | "info"
        | "watch"
        | "strong",
    }))
    .filter((note) => note.title && note.body);
  if (notes.length < 3) throw new Error("Coaching came back too short.");
  return notes.slice(0, 8);
}

function parseQuestions(raw: string): string[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  let parsed: { questions?: unknown };
  try {
    parsed = JSON.parse(cleaned) as { questions?: unknown };
  } catch {
    throw new Error("Audience questions came back in an unexpected format.");
  }
  if (!Array.isArray(parsed.questions)) throw new Error("Audience questions came back in an unexpected format.");
  const questions = parsed.questions
    .map((question) => String(question).trim().replace(/^\d+[\).\s]+/, ""))
    .filter(Boolean)
    .slice(0, 3);
  if (questions.length < 3) throw new Error("Could not write three questions from this presentation.");
  return questions;
}
