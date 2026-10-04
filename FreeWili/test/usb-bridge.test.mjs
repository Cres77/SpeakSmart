import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { browserHello } from "../shared/protocol.mjs";
import { startCoachServer } from "../server/index.mjs";

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
  const result = spawnSync("python3", ["test/usb_bridge_test.py"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("a hello for serial FW4923 is labeled freewili and passes axes through", async () => {
  const app = await startCoachServer({ port: 0, standIn: false });
  const child = spawn("python3", ["-c", bridgeScript(app.port)], {
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
    assert.deepEqual(sample.accel, { x: 64, y: -768, z: 16448, g: 2 });
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
    assert.equal(ack.played, false);
    assert.equal(ack.note, "v54 firmware: Response frame always returns failure");
    assert.match(logs, /TONE 350 0\.15 0\.2/);
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
from freewili_usb import play_pulse
from coach_bridge import SampleQueue, serve_link

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
        class Processor:
            name = "Display"
        class Fake:
            def play_audio_tone(self, frequency_hz, duration_sec, amplitude, processor):
                print(f"TONE {frequency_hz} {duration_sec} {amplitude}", flush=True)
        command["reply"].put(play_pulse(Fake(), command["frequency"], command["duration"], command["amplitude"], (Processor(),)))

threading.Thread(target=answer, daemon=True).start()
threading.Thread(target=lambda: (time.sleep(0.2), samples.push({"x": 64, "y": -768, "z": 16448, "g": 2})), daemon=True).start()
serve_link("127.0.0.1", ${port}, "FW4923", samples, commands, stop, failed, {"heartbeatIntervalMs": 2000, "sampleRateHz": 50})
`;
}
