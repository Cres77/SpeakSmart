/* Launch bridge/diagnose.py with the shared Python resolver.
 * npm runs `node bridge/diagnose.mjs`, which uses no shell syntax.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pythonMissingMessage, resolvePython } from "../shared/python.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const script = join(here, "diagnose.py");

function isMain() {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(entry).href;
}

export function launchDiagnose({ resolve = resolvePython, spawnChild = spawn, log = console.error, exit = process.exit } = {}) {
  const python = resolve();
  if (!python) {
    log(pythonMissingMessage());
    exit(2);
    return null;
  }
  const child = spawnChild(python.command, [...python.args, script], {
    cwd: root,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("error", (error) => {
    log(error.message);
    exit(2);
  });
  child.on("exit", (code, signal) => {
    if (signal) exit(1);
    else exit(code ?? 1);
  });
  return child;
}

if (isMain()) launchDiagnose();
