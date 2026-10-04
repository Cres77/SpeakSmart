"""USB host calls for one FreeWili. Nothing in this file talks to the coach WebSocket.

OG firmware does not speak freewili-python. Commands use OneWili, pinned in
bridge/requirements.txt to commit b0eeccda21b0594c8062cd17e9755f0c26b0cf6b.
Line numbers below are that commit's python/onewili tree.

- Do not call the package connect helper. __init__.py:51-59 can fall back to ports[0],
  which may be the Display CDC port. Open the Main port explicitly:
  OneWili(port_name).open() (device.py:18, 33-35).
- The port string is taken the way OneWili._port_path does (__init__.py:82-87):
  the first truthy value among port, path, port_name, location. The interface
  itself must be Main CDC VID 0x093C PID 0x2054 (freewili-finder usbdef.hpp
  USB_PID_FW_MAIN_CDC_PID). Display 0x093C:0x2055 is not opened.
  Espressif USB JTAG/serial debug unit 0x303a:0x1001 is not a FreeWili.
- Transport.open() uses BAUD_RATE = 1_000_000 (transport.py:10, 131). This
  file does not open a serial port and does not pass a baud rate.
- dev.hardware.power_management.set_zone(zone, on) (power_management.py:45-61).
  Zone 1 is Sensors. Zone 3 is Audio. docs/errors.md: EPOWERZONE means the
  zone was off.
- dev.io.sensors.enable_motion_stream(stream_rate_ms) (sensors.py:23-38).
  0 stops the stream. The motion event payload is ax_mg, ay_mg, az_mg,
  gx_ddps, gy_ddps, gz_ddps (sensors.py:16-17). ax/ay/az are milli-g.
  motion_axes divides those three by 1000 so the sensor frame is in g.
  Gyro fields are ignored. Frames are ResponseFrame (framing.py:41-62);
  path '*motion' and response is the space-separated payload.
- Events arrive on dev._transport.events (transport.py:116). OneWili has no
  public events property. MenuBase._call flushes that queue before every
  command (menubase.py:21, transport.py:162-168), so a command during the
  stream drops queued samples. The drain thread only reads the queue.
- dev.io.audio.tone(frequency, duration_ms, amplitude) (audio.py:131-148).
  Duration is milliseconds. played is true only when that Result is Ok.
- OneWili at this commit has no firmware-version or app-info call.
  hardware.system.device_state is not a version. display_bl_version is not
  called. pyfwfinder FreeWiliDevice.name / USBDevice.name (pyfwfinder 0.6.0
  stub) is the USB product string, not an OneWili version.
- There is no IP open. FREEWILI_HOST is not a connection.
"""

import math
import queue
import sys
import threading
import time

ONEWILI_COMMIT = "b0eeccda21b0594c8062cd17e9755f0c26b0cf6b"
# freewili-finder USB_PID_FW_MAIN_CDC_PID / USB_PID_FW_DISPLAY_CDC_PID.
MAIN_CDC_ID = (0x093C, 0x2054)
DISPLAY_CDC_ID = (0x093C, 0x2055)
FTDI_ID = (0x0403, 0x6014)
NAMED_USB_IDS = (FTDI_ID, MAIN_CDC_ID, DISPLAY_CDC_ID)
# Espressif USB JTAG/serial debug unit. Not a FreeWili.
ESPRESSIF_DEBUG_ID = (0x303A, 0x1001)
LISTEN_NOTE = "Listen for the tone."
# set_zone and tone each wait up to Transport.DEFAULT_TIMEOUT (5 s).
COMMAND_WAIT_SEC = 12


def install_command(platform=None):
    """pip line for this OS. Windows uses the py launcher and a backslash path."""
    if (platform or sys.platform) == "win32":
        return "py -m pip install -r bridge\\requirements.txt"
    return "python3 -m pip install -r bridge/requirements.txt"


INSTALL_COMMAND = install_command()


def python_requirement_message(platform=None):
    """Text when Python 3.11+ is missing. OneWili installs from a git URL."""
    plat = platform or sys.platform
    if plat == "win32":
        setup = (
            "Install 64-bit Python 3.11 or newer from python.org, with "
            '"Add python.exe to PATH" checked. Git is required, because '
            "OneWili installs from a git URL."
        )
    else:
        setup = "Git is required, because OneWili installs from a git URL."
    return (
        "Python 3.11 or newer is required to open the FreeWili over USB.\n"
        f"{setup}\n"
        "Then run:\n"
        f"  {install_command(plat)}"
    )


