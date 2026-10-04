/* Pick one Python 3.11+ command for the USB bridge.
 * pyfwfinder 0.6.0 publishes Windows wheels for cp311 and cp312-abi3 (win_amd64).
 * The Microsoft Store alias prints "Python was not found" and is skipped.
 */

import { spawnSync } from "node:child_process";

export const MIN_PYTHON = [3, 11];

export function installCommand(platform = process.platform) {
  if (platform === "win32") return "py -m pip install -r bridge\\requirements.txt";
  return "python3 -m pip install -r bridge/requirements.txt";
}

export function pythonMissingMessage(platform = process.platform) {
  const setup = platform === "win32"
    ? 'Install 64-bit Python 3.11 or newer from python.org, with "Add python.exe to PATH" checked. Git is required, because OneWili installs from a git URL.'
    : "Git is required, because OneWili installs from a git URL.";
  return [
    "Python 3.11 or newer is required to open the FreeWili over USB.",
    setup,
    "Then run:",
    `  ${installCommand(platform)}`,
  ].join("\n");
}

export function pythonCandidates(platform = process.platform, env = process.env) {
  const override = typeof env.SPEAKSMART_PYTHON === "string" ? env.SPEAKSMART_PYTHON.trim() : "";
  if (override) return [[override]];
  if (platform === "win32") return [["py", "-3"], ["python"]];
  return [["python3"], ["python"]];
}

export function parsePythonVersion(text) {
  const match = String(text ?? "").match(/Python\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : 0];
}

export function versionIsSupported(version, minimum = MIN_PYTHON) {
  if (!version) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    const part = version[index] ?? 0;
    if (part > minimum[index]) return true;
    if (part < minimum[index]) return false;
  }
  return true;
}

export function isStoreAlias(result) {
  if (!result) return false;
  const text = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (/python was not found/i.test(text)) return true;
  if (/microsoft store/i.test(text)) return true;
  return result.status === 9009;
}

export function probePython(argv) {
  const [command, ...args] = argv;
  const result = spawnSync(command, [...args, "--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 10000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

export function resolvePython({ platform = process.platform, env = process.env, probe = probePython } = {}) {
  for (const argv of pythonCandidates(platform, env)) {
    let result;
    try {
      result = probe(argv);
    } catch {
      continue;
    }
    if (!result || result.error) continue;
    if (isStoreAlias(result)) continue;
    if (result.status !== 0) continue;
    const version = result.version ?? parsePythonVersion(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    if (!versionIsSupported(version)) continue;
    return { command: argv[0], args: argv.slice(1), version };
  }
  return null;
}
