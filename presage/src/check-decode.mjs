import assert from "node:assert/strict";
import { CameraSelection } from "@smartspectra/node-sdk";
import { Metrics, decodeMetrics } from "@smartspectra/node-sdk/messages";

const encoded = Metrics.encode(
  Metrics.create({
    cardio: {
      pulseRate: [{ value: 78, confidence: 92, stable: true }],
      hrv: [{ rmssd: 42, confidence: 60, stable: true }],
    },
    breathing: {
      rate: [{ value: 15, confidence: 70, stable: true }],
    },
  }),
).finish();

const metrics = decodeMetrics(encoded);
const pulse = metrics.cardio?.pulseRate?.at(-1);
const breathing = metrics.breathing?.rate?.at(-1);
const hrv = metrics.cardio?.hrv?.at(-1);

assert.equal(pulse?.value, 78);
assert.equal(pulse?.confidence, 92);
assert.equal(breathing?.value, 15);
assert.equal(hrv?.rmssd, 42);
assert.equal(typeof CameraSelection.default.kind, "string");

console.log("decode check ok: cardio.pulseRate.value, breathing.rate.value, cardio.hrv.rmssd");
