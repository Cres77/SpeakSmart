"""Open the one FreeWili the bridge would pick and print what each processor answers.

Verified API, freewili 0.0.51 (freewili/fw.py and freewili/types.py):

- FreeWili.get_app_info(processor=FreeWiliProcessorType.Main) -> Result[FreeWiliAppInfo, str]
- FreeWili.set_event_callback(cb) with cb(event_type, frame, data). None disables it.
- FreeWili.enable_accel_events(enable, interval_ms=None, processor=Display) -> Result[str, str]
- FreeWili.process_events()
- FreeWili.play_audio_tone(frequency_hz, duration_sec, amplitude, processor=Display) -> Result[str, str]
- FreeWili.close()
- FreeWiliProcessorType.Display and FreeWiliProcessorType.Main
- EventType and AccelData

AccelData is documented as accelerometer event data from the Free-Wili Display.
An Ok from Main does not by itself mean Main streamed AccelData. This script
counts events. It does not report that a tone played.
"""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from freewili_usb import (  # noqa: E402
    INSTALL_COMMAND,
    LibraryMissing,
    board_identity,
    ignored_host_message,
    open_usb,
)

LISTEN_SECONDS = 5
HEARD_PROMPT = "Note whether you heard a tone. This script does not know whether you heard one."


def describe_result(result):
    """Print Ok and its value, or Err and its text. Does not treat Ok as playback."""
    is_err = getattr(result, "is_err", None)
    if callable(is_err) and is_err():
        return f"Err: {result.err()}"
    is_ok = getattr(result, "is_ok", None)
    if callable(is_ok) and is_ok():
        return f"Ok: {result.ok()}"
    return f"Ok: {result}"


def format_event_counts(counts):
    if not counts:
        return "none"
    return ", ".join(f"{name} {counts[name]}" for name in sorted(counts))


def count_events(device, seconds, accel_type, sleep, clock):
    """Run process_events until seconds elapse. Return EventType counts and AccelData count."""
    counts = {}
    accel_data = 0

    def callback(event_type, frame, data):
        nonlocal accel_data
        name = getattr(event_type, "name", None) or str(event_type)
        counts[name] = counts.get(name, 0) + 1
        if accel_type is not None and isinstance(data, accel_type):
            accel_data += 1

    device.set_event_callback(callback)
    try:
        deadline = clock() + seconds
        while clock() < deadline:
            device.process_events()
            remaining = deadline - clock()
            if remaining <= 0:
                break
            sleep(min(0.05, remaining))
    finally:
        device.set_event_callback(None)
    return counts, accel_data


def diagnose_processors(device, processors, accel_type, seconds=LISTEN_SECONDS, sleep=time.sleep, clock=time.monotonic, log=print):
    """Ask Display and Main separately. The caller closes the device."""
    lines = []

    def emit(text):
        lines.append(text)
        log(text, flush=True)

    emit("process_events() reads the main and display serial ports. Each window enables one processor.")
    for processor in processors:
        name = getattr(processor, "name", str(processor))
        info, info_error = _call(device.get_app_info, processor)
        if info_error is not None:
            emit(f"{name} get_app_info: raised {info_error}")
        else:
            emit(f"{name} get_app_info: {describe_result(info)}")
        enabled, enable_error = _call(device.enable_accel_events, True, 100, processor)
        if enable_error is not None:
            emit(f"{name} enable_accel_events(True, 100, {name}): raised {enable_error}")
            enabled_ok = False
        else:
            emit(f"{name} enable_accel_events(True, 100, {name}): {describe_result(enabled)}")
            enabled_ok = not (callable(getattr(enabled, "is_err", None)) and enabled.is_err())
        try:
            counts, accel_data = count_events(device, seconds, accel_type, sleep, clock)
        except Exception as ex:
            emit(f"{name} process_events raised {ex}")
            counts, accel_data = {}, 0
        emit(f"{name} events in {seconds:g}s by EventType: {format_event_counts(counts)}")
        emit(f"{name} AccelData: {accel_data}")
        if enabled_ok:
            disabled, disable_error = _call(device.enable_accel_events, False, None, processor)
            if disable_error is not None:
                emit(f"{name} enable_accel_events(False, None, {name}): raised {disable_error}")
            else:
                emit(f"{name} enable_accel_events(False, None, {name}): {describe_result(disabled)}")
        else:
            emit(f"{name} enable_accel_events(False) skipped after Err")
        tone, tone_error = _call(device.play_audio_tone, 350, 0.15, 0.2, processor)
        if tone_error is not None:
            emit(f"{name} play_audio_tone(350, 0.15, 0.2, {name}): raised {tone_error}")
        else:
            emit(f"{name} play_audio_tone(350, 0.15, 0.2, {name}): {describe_result(tone)}")
        emit(HEARD_PROMPT)
    return lines


def _call(fn, *args):
    try:
        return fn(*args), None
    except Exception as ex:
        return None, ex


def main():
    if sys.version_info < (3, 10):
        print(
            "Python 3.10 or newer is required to open the FreeWili over USB.\n"
            "Install Python, then run:\n"
            f"  {INSTALL_COMMAND}",
            flush=True,
        )
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
    from freewili.types import AccelData, FreeWiliProcessorType

    label = board_identity(device) or "FreeWili"
    print(f"Opened {label} for diagnose.", flush=True)
    try:
        diagnose_processors(
            device,
            (FreeWiliProcessorType.Display, FreeWiliProcessorType.Main),
            AccelData,
        )
    finally:
        try:
            device.close()
        except Exception as ex:
            print(f"close raised {ex}", flush=True)


if __name__ == "__main__":
    main()
