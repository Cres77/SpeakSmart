import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");

test("page shows the coach link and accelerometer axes", () => {
  assert.match(html, /SpeakSmart/);
  assert.match(html, /wrist coach/i);
  assert.match(html, /A coaching summary comes in a later phase/);
  assert.match(html, /id="nav-presentation"/);
  assert.doesNotMatch(html, /id="nav-presentation"[^>]*disabled/);
  assert.match(html, /id="nav-practice"/);
  assert.doesNotMatch(html, /id="nav-practice"[^>]*disabled/);
  assert.match(html, /id="practice-start"/);
  assert.match(script, /SESSION_STORAGE_KEY/);
  assert.match(html, /id="nav-analytics" disabled/);
  assert.match(html, /id="nav-settings" disabled/);
  assert.match(html, /id="present-start"/);
  assert.match(html, /id="present-end"/);
  assert.match(script, /DECK_STORAGE_KEY/);
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
  assert.match(html, /id="intensity-chart"/);
  assert.match(html, /src="\/chart\.js"/);
  assert.match(script, /createIntensitySeries/);
  assert.match(script, /text: "Time"/);
  assert.match(script, /text: "Intensity"/);
  assert.match(script, /series\.push\(message\.timestamp, message\.movement\)/);
  assert.doesNotMatch(html, /<svg/);
  assert.doesNotMatch(html, /buzz/i);
});
