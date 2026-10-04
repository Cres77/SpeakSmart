#include "hardware_freewili.h"

/* REPLACE THIS FILE when a verified outbound socket exists.
 *
 * UNVERIFIED — there is no WebSocket client, TCP client, or Wi-Fi send API
 * in the sources checked for this phase. Nothing below is called.
 *
 * Checked:
 * - On-device WASM header fwwasm.h (SPARTAHACKS 2-1-2026)
 *   https://raw.githubusercontent.com/freewili/fwwasm/master/include/fwwasm.h
 *   RadioWrite / RadioRead / RadioSetTx / RadioSetRx are sub-GHz radio calls.
 *   No wifi, socket, http, or websocket symbol is declared.
 * - OneWili manifest, generated from FREE-WILi 2 firmware menus
 *   https://github.com/freewili/onewili (python/onewili/api_manifest.json)
 *   dev.io.net is the USB NCM adapter and 10BASE-T1S port (net_status,
 *   net_ping, h_ttp_server). It is not a Wi-Fi socket API.
 * - Bottlenose Wi-Fi Orca guide. That WebSocket server is a terminal bridge
 *   on an expansion board. This phase does not target it and does not speak
 *   our JSON protocol on it.
 *   https://docs.freewili.com/extending-with-orcas/bottlenose-wifi-orca/bottlenose-setup-and-interfacing/
 *
 * VERIFIED Wi-Fi station join (FREE-WILi 2 / OneWili), not called:
 *   dev.wireless.wifi.on_connect_to_station(ssid: str, password: str) -> Result
 *   wire menu: w\w\c
 *   dev.wireless.wifi.on_discconect_from_station_2() -> Result
 *   wire menu: w\w\f
 *   dev.wireless.wifi.on_get_wif_info() -> Result
 *   dev.wireless.wifi.settings.enable_station_mode() -> Result
 *   dev.wireless.wifi.settings.s_sid_for_station_mode(value: str) -> Result
 *   dev.wireless.wifi.settings.password_for_station_mode(value: str) -> Result
 *   dev.wireless.wifi.on_http_get_to_sd(url: str, path: str) -> Result
 * The same station commands are the serial-menu keys documented at
 * https://docs.freewili.com/features/wifi/ (Connect = c, Disconnect = f).
 * HTTP GET writes a file on the SD card. It is not a bidirectional channel.
 *
 * VERIFIED WebSocket settings are a server, not a client, and not called:
 *   dev.hardware.settings_home.websocket_settings.start_ws_server() -> Result
 *   dev.hardware.settings_home.websocket_settings.w_s_server_port(value: int) -> Result
 *   dev.hardware.settings_home.websocket_settings.auth_mode(value: int) -> Result
 * Public prose describes that server as a terminal bridge (port 8765 in the
 * Bottlenose guide). Do not assume it accepts this project's JSON frames.
 *
 * VERIFIED accelerometer entry points for later phases, not called, and no
 * sample is invented here:
 *   WASM setSensorSettings(bStreamAccel, bStreamTemp, iRateMilliseconds, ...)
 *   event FWGUI_EVENT_GUI_SENSOR_DATA
 *   Host library FreeWili.enable_accel_events(enable, interval_ms=None,
 *     processor=FreeWiliProcessorType.Display) -> Ok[str] | Err[str]
 *   AccelData fields: g, x, y, z, temp_c, temp_f
 *   https://freewili.github.io/freewili-python/api/types.html
 *   OneWili dev.io.sensors.enable_motion_stream(stream_rate_ms: int) -> Result
 *     "Streams accelerometer and gyroscope data to the host" over USB.
 *     0 stops the stream. The numeric layout of a sample is not documented.
 *   dev.io.sensors.get_sensors() -> Result
 *   dev.hardware.settings_home.sensor_settings.accel_range(value: int) -> Result
 * LIS3DH and axis directions (X toward the IO connector, Y toward the buttons,
 * Z out of the screen) are documented for the GUI scripting guide:
 *   https://github.com/freewili/FreeWili_WebDocs/blob/main/docs/scripting/gui-screen-buttons-and-lights/accelerometer.md
 * Units of x/y/z are not stated. FREE-WILi 2's motion part number was not
 * confirmed from a source file in this pass.
 *
 * VERIFIED speaker entry points for a later buzz, not called. No separate
 * buzzer API was found. A 350 Hz / 150 ms tone is expressible and was not
 * heard on hardware. Duration units differ:
 *   dev.io.audio.tone(frequency: float, duration_ms: float, amplitude: float)
 *   playSoundFromFrequencyAndDuration(float frequency, float duration,
 *     float amplitude, audioWaveType wavetype)
 *     frequency Hz, duration SECONDS, amplitude 1.0 max, 0.2 recommended
 *     https://raw.githubusercontent.com/freewili/fwwasm/master/include/fwwasm.h
 *   FreeWili.play_audio_tone(frequency_hz, duration_sec, amplitude,
 *     processor=Display) -> Ok[str] | Err[str]
 *     The Python example notes that v54 firmware's response frame returns
 *     failure even when playback is started. Playback was not confirmed here.
 * Older WAV playback is 8 kHz 16-bit PCM
 * (docs.freewili.com scripting guide, making-sounds). That format can
 * represent 350 Hz. It does not prove the speaker's response.
 */

const char *hardware_unverified_reason(void) {
  return
      "Phase 1 did not open a FreeWili radio. No verified outbound WebSocket "
      "client exists in fwwasm.h or the OneWili API manifest. Verified and "
      "not called: dev.wireless.wifi.on_connect_to_station(ssid, password). "
      "start_ws_server() only toggles a websocket server, documented as a "
      "terminal bridge, not this JSON protocol.";
}

HardwareResult hardware_wifi_join(const char *ssid, const char *password) {
  (void)ssid;
  (void)password;
  return HARDWARE_API_UNVERIFIED;
}
