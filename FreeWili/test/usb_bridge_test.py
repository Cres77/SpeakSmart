"""Serial matching and missing-device behavior. No board and no freewili import required."""

import contextlib
import io
import json
import sys
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bridge"))

from diagnose import (  # noqa: E402
    HEARD_PROMPT,
    diagnose_device,
)
from freewili_usb import (  # noqa: E402
    LISTEN_NOTE,
    board_identity,
    describe_missing,
    describe_no_main,
    hello_message,
    ignored_host_message,
    main_cdc_port,
    motion_axes,
    network_target,
    open_main_port,
    play_pulse,
    sample_window_lines,
    select_device,
)
from coach_bridge import SampleQueue, run_coach  # noqa: E402


class Usb:
    def __init__(self, vid, pid, serial="", port=None, name=""):
        self.vid = vid
        self.pid = pid
        self.serial = serial
        self.port = port
        self.name = name


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

    def test_one_other_serial_is_selected_when_none_requested(self):
        only = board("ABC123", [(0x093C, 0x2055), (0x0403, 0x6014), (0x093C, 0x2054)])
        for requested in ("", None, "   "):
            chosen = select_device([only], requested)
            self.assertIs(chosen, only)
            message = hello_message(board_identity(chosen), 1)
            self.assertEqual(message["deviceId"], "ABC123")
            self.assertEqual(message["transport"], "freewili")

    def test_two_boards_and_no_serial_selects_none(self):
        devices = [
            board("AAA111", [(0x093C, 0x2054)]),
            board("BBB222", [(0x093C, 0x2055), (0x0403, 0x6014)]),
        ]
        self.assertIsNone(select_device(devices, ""))
        self.assertIsNone(select_device(devices, None))
        text = describe_missing(devices, "")
        self.assertIn("AAA111", text)
        self.assertIn("BBB222", text)
        self.assertNotIn('"transport": "freewili"', text)

    def test_espressif_debug_port_is_not_a_freewili(self):
        debug = board("E4:B3:23:99:F0:08", [(0x303A, 0x1001)])
        for requested in ("", None, "E4:B3:23:99:F0:08", "FW4923"):
            self.assertIsNone(select_device([debug], requested))
        text = describe_missing([debug], "")
        self.assertIn("is not a FreeWili", text)
        self.assertIn("0x303a:0x1001", text)
        self.assertIn("E4:B3:23:99:F0:08", text)
        self.assertNotIn('"transport": "freewili"', text)
        self.assertIn("is not a FreeWili", describe_missing([debug], "FW4923"))
        mixed = Board(
            "FW4923",
            [Usb(0x303A, 0x1001, "E4:B3:23:99:F0:08"), Usb(0x093C, 0x2054, "FW4923")],
        )
        self.assertIs(select_device([mixed], ""), mixed)

    def test_debug_port_does_not_count_as_a_second_board(self):
        real = board("ABC123", [(0x093C, 0x2054), (0x093C, 0x2055), (0x0403, 0x6014)])
        debug = board("E4:B3:23:99:F0:08", [(0x303A, 0x1001)])
        chosen = select_device([debug, real], "")
        self.assertEqual(board_identity(chosen), "ABC123")
        message = hello_message(board_identity(chosen), 1)
        self.assertEqual(message["deviceId"], "ABC123")
        self.assertNotEqual(message["deviceId"], "E4:B3:23:99:F0:08")

    def test_only_the_main_cdc_port_is_opened(self):
        main = Usb(0x093C, 0x2054, "FW4923", port="/dev/ttyACM0", name="FWOG main ogfw 024")
        display = Usb(0x093C, 0x2055, "FW4923", port="/dev/ttyACM1", name="FWOG display ogfw 020")
        debug = Usb(0x303A, 0x1001, "E4:B3:23:99:F0:08", port="/dev/ttyACM2", name="USB JTAG/serial debug unit")
        chosen = Board("FW4923", [debug, display, main])
        self.assertEqual(main_cdc_port(chosen), "/dev/ttyACM0")
        self.assertIsNone(main_cdc_port(Board("FW4923", [display])))
        self.assertIsNone(main_cdc_port(Board("FW4923", [debug])))
        self.assertIn("not opened", describe_no_main(Board("FW4923", [display])))
        source = Path(__file__).resolve().parent.parent.joinpath("bridge/freewili_usb.py").read_text()
        self.assertNotIn("1200", source)
        self.assertNotIn("onewili.connect(", source)
        self.assertNotIn("serial.Serial", source)


class Result:
    def __init__(self, err=None, value="ok"):
        self._err = err
        self._value = value

    def is_err(self):
        return self._err is not None

    def is_ok(self):
        return self._err is None

    def err(self):
        return self._err

    def ok(self):
        return self._value



class Frame:
    def __init__(self, path, response):
        self.path = path
        self.response = response


class MotionTests(unittest.TestCase):
    def test_motion_axes_are_milli_g_and_gyro_is_ignored(self):
        sample = motion_axes(Frame("*motion", "12 -34 1002 1 2 3"))
        self.assertEqual(sample, {"x": 12, "y": -34, "z": 1002})
        self.assertNotIn("g", sample)

    def test_other_events_are_not_samples(self):
        self.assertIsNone(motion_axes(Frame("*button", "1")))
        self.assertIsNone(motion_axes(Frame("*motion", "12 -34")))


class FakeQueue:
    def __init__(self, items):
        self.items = list(items)

    def get_nowait(self):
        if not self.items:
            raise IndexError("empty")
        return self.items.pop(0)


