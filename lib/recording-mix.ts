import { concatFloat32, decimate, encodeWav } from "@/lib/wav";

const TRANSCRIPT_RATE = 16000;

export type RecordingMix = {
  context: AudioContext;
  micGain: GainNode;
  destination: MediaStreamAudioDestinationNode;
  recordStream: MediaStream;
  chunkCount: () => number;
  wavFrom: (start: number, end?: number) => Blob;
  close: () => void;
};

/**
 * Records camera video plus a mix of the mic and later audience-question audio.
 * A silent tap of the mic, before question playback ducks it, keeps a 16 kHz copy for the transcript.
 */
export function createRecordingMix(camera: MediaStream): RecordingMix | null {
  const audioTracks = camera.getAudioTracks();
  if (!audioTracks.length || typeof AudioContext === "undefined") return null;

  const context = new AudioContext();
  const micGain = context.createGain();
  const destination = context.createMediaStreamDestination();
  const mic = context.createMediaStreamSource(new MediaStream(audioTracks));
  mic.connect(micGain);
  micGain.connect(destination);

  const chunks: Float32Array[] = [];
  const ratio = context.sampleRate / TRANSCRIPT_RATE;
  let processor: ScriptProcessorNode | null = null;
  if (typeof context.createScriptProcessor === "function") {
    processor = context.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (event) => {
      const down = decimate(event.inputBuffer.getChannelData(0), ratio);
      if (down.length) chunks.push(down);
    };
    // Tap the mic before the ducking gain. Question playback turns that gain down,
    // and the transcript still needs the presenter's answers.
    const silent = context.createGain();
    silent.gain.value = 0;
    mic.connect(processor);
    processor.connect(silent);
    silent.connect(context.destination);
  }

  const recordStream = new MediaStream([...camera.getVideoTracks(), ...destination.stream.getAudioTracks()]);

  return {
    context,
    micGain,
    destination,
    recordStream,
    chunkCount: () => chunks.length,
    wavFrom: (start, end) => encodeWav(concatFloat32(chunks.slice(start, end)), TRANSCRIPT_RATE),
    close: () => {
      processor?.disconnect();
      void context.close().catch(() => {});
    },
  };
}
