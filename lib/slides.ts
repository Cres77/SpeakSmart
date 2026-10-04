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
