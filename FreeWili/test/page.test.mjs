import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
const script = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");

test("page shows the coach link and accelerometer axes", () => {
  assert.match(html, /SpeakSmart/);
  assert.match(html, /wrist coach/i);
  assert.match(html, /Analytics summarizes a saved practice/);
  assert.match(html, /id="nav-presentation"/);
  assert.doesNotMatch(html, /id="nav-presentation"[^>]*disabled/);
  assert.match(html, /id="nav-practice"/);
  assert.doesNotMatch(html, /id="nav-practice"[^>]*disabled/);
  assert.match(html, /id="practice-start"/);
  assert.match(script, /SESSION_STORAGE_KEY/);
  assert.match(html, /id="nav-analytics"/);
  assert.doesNotMatch(html, /id="nav-analytics"[^>]*disabled/);
  assert.match(html, /id="analytics-lines"/);
  assert.match(html, /id="session-summary"/);
  assert.match(script, /summarizeSession/);
  assert.match(html, /id="nav-settings"/);
  assert.doesNotMatch(html, /id="nav-settings"[^>]*disabled/);
  assert.match(html, /id="buzz-send"/);
  assert.match(html, /id="buzz-test"/);
  assert.match(html, /id="buzz-frequency"/);
  assert.match(html, /id="present-start"/);
  assert.match(html, /id="present-end"/);
  assert.match(script, /DECK_STORAGE_KEY/);
  assert.match(html, /id="intensity-value"/);
  assert.match(html, /id="intensity-meter"/);
  assert.match(html, /id="accel-x"/);
  assert.match(html, /id="accel-y"/);
  assert.match(html, /id="accel-z"/);
  assert.match(html, /id="calibrate"/);
  assert.match(html, /Hold still/);
  assert.match(script, /CALIBRATION_STORAGE_KEY/);
  assert.match(html, /milli-g/);
  assert.match(html, /Dashboard/);
  for (const label of ["Presentation", "Practice", "Analytics", "Settings"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /id="reconnect"/);
  for (const status of ["Connected", "Connecting", "Disconnected"]) {
    assert.match(script, new RegExp(status));
  }
  assert.match(script, /development-stand-in/);
  assert.match(script, /Development stand-in\. This is not a FreeWili\./);
  assert.match(script, /FreeWili \$\{message\.deviceId\} is connected\./);
  assert.match(script, /intensity-value/);
  assert.match(html, /id="motion-state"/);
  assert.match(html, /id="motion-gestures"/);
  assert.match(html, /id="motion-excessive"/);
  assert.match(html, /id="motion-stillness"/);
  assert.match(html, /id="session-gestures"/);
  assert.match(html, /id="session-excessive"/);
  assert.match(script, /createMotionDetector/);
  assert.match(html, /id="intensity-chart"/);
  assert.match(html, /src="\/chart\.js"/);
  assert.match(script, /createIntensitySeries/);
  assert.match(script, /text: "Time"/);
  assert.match(script, /text: "Intensity"/);
  assert.match(script, /series\.push\(message\.timestamp, message\.movement\)/);
  assert.doesNotMatch(html, /<svg/);
  assert.match(script, /BUZZ_STORAGE_KEY/);
  assert.match(script, /createBuzzGuard/);
  assert.match(html, /id="slide-cue"/);
  assert.match(html, /id="stage-cue"/);
  assert.match(html, /Buzz on slide cue/);
  assert.match(html, /id="buzz-cue"/);
  assert.doesNotMatch(html, /id="buzz-cue"[^>]*checked/);
  assert.match(script, /createSlideCues/);
  assert.match(script, /Command returned OK\./);
  assert.match(script, /Command did not return OK\./);
  assert.match(script, /Listen for the tone\./);
  assert.match(script, /FreeWili sample, milli-g\./);
  assert.doesNotMatch(script, /No tone was played/);
});
