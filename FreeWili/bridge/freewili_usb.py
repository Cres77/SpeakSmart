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

# Named in freewili-finder v0.5.0 include/usbdef.hpp. One board can expose all of these.
NAMED_USB_IDS = (
    (0x0403, 0x6014),  # USB_VID_FW_FTDI, USB_PID_FW_FTDI
    (0x093C, 0x2054),  # USB_VID_FW_ICS, USB_PID_FW_MAIN_CDC_PID
    (0x093C, 0x2055),  # USB_VID_FW_ICS, USB_PID_FW_DISPLAY_CDC_PID
)
DEFAULT_SERIAL = "FW4923"
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


def has_named_usb(device):
    """True when one interface is FTDI 0x0403:0x6014 or Intrepid CDC 0x093C:0x2054 or 0x093C:0x2055."""
    for usb in getattr(device, "usb_devices", None) or []:
        pair = (getattr(usb, "vid", None), getattr(usb, "pid", None))
        if pair in NAMED_USB_IDS:
            return True
    return False


def select_device(devices, serial):
    """Pick the board whose serial matches and that has a named USB interface.

    find_all() is the discovery API. More than one matching board requires exactly
    one serial match. A single board still has to carry the requested serial.
    The FTDI interface and the CDC serial ports can belong to that same board.
    """
    wanted = serial if isinstance(serial, str) else ""
    class_devices = [device for device in devices if has_named_usb(device)]
    matches = [device for device in class_devices if wanted in device_serials(device)]
    if len(class_devices) > 1:
        return matches[0] if len(matches) == 1 else None
    if len(class_devices) == 1 and len(matches) == 1:
        return matches[0]
    return None


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


def play_pulse(device, frequency_hz, duration_ms, amplitude):
    """One play_audio_tone call. Duration in the protocol is milliseconds; the API takes seconds.

    The published example says the v54 response frame always returns failure, so this
    never reports played. The call is still made.
    """
    duration_sec = float(duration_ms) / 1000.0
    try:
        device.play_audio_tone(int(frequency_hz), duration_sec, float(amplitude))
    except Exception as ex:
        print(f"play_audio_tone raised {ex}", flush=True)
    return {"played": False, "note": TONE_FAILURE_NOTE}


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
    """Return an opened FreeWili, or None when that serial is not on a named USB interface.

    transport freewili is allowed only after this returns a device. open() uses the
    library's main and display serial ports. This function does not scan port names.
    """
    try:
        from freewili import FreeWili
    except ImportError as ex:
        raise LibraryMissing() from ex
    chosen = select_device(FreeWili.find_all(), serial)
    if chosen is None:
        return None
    opened = chosen.open()
    if opened.is_err():
        print(f"FreeWili {serial} did not open: {opened.err()}", flush=True)
        _close_quiet(chosen)
        return None
    if chosen.main_serial is None and chosen.display_serial is None:
        print(f"FreeWili {serial} did not open a serial port.", flush=True)
        _close_quiet(chosen)
        return None
    return chosen


def run_device(device, samples, commands, stop_event, failed, interval_ms):
    """Read AccelData on this thread. samples.push must not send on the WebSocket."""
    from freewili.types import AccelData, EventType

    def callback(event_type, frame, data):
        if event_type != EventType.Accel or not isinstance(data, AccelData):
            return
        sample = axes_from_accel_data(data)
        if sample is not None:
            samples.push(sample)

    try:
        device.set_event_callback(callback)
        enabled = device.enable_accel_events(True, int(interval_ms))
        if enabled.is_err():
            print(f"enable_accel_events failed: {enabled.err()}", flush=True)
        while not stop_event.is_set() and not failed.is_set():
            command = _next_command(commands)
            if command is not None:
                pulse = play_pulse(device, command["frequency"], command["duration"], command["amplitude"])
                command["reply"].put(pulse)
            device.process_events()
            stop_event.wait(0.005)
    except Exception as ex:
        print(f"FreeWili read failed: {ex}", flush=True)
        failed.set()
    finally:
        try:
            device.enable_accel_events(False)
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
