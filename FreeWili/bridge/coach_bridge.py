"""Coach WebSocket client. Hardware calls stay in freewili_usb.py.

Speaks FreeWili/shared/PROTOCOL.md: hello, heartbeat, sensor, buzz ack.
Samples are queued. The WebSocket send runs on another thread.
"""

import json
import os
import queue
import signal
import socket
import struct
import sys
import threading
import time
import base64
import hashlib
from pathlib import Path

from freewili_usb import (
    INSTALL_COMMAND,
    LibraryMissing,
    TONE_FAILURE_NOTE,
    board_identity,
    hello_message,
    ignored_host_message,
    open_usb,
    run_device,
)

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "shared" / "config.json"
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
SAMPLE_LIMIT = 8


def load_config():
    with CONFIG_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def now_ms():
    return int(time.time() * 1000)


class SampleQueue:
    """Bounded queue. push never waits on a socket."""

    def __init__(self, limit=SAMPLE_LIMIT):
        self._items = queue.Queue(limit)

    def push(self, sample):
        while True:
            try:
                self._items.put_nowait(sample)
                return
            except queue.Full:
                try:
                    self._items.get_nowait()
                except queue.Empty:
                    continue

    def pop_nowait(self):
        try:
            return self._items.get_nowait()
        except queue.Empty:
            return None


