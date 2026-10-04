import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  installCommand,
  isStoreAlias,
  pythonMissingMessage,
  resolvePython,
  versionIsSupported,
} from "../shared/python.mjs";

const storeAlias = {
  status: 9009,
  stdout: "",
  stderr: "Python was not found; run without arguments to install from the Microsoft Store, or disable this shortcut from Settings.",
};

function version(text, status = 0) {
  return { status, stdout: text, stderr: "" };
}

test("windows uses py -3 when it is Python 3.11 or newer", () => {
  const calls = [];
  const resolved = resolvePython({
    platform: "win32",
    env: {},
    probe(argv) {
      calls.push(argv.join(" "));
      assert.deepEqual(argv, ["py", "-3"]);
      return version("Python 3.12.3");
    },
  });
  assert.equal(resolved.command, "py");
  assert.deepEqual(resolved.args, ["-3"]);
  assert.deepEqual(resolved.version, [3, 12, 3]);
  assert.deepEqual(calls, ["py -3"]);
});

test("windows skips the Store alias and a Python older than 3.11", () => {
  const calls = [];
  const resolved = resolvePython({
    platform: "win32",
    env: {},
    probe(argv) {
      calls.push(argv.join(" "));
      if (argv[0] === "py") return version("Python 3.10.11");
      return storeAlias;
    },
  });
  assert.equal(resolved, null);
  assert.deepEqual(calls, ["py -3", "python"]);
  assert.equal(isStoreAlias(storeAlias), true);
});

test("windows uses python when py -3 is missing and python is 3.11", () => {
  const resolved = resolvePython({
    platform: "win32",
    env: {},
    probe(argv) {
      if (argv[0] === "py") return { status: null, stdout: "", stderr: "", error: new Error("not found") };
      return version("Python 3.11.0");
    },
  });
  assert.equal(resolved.command, "python");
  assert.deepEqual(resolved.args, []);
  assert.equal(versionIsSupported(resolved.version), true);
});

test("SPEAKSMART_PYTHON is the only candidate", () => {
  const calls = [];
  const resolved = resolvePython({
    platform: "win32",
    env: { SPEAKSMART_PYTHON: "C:\\Python311\\python.exe" },
    probe(argv) {
      calls.push(argv);
      return version("Python 3.11.9");
    },
  });
  assert.deepEqual(calls, [["C:\\Python311\\python.exe"]]);
  assert.equal(resolved.command, "C:\\Python311\\python.exe");
});

test("a Store alias in SPEAKSMART_PYTHON is not replaced with another Python", () => {
  const resolved = resolvePython({
    platform: "linux",
    env: { SPEAKSMART_PYTHON: "python" },
    probe() {
      return storeAlias;
    },
  });
  assert.equal(resolved, null);
});

test("other platforms try python3 and then python", () => {
  const calls = [];
  const resolved = resolvePython({
    platform: "linux",
    env: {},
    probe(argv) {
      calls.push(argv.join(" "));
      if (argv[0] === "python3") return version("Python 3.10.11");
      return version("Python 3.12.3");
    },
  });
  assert.deepEqual(calls, ["python3", "python"]);
  assert.equal(resolved.command, "python");
  assert.equal(versionIsSupported([3, 10, 11]), false);
  assert.equal(versionIsSupported([3, 11, 0]), true);
});

test("the Windows install message names python.org, PATH, Git, and the py command", () => {
  const message = pythonMissingMessage("win32");
  assert.equal(installCommand("win32"), "py -m pip install -r bridge\\requirements.txt");
  assert.match(message, /Python 3\.11 or newer/);
  assert.match(message, /python\.org/);
  assert.match(message, /Add python\.exe to PATH/);
  assert.match(message, /64-bit/);
  assert.match(message, /Git is required/);
  assert.match(message, /py -m pip install -r bridge\\requirements\.txt/);
  const server = readFileSync(new URL("../server/index.mjs", import.meta.url), "utf8");
  assert.match(server, /resolvePython/);
  assert.doesNotMatch(server, /const python = "python3"/);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.scripts.diagnose, "node bridge/diagnose.mjs");
});
