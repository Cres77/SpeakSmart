"""USB host calls for one FreeWili. Nothing in this file talks to the coach WebSocket.

Verified API, freewili 0.0.51 (https://pypi.org/project/freewili/0.0.51/)
and the docs it publishes:

- FreeWili.find_all() -> tuple[FreeWili, ...]
  https://freewili.github.io/freewili-python/api/fw.html
  Package source freewili/fw.py: find_all() calls pyfwfinder.find_all() and
  wraps each FreeWiliDevice. FreeWili.device.serial is the board serial
  (FreeWili.__str__ prints self.device.serial).
- pyfwfinder 0.5.0 stub pyfwfinder.pyi:
  FreeWiliDevice.serial: str
  FreeWiliDevice.usb_devices: list[USBDevice]
  USBDevice.vid: int
  USBDevice.pid: int
  USBDevice.serial: str
- USB IDs named by pyfwfinder 0.5.0, which freewili.find_all uses.
  freewili-finder v0.5.0 include/usbdef.hpp
  (https://github.com/freewili/freewili-finder/blob/v0.5.0/include/usbdef.hpp):
  USB_VID_FW_FTDI = 0x0403, USB_PID_FW_FTDI = 0x6014
  USB_VID_FW2_FTDI = 0x0403, USB_PID_FW2_FTDI = 0x6014
  USB_VID_FW_ICS = 0x093C
  USB_PID_FW_MAIN_CDC_PID = 0x2054
  USB_PID_FW_DISPLAY_CDC_PID = 0x2055
  find_all() returns one FreeWili per board. open() opens main_serial and
  display_serial (the CDC ports). This file does not scan serial-port names.
  Espressif USB JTAG/serial debug unit VID 0x303a PID 0x1001 is not in that
  list. find_all() matching ignores it. It is not a FreeWili.
- FreeWili.open(block=True, timeout_sec=6.0) -> Ok[None] | Err[str]
  FreeWili.close(restore_menu=True) -> None
  FreeWili.main_serial / FreeWili.display_serial -> None | FreeWiliSerial
  Result.is_err() and Result.err() are what fw.py uses on open().
- FreeWili.set_event_callback(cb) with cb(event_type, frame, data).
  None disables the callback.
  https://freewili.github.io/freewili-python/examples.html
  Event Handling (Console): set_event_callback, then
  enable_accel_events(True, interval_ms), then process_events() in a loop.
- FreeWili.enable_accel_events(enable, interval_ms=None,
  processor=FreeWiliProcessorType.Display) -> Ok[str] | Err[str]
- AccelData(g, x, y, z, temp_c, temp_f) named fields x, y, z, and g.
  https://freewili.github.io/freewili-python/api/types.html
  EventType.Accel is the accelerometer event. Units are not stated there.
  Values are passed through. They are not scaled.
- FreeWili.play_audio_tone(frequency_hz: int, duration_sec: float,
  amplitude: float, processor=Display) -> Ok[str] | Err[str]
  The Audio Playback - Tone example says:
  "v54 firmware: Response frame always returns failure"
  and does not treat that return as success. played stays false for that reason.

freewili 0.0.51 constructs FreeWili from a USB FreeWiliDevice only.
FreeWili.find_all and FreeWili.open take no IP address. There is no Wi-Fi
client in this package, so FREEWILI_HOST is not a connection.
"""

import math
import time

# Named in freewili-finder v0.5.0 include/usbdef.hpp. One board can expose all of these.
NAMED_USB_IDS = (
    (0x0403, 0x6014),  # USB_VID_FW_FTDI, USB_PID_FW_FTDI
    (0x093C, 0x2054),  # USB_VID_FW_ICS, USB_PID_FW_MAIN_CDC_PID
    (0x093C, 0x2055),  # USB_VID_FW_ICS, USB_PID_FW_DISPLAY_CDC_PID
)
# Espressif USB JTAG/serial debug unit. Not a FreeWili accelerometer port.
ESPRESSIF_DEBUG_ID = (0x303A, 0x1001)
TONE_FAILURE_NOTE = "v54 firmware: Response frame always returns failure"
INSTALL_COMMAND = "python3 -m pip install -r bridge/requirements.txt"


