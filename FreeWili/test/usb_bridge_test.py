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
    diagnose_processors,
)
from freewili_usb import (  # noqa: E402
    TONE_FAILURE_NOTE,
    axes_from_accel_data,
    board_identity,
    describe_missing,
    hello_message,
    ignored_host_message,
    network_target,
    play_pulse,
    sample_window_lines,
    select_device,
    start_accel_events,
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


class Processor:
    def __init__(self, name):
        self.name = name


class AccelEnableTests(unittest.TestCase):
    def test_display_error_then_main_ok_is_success(self):
        calls = []
        timeout = "Failed to read response frame in 6.0 seconds"

        class Device:
            def enable_accel_events(self, enable, interval, processor):
                calls.append((enable, interval, processor.name))
                if processor.name == "Display":
                    return Result(timeout)
                return Result(None)

        display = Processor("Display")
        main = Processor("Main")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            chosen = start_accel_events(Device(), 20, (display, main))
        self.assertIs(chosen, main)
        self.assertEqual(calls, [(True, 20, "Display"), (True, 20, "Main")])
        text = buf.getvalue()
        self.assertIn("enable_accel_events Ok on Main", text)
        self.assertIn(timeout, text)
        self.assertNotIn("played", text)

    def test_display_ok_does_not_call_main(self):
        calls = []

        class Device:
            def enable_accel_events(self, enable, interval, processor):
                calls.append(processor.name)
                return Result(None)

        display = Processor("Display")
        main = Processor("Main")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            chosen = start_accel_events(Device(), 20, (display, main))
        self.assertIs(chosen, display)
        self.assertEqual(calls, ["Display"])
        self.assertIn("enable_accel_events Ok on Display", buf.getvalue())

    def test_both_processor_errors_stay_a_failure(self):
        calls = []

        class Device:
            def enable_accel_events(self, enable, interval, processor):
                calls.append(processor.name)
                return Result("Failed to read response frame in 6.0 seconds")

        display = Processor("Display")
        main = Processor("Main")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            chosen = start_accel_events(Device(), 20, (display, main))
        self.assertIsNone(chosen)
        self.assertEqual(calls, ["Display", "Main"])
        text = buf.getvalue()
        self.assertIn("enable_accel_events failed on Display and Main", text)
        self.assertNotIn("Ok on", text)
        self.assertNotIn("played", text)
        self.assertNotIn('"x"', text)


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
        seen = []

        class Fake:
            def play_audio_tone(self, frequency_hz, duration_sec, amplitude, processor):
                seen.append((frequency_hz, duration_sec, amplitude, processor.name))
                if processor.name == "Display":
                    return Result("Failed to read response frame in 6.0 seconds")
                return Result(None, "sent")

        display = Processor("Display")
        main = Processor("Main")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            pulse = play_pulse(Fake(), 350, 150, 0.2, (display, main))
        self.assertEqual(seen, [(350, 0.15, 0.2, "Display"), (350, 0.15, 0.2, "Main")])
        self.assertIs(pulse["played"], False)
        self.assertEqual(pulse["note"], TONE_FAILURE_NOTE)
        self.assertNotIn("played: true", buf.getvalue().lower())

    def test_tone_stops_when_display_returns_ok(self):
        seen = []

        class Fake:
            def play_audio_tone(self, frequency_hz, duration_sec, amplitude, processor):
                seen.append(processor.name)
                return Result(None)

        pulse = play_pulse(Fake(), 350, 150, 0.2, (Processor("Display"), Processor("Main")))
        self.assertEqual(seen, ["Display"])
        self.assertIs(pulse["played"], False)

    def test_tone_other_display_error_does_not_try_main(self):
        seen = []

        class Fake:
            def play_audio_tone(self, frequency_hz, duration_sec, amplitude, processor):
                seen.append(processor.name)
                return Result("closed")

        pulse = play_pulse(Fake(), 350, 150, 0.2, (Processor("Display"), Processor("Main")))
        self.assertEqual(seen, ["Display"])
        self.assertIs(pulse["played"], False)

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

    def test_wifi_host_is_not_a_client(self):
        self.assertIsNone(network_target("192.168.4.1"))
        message = ignored_host_message("192.168.4.1")
        self.assertIn("FREEWILI_HOST=192.168.4.1", message)
        self.assertIn("FreeWili.find_all()", message)
        self.assertIn("USB", message)
        self.assertIsNone(ignored_host_message(""))


class DiagnoseTests(unittest.TestCase):
    def test_display_and_main_are_reported_without_claiming_playback(self):
        class Accel:
            pass

        class Event:
            def __init__(self, name):
                self.name = name

        class Clock:
            def __init__(self):
                self.now = 0

            def __call__(self):
                return self.now

            def sleep(self, delay):
                self.now += delay

        class Device:
            def __init__(self):
                self.calls = []
                self.callback = None
                self._sent = False

            def get_app_info(self, processor):
                self.calls.append(("info", processor.name))
                if processor.name == "Display":
                    return Result("Failed to read response frame in 6.0 seconds")
                return Result(None, "Main v54")

            def enable_accel_events(self, enable, interval, processor):
                self.calls.append(("accel", enable, interval, processor.name))
                if processor.name == "Display" and enable:
                    return Result("Failed to read response frame in 6.0 seconds")
                return Result(None, "enabled" if enable else "disabled")

            def set_event_callback(self, callback):
                self.callback = callback

            def process_events(self):
                if self.callback is None or self._sent:
                    return
                self._sent = True
                self.callback(Event("Accel"), None, Accel())
                self.callback(Event("Button"), None, object())

            def play_audio_tone(self, frequency, duration, amplitude, processor):
                self.calls.append(("tone", frequency, duration, amplitude, processor.name))
                return Result(None, "response")

        clock = Clock()
        device = Device()
        buf = io.StringIO()
        lines = diagnose_processors(
            device,
            (Processor("Display"), Processor("Main")),
            Accel,
            seconds=5,
            sleep=clock.sleep,
            clock=clock,
            log=lambda text, flush=False: print(text, file=buf, flush=flush),
        )
        text = "\n".join(lines)
        self.assertIn("Display get_app_info: Err: Failed to read response frame in 6.0 seconds", text)
        self.assertIn("Main get_app_info: Ok: Main v54", text)
        self.assertIn("Display enable_accel_events(True, 100, Display): Err: Failed to read response frame in 6.0 seconds", text)
        self.assertIn("Main enable_accel_events(True, 100, Main): Ok: enabled", text)
        self.assertIn("Display events in 5s by EventType: Accel 1, Button 1", text)
        self.assertIn("Display AccelData: 1", text)
        self.assertIn("Main events in 5s by EventType: none", text)
        self.assertIn("Main AccelData: 0", text)
        self.assertIn("Display enable_accel_events(False) skipped after Err", text)
        self.assertIn("Main enable_accel_events(False, None, Main): Ok: disabled", text)
        self.assertIn("Display play_audio_tone(350, 0.15, 0.2, Display): Ok: response", text)
        self.assertIn("Main play_audio_tone(350, 0.15, 0.2, Main): Ok: response", text)
        self.assertEqual(text.count(HEARD_PROMPT), 2)
        self.assertNotIn("played", text.lower())
        self.assertIn(("tone", 350, 0.15, 0.2, "Display"), device.calls)
        self.assertIn(("tone", 350, 0.15, 0.2, "Main"), device.calls)
        self.assertIn(("accel", False, None, "Main"), device.calls)
        self.assertNotIn(("accel", False, None, "Display"), device.calls)


if __name__ == "__main__":
    unittest.main()