class LibraryMissing(Exception):
    def __init__(self):
        super().__init__(
            "The onewili package is not installed, so this process cannot open a FreeWili.\n"
            "Git is required, because OneWili installs from a git URL.\n"
            "Install it with:\n"
            f"  {INSTALL_COMMAND}"
        )


def device_serials(device):
    found = []
    inner = getattr(device, "device", None)
    for obj in (device, inner):
        if obj is None:
            continue
        serial = getattr(obj, "serial", None)
        if isinstance(serial, str) and serial:
            found.append(serial)
    for usb in getattr(device, "usb_devices", None) or []:
        serial = getattr(usb, "serial", None)
        if isinstance(serial, str) and serial:
            found.append(serial)
    return found


def usb_id(usb):
    return (getattr(usb, "vid", None), getattr(usb, "pid", None))


def has_named_usb(device):
    """True when one interface is FTDI 0x0403:0x6014 or CDC 0x093C:0x2054 or 0x093C:0x2055.

    VID 0x303a PID 0x1001 is ignored. That Espressif debug port is not a FreeWili.
    """
    for usb in getattr(device, "usb_devices", None) or []:
        pair = usb_id(usb)
        if pair == ESPRESSIF_DEBUG_ID:
            continue
        if pair in NAMED_USB_IDS:
            return True
    return False


def espressif_debug_only(devices):
    """True when every returned device is only the Espressif debug port."""
    if not devices:
        return False
    saw_debug = False
    for device in devices:
        interfaces = list(getattr(device, "usb_devices", None) or [])
        if not interfaces:
            return False
        for usb in interfaces:
            if usb_id(usb) != ESPRESSIF_DEBUG_ID:
                return False
            saw_debug = True
    return saw_debug


def requested_serial(serial):
    """Empty means the only plugged-in board. A value is a filter."""
    if not isinstance(serial, str):
        return ""
    return serial.strip()


def board_identity(device):
    """Serial the finder reports for the board. Used as deviceId after open()."""
    inner = getattr(device, "device", None)
    for obj in (inner, device):
        if obj is None:
            continue
        serial = getattr(obj, "serial", None)
        if isinstance(serial, str) and serial:
            return serial
    found = device_serials(device)
    return found[0] if found else ""


def select_device(devices, serial):
    """Pick one FreeWili from pyfwfinder.find_all() that has a named USB interface.

    One board is used even when its serial is not a filter. FREEWILI_SERIAL
    filters when it is set, and it is required when more than one board is present.
    Several boards and an empty filter select nothing. An Espressif debug port
    does not count as a board. Selection does not open a port.
    """
    wanted = requested_serial(serial)
    class_devices = [device for device in devices if has_named_usb(device)]
    if len(class_devices) == 1:
        only = class_devices[0]
        if wanted and wanted not in device_serials(only):
            return None
        return only
    if len(class_devices) > 1:
        if not wanted:
            return None
        matches = [device for device in class_devices if wanted in device_serials(device)]
        return matches[0] if len(matches) == 1 else None
    return None


def describe_missing(devices, serial):
    """Text for a failed selection. This is not a coach hello."""
    wanted = requested_serial(serial)
    class_devices = [device for device in devices if has_named_usb(device)]
    if len(class_devices) > 1 and not wanted:
        listed = ", ".join(board_identity(device) or "(no serial)" for device in class_devices)
        return f"Several FreeWilis are plugged in: {listed}. Set FREEWILI_SERIAL to choose one."
    if not class_devices and espressif_debug_only(devices):
        serials = [board_identity(device) for device in devices]
        serials = [item for item in serials if item]
        shown = f", serial {', '.join(serials)}" if serials else ""
        return f"USB JTAG/serial debug unit (Espressif 0x303a:0x1001{shown}) is not a FreeWili."
    if wanted:
        return f"FreeWili {wanted} not found"
    return "FreeWili not found"


def port_path(usb):
    """Same attribute order as OneWili._port_path (__init__.py:82-87).

    The result is the finder string as reported, including a Windows COM name.
    """
    for attr in ("port", "path", "port_name", "location"):
        value = getattr(usb, attr, None)
        if value:
            return str(value)
    return None


def main_cdc_port(device):
    """Port path for the single Main CDC interface 0x093C:0x2054.

    Display 0x093C:0x2055 is never returned. A missing or duplicate Main
    interface returns None.
    """
    matches = []
    for usb in getattr(device, "usb_devices", None) or []:
        if usb_id(usb) == MAIN_CDC_ID:
            matches.append(usb)
    if len(matches) != 1:
        return None
    return port_path(matches[0])