class CoachSocket:
    def __init__(self, host, port, path="/ws"):
        self.host = host
        self.port = int(port)
        self.path = path
        self.sock = None
        self.buf = b""

    def connect(self, timeout=5):
        sock = socket.create_connection((self.host, self.port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        sock.sendall(request.encode())
        raw = b""
        while b"\r\n\r\n" not in raw:
            chunk = sock.recv(4096)
            if not chunk:
                sock.close()
                raise ConnectionError("WebSocket handshake closed")
            raw += chunk
        header, rest = raw.split(b"\r\n\r\n", 1)
        status = header.decode(errors="replace").split("\r\n", 1)[0]
        if " 101 " not in status:
            sock.close()
            raise ConnectionError("WebSocket upgrade failed")
        accept = ""
        for line in header.decode(errors="replace").split("\r\n")[1:]:
            if line.lower().startswith("sec-websocket-accept:"):
                accept = line.split(":", 1)[1].strip()
        expected = base64.b64encode(hashlib.sha1((key + GUID).encode()).digest()).decode()
        if accept != expected:
            sock.close()
            raise ConnectionError("WebSocket accept mismatch")
        sock.settimeout(0.05)
        self.sock = sock
        self.buf = rest

    def close(self):
        sock = self.sock
        self.sock = None
        if sock is None:
            return
        try:
            self._send_frame(sock, 0x8, b"")
        except Exception:
            pass
        try:
            sock.close()
        except Exception:
            pass

    def send_text(self, text):
        if self.sock is None:
            raise ConnectionError("socket is down")
        self._send_frame(self.sock, 0x1, text.encode())

    def _send_frame(self, sock, opcode, payload):
        mask = os.urandom(4)
        length = len(payload)
        header = bytearray([0x80 | opcode])
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", length))
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        sock.sendall(bytes(header) + mask + masked)

    def recv_text(self):
        while True:
            frame = self._read_frame()
            if frame is None:
                return None
            opcode, payload = frame
            if opcode == 0x1:
                return payload.decode()
            if opcode == 0x8:
                raise ConnectionError("WebSocket closed")
            if opcode == 0x9 and self.sock is not None:
                self._send_frame(self.sock, 0xA, payload)

    def _read_exact(self, count, in_frame):
        while len(self.buf) < count:
            try:
                chunk = self.sock.recv(4096)
            except socket.timeout:
                if in_frame:
                    continue
                return None
            if not chunk:
                raise ConnectionError("socket closed")
            self.buf += chunk
        data = self.buf[:count]
        self.buf = self.buf[count:]
        return data

    def _read_frame(self):
        if self.sock is None:
            raise ConnectionError("socket is down")
        head = self._read_exact(2, False)
        if head is None:
            return None
        first, second = head
        opcode = first & 0x0F
        length = second & 0x7F
        masked = second & 0x80
        if length == 126:
            extra = self._read_exact(2, True)
            length = struct.unpack("!H", extra)[0]
        elif length == 127:
            extra = self._read_exact(8, True)
            length = struct.unpack("!Q", extra)[0]
        mask = self._read_exact(4, True) if masked else b""
        payload = self._read_exact(length, True) if length else b""
        if masked:
            payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        return opcode, payload


def heartbeat_message(serial, timestamp):
    return {"type": "heartbeat", "role": "device", "timestamp": timestamp, "deviceId": serial}


def disconnect_message(serial, reason, timestamp):
    return {"type": "disconnect", "role": "device", "timestamp": timestamp, "deviceId": serial, "reason": reason}


def sensor_message(serial, sample, timestamp):
    accel = {"x": sample["x"], "y": sample["y"], "z": sample["z"]}
    if "g" in sample:
        accel["g"] = sample["g"]
    return {
        "type": "sensor",
        "role": "device",
        "timestamp": timestamp,
        "deviceId": serial,
        "accel": accel,
    }


def buzz_ack(message, pulse, timestamp):
    ack = {
        "type": "buzz",
        "role": "device",
        "frequency": message["frequency"],
        "duration": message["duration"],
        "amplitude": message["amplitude"],
        "played": False if pulse is None else pulse["played"],
        "timestamp": timestamp,
    }
    note = TONE_FAILURE_NOTE if pulse is None else pulse.get("note")
    if isinstance(note, str) and note:
        ack["note"] = note
    return ack


def serve_link(host, port, serial, samples, commands, stop_event, failed, config, socket_factory=CoachSocket):
    """Send coach frames. Returns without sending when serial is missing."""
    if hello_message(serial, 0) is None:
        return
    interval = config["heartbeatIntervalMs"] / 1000
    while not stop_event.is_set() and not failed.is_set():
        ws = socket_factory(host, port)
        try:
            ws.connect()
            ws.send_text(json.dumps(hello_message(serial, now_ms())))
            last_beat = time.monotonic()
            while not stop_event.is_set() and not failed.is_set():
                incoming = ws.recv_text()
                if incoming:
                    message = json.loads(incoming)
                    if message.get("type") == "buzz":
                        reply = queue.Queue(1)
                        commands.put({
                            "frequency": message["frequency"],
                            "duration": message["duration"],
                            "amplitude": message["amplitude"],
                            "reply": reply,
                        })
                        try:
                            pulse = reply.get(timeout=2)
                        except queue.Empty:
                            pulse = None
                        ws.send_text(json.dumps(buzz_ack(message, pulse, now_ms())))
                    elif message.get("type") == "reconnect":
                        ws.send_text(json.dumps(disconnect_message(serial, "reconnect", now_ms())))
                        break
                if time.monotonic() - last_beat >= interval:
                    ws.send_text(json.dumps(heartbeat_message(serial, now_ms())))
                    last_beat = time.monotonic()
                while True:
                    sample = samples.pop_nowait()
                    if sample is None:
                        break
                    ws.send_text(json.dumps(sensor_message(serial, sample, now_ms())))
        except Exception:
            if stop_event.is_set():
                break
        finally:
            ws.close()
        if stop_event.wait(0.4):
            break


def run_coach(*, host, port, serial, open_device, stop_event, attempts=None, socket_factory=CoachSocket, config=None, announce_missing=True):
    """Try USB. A missing board does not send transport freewili.

    deviceId is the serial the opened board reports. An empty filter still
    uses that board. announce_missing prints the not-found line when the
    opener itself stayed quiet. open_usb already prints, so main passes False.
    """
    config = config or load_config()
    interval_ms = max(1, round(1000 / config["sampleRateHz"]))
    tried = 0
    while not stop_event.is_set():
        if attempts is not None and tried >= attempts:
            return
        tried += 1
        try:
            device = open_device(serial)
        except LibraryMissing as ex:
            print(ex, flush=True)
            raise SystemExit(2) from ex
        identity = board_identity(device) if device is not None else ""
        if device is None or hello_message(identity, 0) is None:
            if device is not None:
                print("FreeWili opened without a serial", flush=True)
                try:
                    device.close()
                except Exception:
                    pass
            elif announce_missing:
                shown = serial.strip() if isinstance(serial, str) else ""
                if shown:
                    print(f"FreeWili {shown} not found", flush=True)
                else:
                    print("FreeWili not found", flush=True)
            if attempts is not None:
                continue
            stop_event.wait(2)
            continue
        failed = threading.Event()
        samples = SampleQueue()
        commands = queue.Queue()
        reader = threading.Thread(
            target=run_device,
            args=(device, samples, commands, stop_event, failed, interval_ms),
            daemon=True,
        )
        reader.start()
        try:
            serve_link(host, port, identity, samples, commands, stop_event, failed, config, socket_factory)
        finally:
            failed.set()
            reader.join(timeout=2)
            try:
                device.close()
            except Exception:
                pass
        if attempts is not None:
            return


def python_too_old():
    print(
        "Python 3.10 or newer is required to open the FreeWili over USB.\n"
        "Install Python, then run:\n"
        f"  {INSTALL_COMMAND}",
        flush=True,
    )
    raise SystemExit(2)


def main():
    if sys.version_info < (3, 10):
        python_too_old()
    host_note = ignored_host_message(os.environ.get("FREEWILI_HOST", ""))
    if host_note:
        print(host_note, flush=True)
    serial = os.environ.get("FREEWILI_SERIAL", "").strip()
    host = os.environ.get("SPEAKSMART_HOST", "127.0.0.1")
    config = load_config()
    port = int(os.environ.get("SPEAKSMART_PORT", config["serverPort"]))
    stop_event = threading.Event()

    def stop(_signum, _frame):
        stop_event.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    run_coach(
        host=host,
        port=port,
        serial=serial,
        open_device=open_usb,
        stop_event=stop_event,
        config=config,
        announce_missing=False,
    )


if __name__ == "__main__":
    main()
