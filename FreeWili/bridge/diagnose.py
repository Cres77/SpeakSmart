"""Open the Main CDC port and print a short OneWili check. No coach WebSocket.

Uses OneWili commit b0eeccda21b0594c8062cd17e9755f0c26b0cf6b, the same open
path as the bridge. That commit has no firmware-version or app-info call.
hardware.system.device_state is not a version, and display_bl_version is not
called. The USB product name, when pyfwfinder reports one, is printed as a
USB string.

Then: set_zone(1, 1), enable_motion_stream, drain *motion for 5 seconds,
enable_motion_stream(0), set_zone(3, 1), tone(350, 150, 0.2). The script asks
you to listen. It does not report that a tone was heard.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from freewili_usb import (  # noqa: E402
    LISTEN_NOTE,
    ONEWILI_COMMIT,
    LibraryMissing,
    board_identity,
    ignored_host_message,
    motion_axes,
    onewili_of,
    open_usb,
    python_requirement_message,
)

LISTEN_SECONDS = 5
STREAM_INTERVAL_MS = 20
HEARD_PROMPT = "Note whether you heard a tone. This script does not know whether you heard one."
NO_VERSION = (
    f"OneWili {ONEWILI_COMMIT} does not expose a firmware version or app info. "
    "device_state is not a version. display_bl_version is not called."
)


def collect_motion(device, seconds, sleep, clock):
    """Drain Transport.events until seconds elapse. No commands are sent here."""
    events = onewili_of(device)._transport.events
    samples = []
    deadline = clock() + seconds
    while clock() < deadline:
        frame = _pop_event(events)
        if frame is not None:
            sample = motion_axes(frame)
            if sample is not None:
                samples.append(sample)
            continue
        remaining = deadline - clock()
        if remaining <= 0:
            break
        sleep(min(0.05, remaining))
    return samples


def _pop_event(events):
    get_nowait = getattr(events, "get_nowait", None)
    if not callable(get_nowait):
        return None
    try:
        return get_nowait()
    except Exception:
        return None


def diagnose_device(device, seconds=LISTEN_SECONDS, sleep=time.sleep, clock=time.monotonic, log=print):
    """Run the Main-port check. The caller closes the device."""
    lines = []

    def emit(text):
        lines.append(text)
        log(text, flush=True)

    product = getattr(device, "product_name", "") or ""
    if product:
        emit(f"USB product name from the Main CDC interface: {product}")
    else:
        emit("USB product name from the Main CDC interface: (not reported)")
    emit(NO_VERSION)
    dev = onewili_of(device)
    try:
        zone = dev.hardware.power_management.set_zone(1, 1)
    except Exception as ex:
        emit(f"set_zone(1, 1) Sensors raised {ex}")
        zone = None
    if zone is not None:
        emit(f"set_zone(1, 1) Sensors: {_status(zone)}")
    try:
        started = dev.io.sensors.enable_motion_stream(STREAM_INTERVAL_MS)
    except Exception as ex:
        emit(f"enable_motion_stream({STREAM_INTERVAL_MS}) raised {ex}")
        started = None
    if started is not None:
        emit(f"enable_motion_stream({STREAM_INTERVAL_MS}): {_status(started)}")
    samples = collect_motion(device, seconds, sleep, clock)
    emit(f"motion samples in {seconds:g}s: {len(samples)}")
    for sample in samples[:3]:
        emit(f"g x={sample['x']} y={sample['y']} z={sample['z']}")
    if not samples:
        emit("No *motion samples arrived. x, y, and z are g when they do.")
    try:
        stopped = dev.io.sensors.enable_motion_stream(0)
    except Exception as ex:
        emit(f"enable_motion_stream(0) raised {ex}")
        stopped = None
    if stopped is not None:
        emit(f"enable_motion_stream(0): {_status(stopped)}")
    try:
        audio = dev.hardware.power_management.set_zone(3, 1)
    except Exception as ex:
        emit(f"set_zone(3, 1) Audio raised {ex}")
        audio = None
    if audio is not None:
        emit(f"set_zone(3, 1) Audio: {_status(audio)}")
    try:
        tone = dev.io.audio.tone(350.0, 150.0, 0.2)
    except Exception as ex:
        emit(f"tone(350, 150, 0.2) raised {ex}")
        tone = None
    if tone is not None:
        emit(f"tone(350, 150, 0.2): {_status(tone)}")
    emit(HEARD_PROMPT)
    emit(LISTEN_NOTE)
    return lines


def _status(result):
    if getattr(result, "is_err", lambda: False)():
        err = result.err()
        text = err if isinstance(err, str) else str(err)
        if "EPOWERZONE" in text:
            return f"EPOWERZONE {text}"
        return f"Err: {text}"
    if getattr(result, "is_ok", lambda: False)():
        return f"Ok: {result.ok()}"
    return f"Ok: {result}"


def main():
    if sys.version_info < (3, 11):
        print(python_requirement_message(), flush=True)
        raise SystemExit(2)
    import os

    host_note = ignored_host_message(os.environ.get("FREEWILI_HOST", ""))
    if host_note:
        print(host_note, flush=True)
    serial = os.environ.get("FREEWILI_SERIAL", "").strip()
    try:
        device = open_usb(serial)
    except LibraryMissing as ex:
        print(ex, flush=True)
        raise SystemExit(2) from ex
    if device is None:
        raise SystemExit(1)
    label = board_identity(device) or "FreeWili"
    print(f"Diagnose opened {label} on Main CDC.", flush=True)
    try:
        diagnose_device(device)
    finally:
        try:
            device.close()
        except Exception as ex:
            print(f"close raised {ex}", flush=True)


if __name__ == "__main__":
    main()
