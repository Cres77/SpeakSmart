import type { Suggestion } from "./schema";

export type HandSample = {
  timestampMs: number;
  handMovement: number;
};

type Mat = {
  rows: number;
  cols: number;
  clone: () => Mat;
  delete: () => void;
  ucharPtr: (row: number, col?: number) => Uint8Array;
};

type MatVector = {
  size: () => number;
  get: (index: number) => Mat;
  delete: () => void;
};

export type OpenCv = {
  CV_8UC4: number;
  CV_8UC3: number;
  COLOR_RGBA2RGB: number;
  COLOR_RGB2YCrCb: number;
  MORPH_ELLIPSE: number;
  MORPH_OPEN: number;
  RETR_EXTERNAL: number;
  CHAIN_APPROX_SIMPLE: number;
  Mat: new (rows?: number, cols?: number, type?: number, scalar?: number[]) => Mat;
  MatVector: new () => MatVector;
  Size: new (width: number, height: number) => object;
  matFromArray: (rows: number, cols: number, type: number, array: ArrayLike<number>) => Mat;
  cvtColor: (src: Mat, dst: Mat, code: number) => void;
  inRange: (src: Mat, lower: Mat, upper: Mat, dst: Mat) => void;
  morphologyEx: (src: Mat, dst: Mat, op: number, kernel: Mat) => void;
  getStructuringElement: (shape: number, ksize: object) => Mat;
  findContours: (image: Mat, contours: MatVector, hierarchy: Mat, mode: number, method: number) => void;
  boundingRect: (curve: Mat) => { x: number; y: number; width: number; height: number };
  contourArea: (contour: Mat) => number;
  moments: (array: Mat) => { m00: number; m10: number; m01: number };
  absdiff: (src1: Mat, src2: Mat, dst: Mat) => void;
  countNonZero: (src: Mat) => number;
};

type Centroid = { x: number; y: number };

/**
 * Maps skin motion outside the face to 1–100.
 * `changedFrac` is the share of the frame whose hand mask flipped since the last sample.
 * `travelFrac` is how far those hand blobs moved, as a fraction of the frame width.
 * A still frame lands on 1. A hand crossing most of the frame in one sample lands on 100.
 */
export function movementScore(changedFrac: number, travelFrac: number) {
  const changed = Math.max(0, changedFrac - 0.008);
  const energy = changed * 12 + travelFrac * 1.6;
  return Math.min(100, Math.max(1, Math.round(energy * 100)));
}

