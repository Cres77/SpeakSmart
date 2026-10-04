import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const AUDIENCE_VOICES = [
  { id: "XB0fDUnXU5powFXDhCwa", name: "Charlotte" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah" },
] as const;

const FALLBACK_VOICE = { id: "JBFqnCBsd6RMkjVDRZzb", name: "George" };

export type SpokenQuestion = {
  text: string;
  voice: string;
  audioBase64: string;
};

export async function speakAudienceQuestions(questions: string[]): Promise<SpokenQuestion[]> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Add ELEVENLABS_API_KEY to .env.local to speak the audience questions.");
  const client = new ElevenLabsClient({ apiKey: key });
  return Promise.all(
    questions.map(async (text, index) => {
      const voice = AUDIENCE_VOICES[index % AUDIENCE_VOICES.length];
      try {
        return { text, voice: voice.name, audioBase64: await synthesize(client, voice.id, text) };
      } catch (error) {
        console.error(`ElevenLabs voice ${voice.name} failed`, error);
        return {
          text,
          voice: FALLBACK_VOICE.name,
          audioBase64: await synthesize(client, FALLBACK_VOICE.id, text),
        };
      }
    }),
  );
}

async function synthesize(client: ElevenLabsClient, voiceId: string, text: string) {
  const audio = await client.textToSpeech.convert(voiceId, {
    text,
    modelId: "eleven_multilingual_v2",
    outputFormat: "mp3_44100_128",
    voiceSettings: {
      stability: 0.38,
      similarityBoost: 0.8,
      style: 0.28,
      useSpeakerBoost: true,
    },
  });
  const bytes = await readAudio(audio);
  return bytes.toString("base64");
}

async function readAudio(audio: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>) {
  if (typeof (audio as ReadableStream<Uint8Array>).getReader === "function") {
    const reader = (audio as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of audio as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
