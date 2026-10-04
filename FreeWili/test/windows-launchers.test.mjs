import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const start = readFileSync(new URL("../start-windows.bat", import.meta.url), "utf8");
const diagnose = readFileSync(new URL("../diagnose-windows.bat", import.meta.url), "utf8");

function linesOf(text) {
  assert.match(text, /\r\n/);
  assert.doesNotMatch(text, /(?<!\r)\n/);
  return text.split(/\r\n/).filter((line) => line.length > 0);
}

function codeLines(text) {
  return linesOf(text)
    .map((line) => line.trim())
    .filter((line) => line && !/^rem\b/i.test(line) && !line.startsWith("::"));
}

function unquote(line) {
  let quote = false;
  let plain = "";
  for (const ch of line) {
    if (ch === "\"") {
      quote = !quote;
      continue;
    }
    if (!quote) plain += ch;
  }
  return plain;
}

function review(text, name) {
  const labels = new Set();
  const jumps = [];
  let depth = 0;
  for (const line of codeLines(text)) {
    const label = line.match(/^:([A-Za-z0-9_]+)/);
    if (label) labels.add(label[1].toLowerCase());
    const plain = unquote(line);
    for (const ch of plain) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      assert.ok(depth >= 0, `${name} has an extra ) in: ${line}`);
    }
    for (const match of plain.matchAll(/\bgoto\s+([A-Za-z0-9_]+)/gi)) jumps.push(match[1]);
    for (const match of plain.matchAll(/\bcall\s+:([A-Za-z0-9_]+)/gi)) jumps.push(match[1]);
  }
  assert.equal(depth, 0, `${name} has an unclosed (`);
  for (const jump of jumps) {
    assert.ok(labels.has(jump.toLowerCase()), `${name} is missing :${jump}`);
  }
}

test("start-windows.bat is plain batch and installs the three tools", () => {
  review(start, "start-windows.bat");
  assert.match(start, /cd \/d "%~dp0"/);
  assert.match(start, /winget install -e --id %~1 --accept-package-agreements --accept-source-agreements/);
  assert.match(start, /call :install_id OpenJS\.NodeJS\.LTS /);
  assert.match(start, /call :install_id Python\.Python\.3\.12 /);
  assert.match(start, /call :install_id Git\.Git /);
  assert.match(start, /https:\/\/nodejs\.org\/en\/download/);
  assert.match(start, /https:\/\/www\.python\.org\/downloads\/windows\//);
  assert.match(start, /https:\/\/git-scm\.com\/download\/win/);
  assert.match(start, /GetEnvironmentVariable\('Path','Machine'\)/);
  assert.match(start, /GetEnvironmentVariable\('Path','User'\)/);
  assert.match(start, /py -3 -m pip install -r bridge\\requirements\.txt/);
  assert.match(start, /call npm install/);
  assert.match(start, /call npm start/);
  assert.match(start, /ws:\/\/127\.0\.0\.1:4173\/ws/);
  assert.doesNotMatch(start, /__open/);
  assert.doesNotMatch(start, /start "" "http:\/\/127\.0\.0\.1:4173\/"/);
  assert.match(start, /Python was not found/);
  assert.match(start, /\bpause\b/);
  assert.match(start, /__setup/);
  for (const match of start.matchAll(/powershell[^\r\n]*/gi)) {
    assert.match(match[0], /-NoProfile/);
    assert.match(match[0], /-ExecutionPolicy Bypass/);
  }
});

test("diagnose-windows.bat reuses setup and then runs diagnose", () => {
  review(diagnose, "diagnose-windows.bat");
  assert.match(diagnose, /cd \/d "%~dp0"/);
  assert.match(diagnose, /start-windows\.bat" __setup/);
  assert.match(diagnose, /call npm run diagnose/);
  assert.match(diagnose, /\bpause\b/);
  assert.doesNotMatch(diagnose, /npm start/);
});
