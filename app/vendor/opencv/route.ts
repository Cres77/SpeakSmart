import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

/** Serves the OpenCV.js build that ships with @techstark/opencv-js. */
export async function GET() {
  const file = path.join(process.cwd(), "node_modules", "@techstark", "opencv-js", "dist", "opencv.js");
  const body = await readFile(file);
  return new Response(body, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