def main_product_name(device):
    for usb in getattr(device, "usb_devices", None) or []:
        if usb_id(usb) == MAIN_CDC_ID:
            name = getattr(usb, "name", None)
            if isinstance(name, str) and name:
                return name
    name = getattr(device, "name", None)
    return name if isinstance(name, str) and name else ""


def describe_no_main(device):
    label = board_identity(device) or "FreeWili"
    return (
        f"FreeWili {label} has no Main CDC port 0x093c:0x2054. "
        "Display 0x093c:0x2055 is not opened."
    )


class OpenedBoard:
    """One opened OneWili on the Main CDC port. close() releases that port."""

    def __init__(self, onewili, serial, port, product_name):
        self.onewili = onewili
        self.serial = serial
        self.port = port
        self.product_name = product_name
        self.device = type("Inner", (), {"serial": serial})()

    def close(self):
        self.onewili.close()


def open_main_port(port, onewili_cls):
    """Construct OneWili(port) and call open() with no baud argument.

    Transport.open uses 1_000_000 baud. This function passes no baud rate.
    """
    if not isinstance(port, str) or not port:
        return None
    device = onewili_cls(port)
    device.open()
    return device


def open_usb(serial):
    """Return an OpenedBoard, or None when no Main CDC port is selected.

    transport freewili is allowed only after this returns a board. Display is
    not opened. This function does not scan raw serial-port names.
    """
    try:
        import pyfwfinder
        from onewili import OneWili
    except ImportError as ex:
        raise LibraryMissing() from ex
    devices = pyfwfinder.find_all()
    chosen = select_device(devices, serial)
    if chosen is None:
        print(describe_missing(devices, serial), flush=True)
        return None
    port = main_cdc_port(chosen)
    if port is None:
        print(describe_no_main(chosen), flush=True)
        return None
    label = board_identity(chosen) or "FreeWili"
    try:
        onewili = open_main_port(port, OneWili)
    except Exception as ex:
        print(f"FreeWili {label} did not open Main port {port}: {ex}", flush=True)
        return None
    print(f"Opened Main CDC 0x093c:0x2054 at {port} for {label}.", flush=True)
    return OpenedBoard(onewili, board_identity(chosen), port, main_product_name(chosen))


def hello_message(serial, timestamp):
    """Coach hello. None unless a serial was actually opened. Never used for the stand-in."""
    if not isinstance(serial, str) or not serial:
        return None
    return {
        "type": "hello",
        "role": "device",
        "timestamp": timestamp,
        "deviceId": serial,
        "transport": "freewili",
    }


def motion_axes(frame):
    """x, y, z in g from a *motion frame. Gyro fields are dropped.

    ResponseFrame.response is the payload after the sequence (framing.py:56-60).
    sensors.py lists ax_mg, ay_mg, az_mg first. Those integers are milli-g.
    Divide by 1000 before the sample is queued. sensor_message sends that
    value, so a 350 mg axis is 0.35 in the sensor frame.
    """
    if getattr(frame, "path", None) != "*motion":
        return None
    response = getattr(frame, "response", None)
    if not isinstance(response, str):
        return None
    parts = response.split()
    if len(parts) < 3:
        return None
    try:
        x = int(parts[0]) / 1000
        y = int(parts[1]) / 1000
        z = int(parts[2]) / 1000
    except ValueError:
        return None
    return {"x": x, "y": y, "z": z}


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def result_is_err(result):
    is_err = getattr(result, "is_err", None)
    return bool(callable(is_err) and is_err())


def result_is_ok(result):
    is_ok = getattr(result, "is_ok", None)
    if callable(is_ok):
        return bool(is_ok())
    is_err = getattr(result, "is_err", None)
    if callable(is_err):
        return not is_err()
    return False


def result_err_text(result):
    err = getattr(result, "err", None)
    if not callable(err):
        return ""
    text = err()
    return text if isinstance(text, str) else str(text)


def result_ok_text(result):
    ok = getattr(result, "ok", None)
    if not callable(ok):
        return result
    return ok()


def log_command(label, result):
    """Print Ok, or Err. An EPOWERZONE failure is logged on its own line."""
    if result_is_err(result):
        err = result_err_text(result)
        if "EPOWERZONE" in err:
            print(f"EPOWERZONE from {label}: {err}", flush=True)
        else:
            print(f"{label}: Err: {err}", flush=True)
        return False
    print(f"{label}: Ok: {result_ok_text(result)}", flush=True)
    return True


