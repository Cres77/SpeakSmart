import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cvModule = require("@techstark/opencv-js");

function loadCv() {
  if (cvModule instanceof Promise) return cvModule;
  if (cvModule.Mat) return Promise.resolve(cvModule);
  return new Promise((resolve) => {
    cvModule.onRuntimeInitialized = () => resolve(cvModule);
  });
}

function fill(data, w, h, rgb) {
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
}

function rect(data, w, x, y, rw, rh, rgb) {
  for (let yy = y; yy < y + rh; yy += 1) {
    for (let xx = x; xx < x + rw; xx += 1) {
      if (xx < 0 || yy < 0 || xx >= w) continue;
      const i = (yy * w + xx) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
}

function scene({ faceX = 50, faceY = 8, handX = 18, handY = 78, hand = true }) {
  const w = 160;
  const h = 120;
  const data = new Uint8ClampedArray(w * h * 4);
  fill(data, w, h, [32, 36, 40]);
  rect(data, w, faceX, faceY, 60, 52, [214, 164, 140]);
  if (hand) rect(data, w, handX, handY, 28, 24, [196, 142, 118]);
  return { data, w, h };
}

function createTracker(cv) {
  let prev = null;
  let prevCentroids = [];

  function read(data, w, h) {
    const rgba = cv.matFromArray(h, w, cv.CV_8UC4, data);
    const rgb = new cv.Mat();
    const ycrcb = new cv.Mat();
    const skin = new cv.Mat();
    const opened = new cv.Mat();
    const lower = new cv.Mat(h, w, cv.CV_8UC3, [0, 133, 77, 0]);
    const upper = new cv.Mat(h, w, cv.CV_8UC3, [255, 173, 127, 0]);
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const handContours = new cv.MatVector();
    const handHierarchy = new cv.Mat();
    let handMask = null;
    let diff = null;

    try {
      cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
      cv.cvtColor(rgb, ycrcb, cv.COLOR_RGB2YCrCb);
      cv.inRange(ycrcb, lower, upper, skin);
      if (!prev) {
        console.log("debug ycrcb face", Array.from(ycrcb.ucharPtr(30, 80)));
        console.log("debug lower", Array.from(lower.ucharPtr(0, 0)), "upper", Array.from(upper.ucharPtr(0, 0)));
        console.log("debug skin face", skin.ucharPtr(30, 80)[0], "skin hand", skin.ucharPtr(90, 30)[0]);
      }
      cv.morphologyEx(skin, opened, cv.MORPH_OPEN, kernel);
      if (!prev) {
        console.log("debug counts skin", cv.countNonZero(skin), "opened", cv.countNonZero(opened));
      }

      const contourSrc = opened.clone();
      cv.findContours(contourSrc, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      contourSrc.delete();
      let face = null;
      let faceArea = 0;
      for (let i = 0; i < contours.size(); i += 1) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        const box = cv.boundingRect(contour);
        const cy = box.y + box.height / 2;
        if (cy < h * 0.62 && area > faceArea) {
          face = box;
          faceArea = area;
        }
        contour.delete();
      }

      handMask = opened.clone();
      if (face && faceArea > w * h * 0.015) {
        const x = Math.max(0, face.x - Math.round(face.width * 0.15));
        const y = Math.max(0, face.y - Math.round(face.height * 0.15));
        const rw = Math.min(w - x, Math.round(face.width * 1.3));
        const rh = Math.min(h - y, Math.round(face.height * 1.35));
        const pixels = handMask.data;
        const cols = handMask.cols;
        for (let yy = y; yy < y + rh; yy += 1) {
          pixels.fill(0, yy * cols + x, yy * cols + x + rw);
        }
      }

      const area = w * h;
      let changedFrac = 0;
      if (prev) {
        diff = new cv.Mat();
        cv.absdiff(handMask, prev, diff);
        changedFrac = cv.countNonZero(diff) / area;
      }

      cv.findContours(handMask.clone(), handContours, handHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const blobs = [];
      for (let i = 0; i < handContours.size(); i += 1) {
        const contour = handContours.get(i);
        const blobArea = cv.contourArea(contour);
        if (blobArea > 60) {
          const m = cv.moments(contour);
          if (m.m00 > 0) blobs.push({ x: m.m10 / m.m00, y: m.m01 / m.m00, area: blobArea });
        }
        contour.delete();
      }
      blobs.sort((a, b) => b.area - a.area);
      const centroids = blobs.slice(0, 2).map(({ x, y }) => ({ x, y }));

      let travel = 0;
      if (prevCentroids.length && centroids.length) {
        const used = new Set();
        let sum = 0;
        let n = 0;
        for (const point of prevCentroids) {
          let best = -1;
          let bestD = Infinity;
          centroids.forEach((next, index) => {
            if (used.has(index)) return;
            const d = Math.hypot(point.x - next.x, point.y - next.y);
            if (d < bestD) {
              bestD = d;
              best = index;
            }
          });
          if (best >= 0 && bestD < w * 0.55) {
            used.add(best);
            sum += bestD;
            n += 1;
          }
        }
        if (n) travel = sum / n / w;
      }

      prev?.delete();
      prev = handMask.clone();
      prevCentroids = centroids;

      const changed = Math.max(0, changedFrac - 0.004);
      const energy = changed * 12 + travel * 1.6;
      const score = prev ? Math.min(100, Math.max(1, Math.round(energy * 100))) : null;
      return {
        score,
        changedFrac: Number(changedFrac.toFixed(4)),
        travel: Number(travel.toFixed(4)),
        skin: cv.countNonZero(opened),
        hands: cv.countNonZero(handMask),
        blobs: centroids.length,
      };
    } finally {
      rgba.delete();
      rgb.delete();
      ycrcb.delete();
      skin.delete();
      opened.delete();
      lower.delete();
      upper.delete();
      kernel.delete();
      contours.delete();
      hierarchy.delete();
      handContours.delete();
      handHierarchy.delete();
      handMask?.delete();
      diff?.delete();
    }
  }

  return {
    read,
    close() {
      prev?.delete();
      prev = null;
    },
  };
}

const cv = await loadCv();
const probe = scene({});
const rgba = cv.matFromArray(probe.h, probe.w, cv.CV_8UC4, probe.data);
const rgb = new cv.Mat();
const ycrcb = new cv.Mat();
cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
cv.cvtColor(rgb, ycrcb, cv.COLOR_RGB2YCrCb);
console.log("face", Array.from(ycrcb.ucharPtr(30, 80)));
console.log("hand", Array.from(ycrcb.ucharPtr(90, 30)));
console.log("bg", Array.from(ycrcb.ucharPtr(110, 10)));
rgba.delete();
rgb.delete();
ycrcb.delete();

const tracker = createTracker(cv);
const cases = [
  ["warmup", scene({})],
  ["still", scene({})],
  ["still-2", scene({})],
  ["hand-shift", scene({ handX: 110 })],
  ["hand-back", scene({ handX: 18 })],
  ["fidget", scene({ handX: 26 })],
  ["face-shift", scene({ faceX: 70, handX: 26 })],
  ["face-only-a", scene({ hand: false, faceX: 50 })],
  ["face-only-b", scene({ hand: false, faceX: 78 })],
];

const fresh = createTracker(cv);
for (const [name, image] of cases) {
  try {
    console.log(name, fresh.read(image.data, image.w, image.h));
  } catch (error) {
    console.log(name, "FAILED", error instanceof Error ? error.message : String(error));
    break;
  }
}
fresh.close();

try {
  const timed = createTracker(cv);
  const started = performance.now();
  for (let i = 0; i < 30; i += 1) timed.read(scene({ handX: 18 + (i % 5) * 8 }).data, 160, 120);
  console.log("ms per frame", ((performance.now() - started) / 30).toFixed(2));
  timed.close();
  tracker.close();
} catch (error) {
  console.log("timed FAILED", error instanceof Error ? error.message : String(error));
}