export function createHandTracker(cv: OpenCv) {
  let prev: Mat | null = null;
  let prevCentroids: Centroid[] = [];

  function read(data: Uint8ClampedArray | Uint8Array, width: number, height: number): number | null {
    const trash: Mat[] = [];
    const vectors: MatVector[] = [];
    const keep = (mat: Mat) => {
      trash.push(mat);
      return mat;
    };
    const contoursOf = () => {
      const vector = new cv.MatVector();
      vectors.push(vector);
      return vector;
    };
    let nextPrev: Mat | null = null;
    let adopted = false;

    try {
      const rgba = keep(cv.matFromArray(height, width, cv.CV_8UC4, data));
      const rgb = keep(new cv.Mat());
      const ycrcb = keep(new cv.Mat());
      const skin = keep(new cv.Mat());
      const opened = keep(new cv.Mat());
      const lower = keep(new cv.Mat(height, width, cv.CV_8UC3, [0, 133, 77, 0]));
      const upper = keep(new cv.Mat(height, width, cv.CV_8UC3, [255, 173, 127, 0]));
      const kernel = keep(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3)));
      cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, ycrcb, cv.COLOR_RGB2YCrCb);
      cv.inRange(ycrcb, lower, upper, skin);
      cv.morphologyEx(skin, opened, cv.MORPH_OPEN, kernel);

      const faceContours = contoursOf();
      const faceHierarchy = keep(new cv.Mat());
      const faceSource = keep(opened.clone());
      cv.findContours(faceSource, faceContours, faceHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let face: { x: number; y: number; width: number; height: number } | null = null;
      let faceArea = 0;
      for (let i = 0; i < faceContours.size(); i += 1) {
        const contour = faceContours.get(i);
        trash.push(contour);
        const area = cv.contourArea(contour);
        const box = cv.boundingRect(contour);
        const cy = box.y + box.height / 2;
        if (cy < height * 0.62 && area > faceArea) {
          face = box;
          faceArea = area;
        }
      }

      const handMask = keep(opened.clone());
      if (face && faceArea > width * height * 0.015) {
        const x = Math.max(0, face.x - Math.round(face.width * 0.15));
        const y = Math.max(0, face.y - Math.round(face.height * 0.15));
        const rw = Math.min(width - x, Math.round(face.width * 1.3));
        const rh = Math.min(height - y, Math.round(face.height * 1.35));
        for (let yy = y; yy < y + rh; yy += 1) {
          const row = handMask.ucharPtr(yy);
          row.fill(0, x, x + rw);
        }
      }

      let changedFrac = 0;
      if (prev) {
        const diff = keep(new cv.Mat());
        cv.absdiff(handMask, prev, diff);
        changedFrac = cv.countNonZero(diff) / (width * height);
      }

      const blobContours = contoursOf();
      const blobHierarchy = keep(new cv.Mat());
      const blobSource = keep(handMask.clone());
      cv.findContours(blobSource, blobContours, blobHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const blobs: (Centroid & { area: number })[] = [];
      for (let i = 0; i < blobContours.size(); i += 1) {
        const contour = blobContours.get(i);
        trash.push(contour);
        const area = cv.contourArea(contour);
        if (area <= 60) continue;
        const moments = cv.moments(contour);
        if (moments.m00 <= 0) continue;
        blobs.push({ x: moments.m10 / moments.m00, y: moments.m01 / moments.m00, area });
      }
      blobs.sort((a, b) => b.area - a.area);
      const centroids = blobs.slice(0, 2).map(({ x, y }) => ({ x, y }));
      const travel = centroidTravel(prevCentroids, centroids, width);

      nextPrev = handMask.clone();
      const hadPrev = prev != null;
      prev?.delete();
      prev = nextPrev;
      adopted = true;
      prevCentroids = centroids;

      if (!hadPrev) return null;
      return movementScore(changedFrac, travel);
    } finally {
      if (!adopted) nextPrev?.delete();
      for (const mat of trash) mat.delete();
      for (const vector of vectors) vector.delete();
    }
  }

  return {
    read,
    close() {
      prev?.delete();
      prev = null;
      prevCentroids = [];
    },
  };
}

function centroidTravel(prev: Centroid[], next: Centroid[], frameWidth: number) {
  if (!prev.length || !next.length) return 0;
  const used = new Set<number>();
  let sum = 0;
  let count = 0;
  for (const point of prev) {
    let best = -1;
    let bestDistance = Infinity;
    next.forEach((candidate, index) => {
      if (used.has(index)) return;
      const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    if (best >= 0 && bestDistance < frameWidth * 0.9) {
      used.add(best);
      sum += bestDistance;
      count += 1;
    }
  }
  return count ? sum / count / frameWidth : 0;
}

export function handAt(samples: HandSample[], timestampMs: number) {
  const second = Math.floor(timestampMs / 1000);
  const hit = samples.find((sample) => Math.floor(sample.timestampMs / 1000) === second);
  return hit ? hit.handMovement : null;
}

export function handMovementNote(samples: HandSample[]): Suggestion | null {
  if (samples.length < 3) return null;
  const average = samples.reduce((sum, sample) => sum + sample.handMovement, 0) / samples.length;
  const rounded = Math.round(average);
  if (average < 12) {
    return {
      id: "hands-still",
      title: "Hands stayed quiet",
      body: `OpenCV put hand movement at ${rounded} out of 100. Gesture on the points you want remembered, then let your hands settle.`,
      severity: "watch",
    };
  }
  if (average > 75) {
    return {
      id: "hands-busy",
      title: "Hands were very active",
      body: `OpenCV put hand movement at ${rounded} out of 100. Large motion on every sentence competes with the slide. Save the big gestures for the turns.`,
      severity: "watch",
    };
  }
  return {
    id: "hands-ok",
    title: "Hand movement read clearly",
    body: `OpenCV put hand movement at ${rounded} out of 100. That is enough gesture to look alive without covering the talk.`,
    severity: "info",
  };
}