def onewili_of(device):
    return getattr(device, "onewili", device)


def start_motion(device, interval_ms):
    """Turn on Sensors zone 1, then enable_motion_stream. Returns whether the stream call was Ok."""
    dev = onewili_of(device)
    zone = dev.hardware.power_management.set_zone(1, 1)
    log_command("set_zone(1, 1) Sensors", zone)
    result = dev.io.sensors.enable_motion_stream(int(interval_ms))
    return log_command(f"enable_motion_stream({int(interval_ms)})", result)


def stop_motion(device):
    dev = onewili_of(device)
    try:
        result = dev.io.sensors.enable_motion_stream(0)
    except Exception as ex:
        print(f"enable_motion_stream(0) raised {ex}", flush=True)
        return
    log_command("enable_motion_stream(0)", result)


def play_pulse(device, frequency_hz, duration_ms, amplitude):
    """Turn on Audio zone 3, then tone(frequency, duration_ms, amplitude).

    Duration stays in milliseconds. played is true only when tone returns Ok.
    set_zone and tone each call flush_queues(), so samples queued during a
    buzz are dropped. The note asks the user to listen either way.
    """
    dev = onewili_of(device)
    frequency = float(frequency_hz)
    duration = float(duration_ms)
    level = float(amplitude)
    try:
        zone = dev.hardware.power_management.set_zone(3, 1)
    except Exception as ex:
        print(f"set_zone(3, 1) Audio raised {ex}", flush=True)
        return {"played": False, "note": f"{ex} {LISTEN_NOTE}"}
    log_command("set_zone(3, 1) Audio", zone)
    try:
        result = dev.io.audio.tone(frequency, duration, level)
    except Exception as ex:
        print(f"tone raised {ex}", flush=True)
        return {"played": False, "note": f"{ex} {LISTEN_NOTE}"}
    ok = log_command(f"tone({frequency}, {duration}, {level})", result)
    if ok:
        return {"played": True, "note": LISTEN_NOTE}
    err = result_err_text(result)
    note = f"{err} {LISTEN_NOTE}" if err else LISTEN_NOTE
    return {"played": False, "note": note}


def sample_window_lines(received, sent, enabled):
    """One 5 second window. enabled means enable_motion_stream returned Ok."""
    lines = [f"accel samples in 5s: received {received}, sent {sent}"]
    if enabled and received == 0:
        lines.append("The board accepted the command but sent no accelerometer samples.")
    return lines


def drain_motion(device, samples, stop_event):
    """Move *motion frames off Transport.events. Does not send commands."""
    events = onewili_of(device)._transport.events
    while not stop_event.is_set():
        try:
            frame = events.get(timeout=0.2)
        except queue.Empty:
            continue
        sample = motion_axes(frame)
        if sample is not None:
            samples.push(sample)


def run_device(device, samples, commands, stop_event, failed, interval_ms):
    """Stream motion on a drain thread. Buzz commands run on this thread.

    A buzz calls set_zone and tone, and each of those clears Transport.events.
    Samples waiting in that queue are dropped. The drain thread does not send
    commands.
    """
    reader_stop = threading.Event()
    reader = threading.Thread(target=drain_motion, args=(device, samples, reader_stop), daemon=True)
    enabled = False
    try:
        reader.start()
        enabled = start_motion(device, interval_ms)
        window_started = time.monotonic()
        while not stop_event.is_set() and not failed.is_set():
            command = _next_command(commands)
            if command is not None:
                pulse = play_pulse(device, command["frequency"], command["duration"], command["amplitude"])
                command["reply"].put(pulse)
            if time.monotonic() - window_started >= 5:
                received, sent = samples.take_counts()
                for line in sample_window_lines(received, sent, enabled):
                    print(line, flush=True)
                window_started = time.monotonic()
            stop_event.wait(0.005)
    except Exception as ex:
        print(f"FreeWili read failed: {ex}", flush=True)
        failed.set()
    finally:
        reader_stop.set()
        reader.join(timeout=1)
        stop_motion(device)


def _next_command(commands):
    try:
        return commands.get_nowait()
    except Exception:
        return None


def network_target(_host):
    """OneWili(port).open() takes no IP address."""
    return None


def ignored_host_message(host):
    if not isinstance(host, str) or not host.strip():
        return None
    shown = host.strip()
    return (
        f"FREEWILI_HOST={shown} is unused. "
        "OneWili opens the Main CDC serial port with OneWili(port).open() and takes no IP address. "
        "The bridge stays on USB."
    )