class LibraryMissing(Exception):
    def __init__(self):
        super().__init__(
            "The freewili package is not installed, so this process cannot open a FreeWili.\n"
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
    """True when one interface is FTDI 0x0403:0x6014 or Intrepid CDC 0x093C:0x2054 or 0x093C:0x2055.

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
    """Serial the library reports for the board. Used as deviceId after open()."""
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
    """Pick one FreeWili from find_all() that has a named USB interface.

    One board is used even when its serial is not the filter. FREEWILI_SERIAL
    filters when it is set, and it is required when more than one board is present.
    Several boards and an empty filter select nothing. An Espressif debug port
    does not count as a board.
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


def axes_from_accel_data(data):
    """Copy AccelData.x, y, z, and g when g is present. No unit conversion."""
    x = getattr(data, "x", None)
    y = getattr(data, "y", None)
    z = getattr(data, "z", None)
    if not _finite(x) or not _finite(y) or not _finite(z):
        return None
    sample = {"x": x, "y": y, "z": z}
    g = getattr(data, "g", None)
    if _finite(g):
        sample["g"] = g
    return sample


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def response_frame_timeout(text):
    """True for the library's response-frame timeout string."""
    return isinstance(text, str) and "Failed to read response frame" in text


def result_is_err(result):
    is_err = getattr(result, "is_err", None)
    return bool(callable(is_err) and is_err())


def result_err_text(result):
    err = getattr(result, "err", None)
    if not callable(err):
        return ""
    text = err()
    return text if isinstance(text, str) else str(text)


def play_pulse(device, frequency_hz, duration_ms, amplitude, processors):
    """Call play_audio_tone. Duration in the protocol is milliseconds; the API takes seconds.

    Display is first. A response-frame timeout tries the next processor.
    The v54 response frame is unreliable, so played stays false. This does not
    report that a tone was heard.
    """
    duration_sec = float(duration_ms) / 1000.0
    frequency = int(frequency_hz)
    level = float(amplitude)
    for index, processor in enumerate(processors):
        name = getattr(processor, "name", str(processor))
        try:
            result = device.play_audio_tone(frequency, duration_sec, level, processor)
        except Exception as ex:
            print(f"play_audio_tone {name} raised {ex}", flush=True)
            if index == 0 and response_frame_timeout(str(ex)):
                continue
            break
        if result_is_err(result):
            err = result_err_text(result)
            print(f"play_audio_tone {name}: Err: {err}", flush=True)
            if index == 0 and response_frame_timeout(err):
                continue
            break
        ok = getattr(result, "ok", None)
        value = ok() if callable(ok) else result
        print(f"play_audio_tone {name}: Ok: {value}", flush=True)
        break
    return {"played": False, "note": TONE_FAILURE_NOTE}


def sample_window_lines(received, sent, enabled):
    """One 5 second USB window. enabled means enable_accel_events returned Ok."""
    lines = [f"accel samples in 5s: received {received}, sent {sent}"]
    if enabled and received == 0:
        lines.append("The board accepted the command but sent no accelerometer samples.")
    return lines


def network_target(_host):
    """freewili 0.0.51 has no IP open. A Wi-Fi address is not a target."""
    return None


def ignored_host_message(host):
    if not isinstance(host, str) or not host.strip():
        return None
    shown = host.strip()
    return (
        f"FREEWILI_HOST={shown} is unused. "
        "freewili 0.0.51 opens boards with FreeWili.find_all() and FreeWili.open(), "
        "which attach to USB serial ports and take no IP address. "
        "The bridge stays on USB."
    )


def open_usb(serial):
    """Return an opened FreeWili, or None when no single board is selected.

    transport freewili is allowed only after this returns a device. open() uses the
    library's main and display serial ports. This function does not scan port names.
    """
    try:
        from freewili import FreeWili
    except ImportError as ex:
        raise LibraryMissing() from ex
    devices = FreeWili.find_all()
    chosen = select_device(devices, serial)
    if chosen is None:
        print(describe_missing(devices, serial), flush=True)
        return None
    opened = chosen.open()
    label = board_identity(chosen) or requested_serial(serial) or "FreeWili"
    if opened.is_err():
        print(f"FreeWili {label} did not open: {opened.err()}", flush=True)
        _close_quiet(chosen)
        return None
    if chosen.main_serial is None and chosen.display_serial is None:
        print(f"FreeWili {label} did not open a serial port.", flush=True)
        _close_quiet(chosen)
        return None
    return chosen


def start_accel_events(device, interval_ms, processors):
    """Call enable_accel_events until one processor returns Ok.

    processors are FreeWiliProcessorType values. Display is first, then Main.
    The Result methods is_err() and err() are the ones fw.py uses. A timeout
    string from err() is a failure of that processor. Samples are not invented here.
    """
    interval = int(interval_ms)
    for processor in processors:
        name = getattr(processor, "name", str(processor))
        result = device.enable_accel_events(True, interval, processor)
        if result.is_err():
            print(f"enable_accel_events {name} failed: {result.err()}", flush=True)
            continue
        print(f"enable_accel_events Ok on {name}", flush=True)
        return processor
    print("enable_accel_events failed on Display and Main", flush=True)
    return None


def run_device(device, samples, commands, stop_event, failed, interval_ms):
    """Read AccelData on this thread. samples.push must not send on the WebSocket."""
    from freewili.types import AccelData, EventType

    def callback(event_type, frame, data):
        if event_type != EventType.Accel or not isinstance(data, AccelData):
            return
        sample = axes_from_accel_data(data)
        if sample is not None:
            samples.push(sample)

    from freewili.types import FreeWiliProcessorType

    enabled_on = None
    try:
        device.set_event_callback(callback)
        enabled_on = start_accel_events(
            device,
            interval_ms,
            (FreeWiliProcessorType.Display, FreeWiliProcessorType.Main),
        )
        window_started = time.monotonic()
        while not stop_event.is_set() and not failed.is_set():
            command = _next_command(commands)
            if command is not None:
                pulse = play_pulse(
                    device,
                    command["frequency"],
                    command["duration"],
                    command["amplitude"],
                    (FreeWiliProcessorType.Display, FreeWiliProcessorType.Main),
                )
                command["reply"].put(pulse)
            device.process_events()
            if time.monotonic() - window_started >= 5:
                received, sent = samples.take_counts()
                for line in sample_window_lines(received, sent, enabled_on is not None):
                    print(line, flush=True)
                window_started = time.monotonic()
            stop_event.wait(0.005)
    except Exception as ex:
        print(f"FreeWili read failed: {ex}", flush=True)
        failed.set()
    finally:
        if enabled_on is not None:
            try:
                device.enable_accel_events(False, None, enabled_on)
            except Exception:
                pass
        try:
            device.set_event_callback(None)
        except Exception:
            pass


def _next_command(commands):
    try:
        return commands.get_nowait()
    except Exception:
        return None


def _close_quiet(device):
    try:
        device.close()
    except Exception:
        pass
