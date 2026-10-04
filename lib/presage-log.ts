import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const LOG_DIR = path.join(process.cwd(), "logs", "presage");

/** One JSON line per Presage event, at logs/presage/<sessionId>.log. */
export function presageLog(sessionId: string, event: string, data?: unknown) {
  const line = JSON.stringify({ at: new Date().toISOString(), event, data: data ?? null }, jsonSafe);
  console.log(`[presage ${sessionId.slice(0, 8)}] ${event}`, data ?? "");
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(path.join(LOG_DIR, `${safeName(sessionId)}.log`), `${line}\n`);
  } catch (error) {
    console.error("Presage log write failed", error);
  }
}

export function presageLogPath(sessionId: string) {
  return path.join(LOG_DIR, `${safeName(sessionId)}.log`);
}

function safeName(sessionId: string) {
  return sessionId.replace(/[^a-zA-Z0-9-]/g, "_");
}

function jsonSafe(_key: string, value: unknown) {
  if (typeof value === "bigint") return Number(value);
  if (Buffer.isBuffer(value)) return `<${value.length} bytes>`;
  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`;
  return value;
}
