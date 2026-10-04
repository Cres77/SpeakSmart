import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { browserHello } from "../shared/protocol.mjs";
import { resolvePython } from "../shared/python.mjs";
import { startCoachServer } from "../server/index.mjs";

const python = resolvePython();

function waitFor(socket, predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      reject(new Error("timed out waiting for a websocket message"));
    }, timeout);
    function onMessage(event) {
      const message = JSON.parse(event.data);
      if (!predicate(message)) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(message);
    }
    socket.addEventListener("message", onMessage);
  });
}

function opened(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("socket failed")), { once: true });
  });
}

test("usb serial matching does not need a board", () => {
  assert.ok(python, "Python 3.11 or newer is required for the bridge tests");
  const result = spawnSync(python.command, [...python.args, "test/usb_bridge_test.py"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("a hello for serial FW4923 is labeled freewili and a 350 mg line is 0.35 g", async () => {
  const app = await startCoachServer({ port: 0, standIn: false });
  assert.ok(python, "Python 3.11 or newer is required for the bridge tests");
  const child = spawn(python.command, [...python.args, "-c", bridgeScript(app.port)], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => {
    logs += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    logs += chunk.toString();
  });
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${app.port}/ws`);
    await opened(socket);
    const first = waitFor(socket, (message) => message.type === "link");
    socket.send(JSON.stringify(browserHello()));
    const link = await first;
    const connected = link.status === "connected"
      ? link
      : await waitFor(socket, (message) => message.status === "connected" && message.transport === "freewili");
    assert.equal(connected.transport, "freewili");
    assert.equal(connected.deviceId, "FW4923");
    const sample = await waitFor(socket, (message) => message.type === "sensor");
    assert.equal(sample.transport, "freewili");
    assert.deepEqual(sample.accel, { x: 0.35, y: 0, z: 1 });
    const ackWait = waitFor(socket, (message) => message.type === "buzz");
    socket.send(JSON.stringify({
      type: "buzz",
      role: "browser",
      frequency: 350,
      duration: 150,
      amplitude: 0.2,
      timestamp: Date.now(),
    }));
    const ack = await ackWait;
    assert.equal(ack.played, true);
    assert.equal(ack.note, "Listen for the tone.");
    assert.match(logs, /TONE 350\.0 150\.0 0\.2/);
    assert.match(logs, /ZONE 3 1/);
    socket.close();
  } finally {
    child.kill("SIGTERM");
    await app.close();
  }
});

function bridgeScript(port) {
  return `
import queue, sys, threading, time
from pathlib import Path
sys.path.insert(0, str(Path("bridge").resolve()))
from freewili_usb import motion_axes, play_pulse
from freewili_bridge import SampleQueue, serve_link

samples = SampleQueue(8)
commands = queue.Queue()
stop = threading.Event()
failed = threading.Event()

def answer():
    while not stop.is_set():
        try:
            command = commands.get(timeout=0.1)
        except queue.Empty:
            continue
        class Result:
            def is_ok(self):
                return True
            def is_err(self):
                return False
            def ok(self):
                return None
        class Power:
            def set_zone(self, zone, on):
                print(f"ZONE {zone} {on}", flush=True)
                return Result()
        class Audio:
            def tone(self, frequency, duration_ms, amplitude):
                print(f"TONE {frequency} {duration_ms} {amplitude}", flush=True)
                return Result()
        class Fake:
            def __init__(self):
                self.hardware = type("H", (), {"power_management": Power()})()
                self.io = type("I", (), {"audio": Audio()})()
        command["reply"].put(play_pulse(Fake(), command["frequency"], command["duration"], command["amplitude"]))

threading.Thread(target=answer, daemon=True).start()
class Motion:
    path = "*motion"
    response = "350 0 1000 4 5 6"
threading.Thread(target=lambda: (time.sleep(0.2), samples.push(motion_axes(Motion()))), daemon=True).start()
serve_link("127.0.0.1", ${port}, "FW4923", samples, commands, stop, failed, {"heartbeatIntervalMs": 2000, "sampleRateHz": 50})
`;
}
