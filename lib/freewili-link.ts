import { createBuzzGuard } from "@/FreeWili/shared/buzz.mjs";
import coachConfig from "@/FreeWili/shared/config.json";
import { gradeMovement } from "@/FreeWili/shared/grade.mjs";
import { createMotionDetector } from "@/FreeWili/shared/motion.mjs";
import { summarizeSession } from "@/FreeWili/shared/summary.mjs";

const BUCKET_MS = 250;

export type FreewiliGrade = {
  letter: "A" | "B" | "C" | "D" | "F";
  score: number;
};

export type FreewiliBuzz = {
  timestamp: number;
  frequency: number;
  duration: number;
  amplitude: number;
  played: boolean;
  reason: "record-start";
};

export type FreewiliReport = {
  durationMs: number;
  averageIntensity: number;
  gestures: number;
  excessive: number;
  stillnessPercent: number;
  series: { t: number; intensity: number }[];
  buzzes: FreewiliBuzz[];
  lines: string[];
  grade: FreewiliGrade;
};

export type FreewiliLink = {
  begin(): void;
  end(): FreewiliReport | null;
  close(): void;
};

export function freewiliSocketUrl() {
  const raw = process.env.NEXT_PUBLIC_FREEWILI_URL || "ws://127.0.0.1:4173";
  try {
    const url = new URL(raw);
    if (url.pathname === "/" || url.pathname === "") url.pathname = "/ws";
    return url.toString();
  } catch {
    return "ws://127.0.0.1:4173/ws";
  }
}

export function startFreewiliLink(onStatus: (connected: boolean) => void): FreewiliLink {
  const guard = createBuzzGuard();
  const detector = createMotionDetector(coachConfig);
  let socket: WebSocket | null = null;
  let closed = false;
  let capturing = false;
  let deviceConnected = false;
  let baselineArmed = false;
  let startedAt = 0;
  let session = -1;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let samples: { movement: number }[] = [];
  let gestures: { timestamp: number; magnitude: number }[] = [];
  let excessive: { movement: number }[] = [];
  let buzzes: FreewiliBuzz[] = [];
  let series: { t: number; intensity: number; bucket: number }[] = [];

  const connect = () => {
    if (closed) return;
    let next: WebSocket;
    try {
      next = new WebSocket(freewiliSocketUrl());
    } catch {
      onStatus(false);
      retry = setTimeout(connect, 2000);
      return;
    }
    socket = next;
    next.addEventListener("open", () => {
      send({ type: "hello", role: "browser", timestamp: Date.now() });
    });
    next.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.type === "link") {
        const connected = message.status === "connected" && message.transport === "freewili";
        deviceConnected = connected;
        onStatus(connected);
        const nextSession = typeof message.session === "number" ? message.session : session;
        if (nextSession !== session) {
          session = nextSession;
          detector.reset();
        }
        if (capturing && connected && !baselineArmed) armBaseline();
        return;
      }
      if (message.type === "buzz" && typeof message.played === "boolean") {
        const match = buzzes.find((buzz) => buzz.timestamp === message.timestamp)
          ?? buzzes.find((buzz) => !buzz.played);
        if (match) match.played = message.played;
        return;
      }
      if (!capturing || !baselineArmed || !deviceConnected || message.type !== "sensor") return;
      if (message.transport !== "freewili" || message.scored !== true) return;
      const movement = message.movement;
      const magnitude = message.magnitude;
      if (typeof movement !== "number" || typeof magnitude !== "number") return;
      if (!Number.isFinite(movement) || !Number.isFinite(magnitude)) return;
      const timestamp = typeof message.timestamp === "number" && Number.isFinite(message.timestamp)
        ? message.timestamp
        : Date.now();
      samples.push({ movement });
      const snap = detector.push({ timestamp, magnitude, movement });
      if (snap.gestureEvent) gestures.push(snap.gestureEvent);
      if (snap.excessiveEvent) excessive.push({ movement: snap.excessiveEvent.movement });
      pushBucket(Date.now() - startedAt, movement);
    });
    next.addEventListener("close", () => {
      if (socket === next) socket = null;
      deviceConnected = false;
      onStatus(false);
      if (!closed) retry = setTimeout(connect, 2000);
    });
  };

  function send(message: object) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function armBaseline() {
    if (!send({ type: "calibration", role: "browser", timestamp: Date.now(), clear: true })) return;
    baselineArmed = true;
    detector.reset();
  }

  function requestBuzz() {
    if (!deviceConnected || !socket || socket.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (!guard.trySend(now, coachConfig.buzzDurationMs)) return;
    const command = {
      type: "buzz",
      role: "browser",
      frequency: coachConfig.buzzFrequencyHz,
      duration: coachConfig.buzzDurationMs,
      amplitude: coachConfig.buzzAmplitude,
      timestamp: now,
    };
    if (!send(command)) return;
    buzzes.push({
      timestamp: now,
      frequency: command.frequency,
      duration: command.duration,
      amplitude: command.amplitude,
      played: false,
      reason: "record-start",
    });
  }

  function pushBucket(elapsed: number, movement: number) {
    const intensity = Math.min(100, Math.max(0, movement * 100));
    const t = Math.max(0, elapsed);
    const bucket = Math.floor(t / BUCKET_MS);
    const last = series[series.length - 1];
    if (last && bucket < last.bucket) return;
    if (last && bucket === last.bucket) {
      last.t = t;
      last.intensity = intensity;
      return;
    }
    series.push({ t, intensity, bucket });
  }

  connect();

  return {
    begin() {
      capturing = true;
      startedAt = Date.now();
      baselineArmed = false;
      samples = [];
      gestures = [];
      excessive = [];
      buzzes = [];
      series = [];
      detector.reset();
      if (deviceConnected) armBaseline();
      requestBuzz();
    },
    end() {
      capturing = false;
      if (!samples.length) return null;
      const durationMs = Math.max(0, Date.now() - startedAt);
      const summary = summarizeSession({
        durationMs,
        samples,
        gestures,
        excessive,
        buzzes,
      });
      const grade = gradeMovement(summary);
      if (!grade || summary.averageMovement == null || summary.stillness == null) return null;
      return {
        durationMs: summary.durationMs,
        averageIntensity: Math.round(summary.averageMovement * 1000) / 10,
        gestures: summary.gestures,
        excessive: summary.excessive,
        stillnessPercent: Math.round(summary.stillness * 1000) / 10,
        series: series.map((point) => ({ t: point.t, intensity: point.intensity })),
        buzzes: buzzes.map((buzz) => ({ ...buzz })),
        lines: summary.lines,
        grade,
      };
    },
    close() {
      closed = true;
      capturing = false;
      clearTimeout(retry);
      socket?.close();
      socket = null;
    },
  };
}

export function parseFreewiliReport(raw: string): FreewiliReport | null {
  try {
    const parsed = JSON.parse(raw) as Partial<FreewiliReport>;
    if (!parsed || typeof parsed !== "object" || !parsed.grade) return null;
    if (!Number.isFinite(parsed.grade.score) || typeof parsed.grade.letter !== "string") return null;
    if (!["A", "B", "C", "D", "F"].includes(parsed.grade.letter)) return null;
    return parsed as FreewiliReport;
  } catch {
    return null;
  }
}
