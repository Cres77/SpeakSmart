"""Serial matching and missing-device behavior. No board and no freewili import required."""

import contextlib
import io
import json
import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bridge"))

from freewili_usb import (  # noqa: E402
    TONE_FAILURE_NOTE,
    axes_from_accel_data,
    hello_message,
    ignored_host_message,
    network_target,
    play_pulse,
    select_device,
)
from coach_bridge import SampleQueue, run_coach  # noqa: E402


class Usb:
    def __init__(self, vid, pid, serial=""):
        self.vid = vid
        self.pid = pid
        self.serial = serial


class Board:
    def __init__(self, serial, usbs):
        self.device = type("Inner", (), {"serial": serial})()
        self.serial = serial
        self.usb_devices = usbs


def board(serial, pairs):
    return Board(serial, [Usb(vid, pid, serial) for vid, pid in pairs])


class SelectTests(unittest.TestCase):
    def test_ftdi_serial_matches(self):
        chosen = select_device([board("FW4923", [(0x0403, 0x6014)])], "FW4923")
        self.assertIsNotNone(chosen)
        self.assertIn("FW4923", chosen.serial)

    def test_main_and_display_cdc_ids_match(self):
        main = select_device([board("FW4923", [(0x093C, 0x2054)])], "FW4923")
        display = select_device([board("FW4923", [(0x093C, 0x2055)])], "FW4923")
        self.assertEqual(main.serial, "FW4923")
        self.assertEqual(display.serial, "FW4923")

    def test_other_vid_pid_is_not_the_class(self):
        chosen = select_device([board("FW4923", [(0x2E8A, 0x000A)])], "FW4923")
        self.assertIsNone(chosen)

    def test_wrong_serial_is_not_found(self):
        chosen = select_device([board("FW0001", [(0x0403, 0x6014), (0x093C, 0x2054)])], "FW4923")
        self.assertIsNone(chosen)

    def test_several_boards_require_the_serial(self):
        devices = [
            board("FW0001", [(0x093C, 0x2054)]),
            board("FW4923", [(0x0403, 0x6014), (0x093C, 0x2055)]),
            board("FW0002", [(0x093C, 0x2055)]),
        ]
        chosen = select_device(devices, "FW4923")
        self.assertEqual(chosen.serial, "FW4923")
        self.assertIsNone(select_device(devices[:1] + devices[2:], "FW4923"))

    def test_duplicate_serial_is_not_a_guess(self):
        devices = [
            board("FW4923", [(0x0403, 0x6014)]),
            board("FW4923", [(0x093C, 0x2054)]),
        ]
        self.assertIsNone(select_device(devices, "FW4923"))


class MissingDeviceTests(unittest.TestCase):
    def test_missing_serial_does_not_emit_freewili(self):
        message = hello_message(None, 1)
        self.assertIsNone(message)
        self.assertNotIn("freewili", json.dumps(message))

    def test_opened_serial_is_the_only_freewili_hello(self):
        message = hello_message("FW4923", 1)
        self.assertEqual(message["transport"], "freewili")
        self.assertEqual(message["deviceId"], "FW4923")

    def test_missing_device_does_not_open_a_socket(self):
        calls = []

        def factory(*args, **kwargs):
            calls.append((args, kwargs))
            raise AssertionError("socket opened")

        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            run_coach(
                host="127.0.0.1",
                port=9,
                serial="FW4923",
                open_device=lambda serial: None,
                stop_event=threading.Event(),
                attempts=1,
                socket_factory=factory,
                config={"sampleRateHz": 50, "heartbeatIntervalMs": 2000, "serverPort": 4173},
            )
        text = buf.getvalue()
        self.assertIn("FreeWili FW4923 not found", text)
        self.assertNotIn('"transport": "freewili"', text)
        self.assertEqual(calls, [])


class SampleAndToneTests(unittest.TestCase):
    def test_axes_pass_through(self):
        sample = axes_from_accel_data(type("Accel", (), {"x": 64, "y": -768, "z": 16448, "g": 2})())
        self.assertEqual(sample, {"x": 64, "y": -768, "z": 16448, "g": 2})

    def test_queue_drops_oldest_without_blocking(self):
        samples = SampleQueue(8)
        for value in range(10):
            samples.push({"x": value, "y": 0, "z": 0})
        self.assertEqual(samples.pop_nowait()["x"], 2)

    def test_tone_maps_milliseconds_and_stays_unplayed(self):
        seen = {}

        class Fake:
            def play_audio_tone(self, frequency_hz, duration_sec, amplitude):
                seen["args"] = (frequency_hz, duration_sec, amplitude)
                return "Err"

        pulse = play_pulse(Fake(), 350, 150, 0.2)
        self.assertEqual(seen["args"], (350, 0.15, 0.2))
        self.assertIs(pulse["played"], False)
        self.assertEqual(pulse["note"], TONE_FAILURE_NOTE)

    def test_wifi_host_is_not_a_client(self):
        self.assertIsNone(network_target("192.168.4.1"))
        message = ignored_host_message("192.168.4.1")
        self.assertIn("FREEWILI_HOST=192.168.4.1", message)
        self.assertIn("FreeWili.find_all()", message)
        self.assertIn("USB", message)
        self.assertIsNone(ignored_host_message(""))


if __name__ == "__main__":
    unittest.main()
