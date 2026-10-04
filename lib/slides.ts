"use client";

export type Slide = { src: string };

const TARGET_WIDTH = 1600;

function isPdf(blob: Blob, name: string) {
  return blob.type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

/**
 * Turns an uploaded deck into one image per slide.
 * PDFs are rendered page by page; a plain image is treated as a one-slide deck.
 * Returned `src` values are object URLs: call `releaseSlides` when done.
 */
export async function loadSlides(blob: Blob, name: string): Promise<Slide[]> {
  if (!isPdf(blob, name)) {
    return [{ src: URL.createObjectURL(blob) }];
  }

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = new Uint8Array(await blob.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const slides: Slide[] = [];

  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    if (png) slides.push({ src: URL.createObjectURL(png) });
    page.cleanup();
  }

  void pdf.cleanup();
  return slides;
}

export function releaseSlides(slides: Slide[]) {
  slides.forEach((s) => URL.revokeObjectURL(s.src));
}

/** Pulls a text layer out of a PDF deck. Image-only files come back empty. */
export async function extractDeckText(blob: Blob, name: string): Promise<string> {
  if (!isPdf(blob, name)) return "";
  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
    const data = new Uint8Array(await blob.arrayBuffer());
    const pdf = await pdfjs.getDocument({ data }).promise;
    const pages: string[] = [];
    const limit = Math.min(pdf.numPages, 30);
    for (let n = 1; n <= limit; n += 1) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const line = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) pages.push(`Slide ${n}: ${line}`);
      page.cleanup();
    }
    void pdf.cleanup();
    return pages.join("\n");
  } catch {
    return "";
  }
}

export async function compressSlideImages(slides: Slide[], limit = 6): Promise<File[]> {
  const picks = pickEven(slides, limit);
  const files: File[] = [];
  for (let i = 0; i < picks.length; i += 1) {
    const blob = await shrinkToJpeg(picks[i].src, 640, 0.62);
    if (blob && blob.size > 0) files.push(new File([blob], `slide-${i}.jpg`, { type: "image/jpeg" }));
  }
  return files;
}

function pickEven<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, i) => items[Math.round((i * (items.length - 1)) / (limit - 1))]);
}

function shrinkToJpeg(src: string, width: number, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, width / Math.max(1, image.naturalWidth));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}
