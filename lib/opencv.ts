import type { OpenCv } from "./hand-motion";

let loading: Promise<OpenCv> | null = null;

/** Loads OpenCV.js once. The build is served from node_modules so the app bundle stays small. */
export function loadOpenCv() {
  if (typeof window === "undefined") return Promise.reject(new Error("OpenCV runs in the browser."));
  loading ??= injectOpenCv();
  return loading;
}

async function injectOpenCv() {
  const existing = (window as Window & { cv?: unknown }).cv;
  if (existing) return settle(existing);
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/opencv";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("OpenCV failed to load."));
    document.head.appendChild(script);
  });
  const cv = (window as Window & { cv?: unknown }).cv;
  if (!cv) throw new Error("OpenCV did not start.");
  return settle(cv);
}

async function settle(cv: unknown): Promise<OpenCv> {
  let ready = cv;
  if (ready && typeof (ready as Promise<unknown>).then === "function") {
    ready = await (ready as Promise<unknown>);
  }
  const api = ready as OpenCv & { onRuntimeInitialized?: () => void; Mat?: unknown };
  if (typeof api.Mat === "function") return api;
  await new Promise<void>((resolve) => {
    api.onRuntimeInitialized = () => resolve();
  });
  if (typeof api.Mat !== "function") throw new Error("OpenCV did not start.");
  return api;
}