class FakeOneWili:
    def __init__(self, zone_err=None, tone_err=None, stream_err=None):
        self.calls = []
        self._transport = type("T", (), {"events": FakeQueue([])})()
        self.hardware = type("H", (), {"power_management": self})()
        self.io = type("I", (), {"sensors": self, "audio": self})()
        self.zone_err = zone_err
        self.tone_err = tone_err
        self.stream_err = stream_err

    def set_zone(self, zone, on):
        self.calls.append(("zone", zone, on))
        if self.zone_err and zone == self.zone_err[0]:
            return Result(self.zone_err[1])
        return Result(None, "zone")

    def enable_motion_stream(self, interval):
        self.calls.append(("stream", interval))
        if self.stream_err is not None and interval != 0:
            return Result(self.stream_err)
        return Result(None, "stream")

    def tone(self, frequency, duration_ms, amplitude):
        self.calls.append(("tone", frequency, duration_ms, amplitude))
        if self.tone_err:
            return Result(self.tone_err)
        return Result(None, "tone")

    def open(self):
        self.calls.append(("open",))
        return self

    def close(self):
        self.calls.append(("close",))


class ToneTests(unittest.TestCase):
    def test_tone_uses_milliseconds_and_played_follows_ok(self):
        device = FakeOneWili()
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            pulse = play_pulse(device, 350, 150, 0.2)
        self.assertEqual(device.calls, [("zone", 3, 1), ("tone", 350.0, 150.0, 0.2)])
        self.assertIs(pulse["played"], True)
        self.assertEqual(pulse["note"], LISTEN_NOTE)
        self.assertNotIn("played: true", buf.getvalue().lower())

    def test_epowerzone_stays_a_failure(self):
        device = FakeOneWili(tone_err="EPOWERZONE 3 Audio")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            pulse = play_pulse(device, 350, 150, 0.2)
        self.assertIs(pulse["played"], False)
        self.assertIn("EPOWERZONE", pulse["note"])
        self.assertIn("Listen for the tone.", pulse["note"])
        self.assertIn("EPOWERZONE from tone", buf.getvalue())


class Clock:
    def __init__(self):
        self.now = 0

    def __call__(self):
        return self.now

    def sleep(self, delay):
        self.now += delay


class DiagnoseTests(unittest.TestCase):
    def test_diagnose_streams_main_and_does_not_claim_playback(self):
        device = FakeOneWili()
        device.product_name = "FWOG main ogfw 024"
        device._transport.events = FakeQueue([
            Frame("*motion", "12 -34 1002 0 0 0"),
            Frame("*motion", "13 -35 1001 9 9 9"),
            Frame("*field", "1 2 3 4 5"),
        ])
        clock = Clock()
        lines = diagnose_device(device, seconds=5, sleep=clock.sleep, clock=clock, log=lambda text, flush=False: None)
        text = "\n".join(lines)
        self.assertIn("FWOG main ogfw 024", text)
        self.assertIn("does not expose a firmware version", text)
        self.assertIn("set_zone(1, 1) Sensors: Ok:", text)
        self.assertIn("enable_motion_stream(20): Ok:", text)
        self.assertIn("motion samples in 5s: 2", text)
        self.assertIn("milli-g x=12 y=-34 z=1002", text)
        self.assertIn("milli-g x=13 y=-35 z=1001", text)
        self.assertNotIn("x=9", text)
        self.assertIn("enable_motion_stream(0): Ok:", text)
        self.assertIn("set_zone(3, 1) Audio: Ok:", text)
        self.assertIn("tone(350, 150, 0.2): Ok:", text)
        self.assertIn(HEARD_PROMPT, text)
        self.assertNotIn("heard a tone.", text.lower().split("whether")[0])
        self.assertEqual([call[0] for call in device.calls], ["zone", "stream", "stream", "zone", "tone"])
        self.assertIn(("tone", 350.0, 150.0, 0.2), device.calls)

    def test_open_passes_only_the_port(self):
        seen = {}

        class Cls:
            def __init__(self, port):
                seen["port"] = port
                seen["args"] = (port,)

            def open(self):
                seen["opened"] = True
                return self

        device = open_main_port("/dev/ttyACM0", Cls)
        self.assertEqual(seen["args"], ("/dev/ttyACM0",))
        self.assertIs(seen["opened"], True)
        self.assertIs(device.open() if False else device, device)


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
    def test_sample_window_logs_counts_and_an_empty_board(self):
        self.assertEqual(
            sample_window_lines(4, 3, True),
            ["accel samples in 5s: received 4, sent 3"],
        )
        empty = sample_window_lines(0, 0, True)
        self.assertEqual(empty[0], "accel samples in 5s: received 0, sent 0")
        self.assertIn("accepted the command but sent no accelerometer samples", empty[1])
        self.assertEqual(sample_window_lines(0, 0, False), ["accel samples in 5s: received 0, sent 0"])

    def test_queue_counts_received_and_sent(self):
        samples = SampleQueue(8)
        samples.push({"x": 1, "y": 0, "z": 0})
        samples.push({"x": 2, "y": 0, "z": 0})
        samples.mark_sent()
        self.assertEqual(samples.take_counts(), (2, 1))
        self.assertEqual(samples.take_counts(), (0, 0))

    def test_queue_drops_oldest_without_blocking(self):
        samples = SampleQueue(8)
        for value in range(10):
            samples.push({"x": value, "y": 0, "z": 0})
        self.assertEqual(samples.pop_nowait()["x"], 2)

    def test_wifi_host_is_not_a_client(self):
        self.assertIsNone(network_target("192.168.4.1"))
        message = ignored_host_message("192.168.4.1")
        self.assertIn("FREEWILI_HOST=192.168.4.1", message)
        self.assertIn("OneWili(port).open()", message)
        self.assertIn("USB", message)
        self.assertIsNone(ignored_host_message(""))


if __name__ == "__main__":
    unittest.main()
