import assert from "node:assert/strict";
import test from "node:test";
import {
  CHART_BUCKET_MS,
  CHART_POINT_CAP,
  CHART_WINDOW_MS,
  createIntensitySeries,
} from "../shared/intensity-series.mjs";

const start = 1_700_000_000_000;

test("a bucket keeps the latest intensity and its timestamp", () => {
  const series = createIntensitySeries();
  assert.equal(series.push(start, 0.1).action, "add");
  assert.equal(series.push(start + 20, 0.4).action, "replace");
  assert.equal(series.push(start + CHART_BUCKET_MS - 10, 0.8).action, "replace");
  assert.equal(series.points.length, 1);
  assert.equal(series.points[0].timestamp, start + CHART_BUCKET_MS - 10);
  assert.equal(series.points[0].intensity, 80);
  assert.equal(series.push(start - 1000, 1).action, "ignore");
  assert.equal(series.points.length, 1);
  assert.equal(series.points[0].intensity, 80);
});

test("50 Hz samples downsample to about 4 points per second", () => {
  const series = createIntensitySeries();
  for (let i = 0; i < 50; i += 1) series.push(start + i * 20, i / 100);
  assert.equal(series.points.length, 4);
  assert.equal(series.points[0].timestamp, start + 12 * 20);
  assert.equal(series.points.at(-1).timestamp, start + 49 * 20);
  assert.equal(series.points.at(-1).intensity, 49);
  assert.ok(series.points.every((point) => point.intensity <= 100));
});

test("the series keeps about 60 seconds and then resets", () => {
  const series = createIntensitySeries();
  const count = 70 * 50;
  for (let i = 0; i < count; i += 1) series.push(start + i * 20, 0.25);
  const newest = series.points.at(-1).timestamp;
  assert.equal(newest, start + (count - 1) * 20);
  assert.ok(series.points[0].timestamp >= newest - CHART_WINDOW_MS);
  assert.ok(newest - series.points[0].timestamp <= CHART_WINDOW_MS);
  assert.ok(series.points.length >= 236);
  assert.ok(series.points.length <= CHART_POINT_CAP);
  assert.equal(series.points.at(-1).intensity, 25);
  series.reset();
  assert.equal(series.points.length, 0);
});
