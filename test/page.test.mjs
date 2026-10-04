import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");

test("page shows the coach link and accelerometer axes", () => {
  assert.match(html, /SpeakSmart/);
  assert.match(html, /wrist coach/i);
  assert.match(html, /A movement graph and slides come in later phases/);
  assert.match(html, /id="intensity-value"/);
  assert.match(html, /id="intensity-meter"/);
  assert.match(html, /id="accel-x"/);
  assert.match(html, /id="accel-y"/);
  assert.match(html, /id="accel-z"/);
  assert.match(html, /Units unknown/);
  assert.match(html, /Dashboard/);
  for (const label of ["Presentation", "Practice", "Analytics", "Settings"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /Later/);
  assert.match(html, /id="reconnect"/);
  for (const status of ["Connected", "Connecting", "Disconnected"]) {
    assert.match(script, new RegExp(status));
  }
  assert.match(script, /development-stand-in/);
  assert.match(script, /intensity-value/);
  assert.doesNotMatch(html, /<canvas/);
  assert.doesNotMatch(html, /<svg/);
});
