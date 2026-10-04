# FreeWili bridge

Headless local bridge for one FreeWili OG. It opens the Main CDC port, scores motion, and forwards samples to the SpeakSmart website over WebSocket. It does not serve HTML and it does not open a browser.

On Windows, double-click `start-windows.bat`. It checks for Node.js 20 or newer, 64-bit Python 3.11 or newer, and Git, installs any that are missing, then starts the bridge. Double-click `diagnose-windows.bat` for that same setup and then the USB check.

The website at the repository root connects to `ws://127.0.0.1:4173/ws` while a recording is running. Set `NEXT_PUBLIC_FREEWILI_URL` if the bridge is on another URL.

## Run

```bash
cd FreeWili
npm install
npm start
```

`npm start` launches the USB bridge. It uses OneWili from git, pinned in `bridge/requirements.txt`, not freewili-python. One plugged-in FreeWili is used. Leave `FREEWILI_SERIAL` empty for that board. Set `FREEWILI_SERIAL` when more than one board is plugged in. The bridge opens only the Main CDC port `0x093C:0x2054` with `OneWili(port).open()`. It does not open the Display port and it does not open the Espressif debug port `0x303a:0x1001`. Accelerometer samples are g. The bridge divides OneWili `*motion` milli-g by 1000 before the sensor frame. A buzz while that stream is running can drop a few queued samples. The website stays "FreeWili not connected" until that port opens. The bridge then sends `transport: "freewili"` and `deviceId` set to the serial. If several boards are present and no serial is set, the process prints those serials and does not send that transport.

`GET /health` returns JSON. Every other HTTP path is `not found`.

Python 3.11+ and Git are required. On Windows the bridge tries `py -3`, then `python`, and skips the Microsoft Store alias. Elsewhere it tries `python3`, then `python`. Set `SPEAKSMART_PYTHON` to one executable path to override that search.

```bash
cd FreeWili
python3 -m pip install -r bridge/requirements.txt
npm start
```

Windows:

```bat
cd FreeWili
py -m pip install -r bridge\requirements.txt
npm start
```

Install 64-bit Python 3.11 or newer from https://www.python.org/downloads/windows/ and turn on **Add python.exe to PATH**. Install Git from https://git-scm.com/download/win because OneWili is a git URL, not a PyPI release.

## Diagnose

```bash
cd FreeWili
npm run diagnose
```

`npm run diagnose` opens that same Main port. OneWili at the pinned commit does not expose a firmware version, so the script says so and prints the USB product name when the finder has one. It turns on the sensor zone, streams motion for 5 seconds, prints the sample count and a few g values, then plays a 350 Hz, 150 ms tone and asks you to listen. It does not report that a tone was heard.

## Thresholds

`shared/config.json` is the only threshold source. Intensity reaches 100% at `movementThreshold` 1.05 g. A gesture counts at `gestureThreshold` 1.5 g. Stillness is `stillnessThreshold` 0.24 g. The website imports that file. `shared/grade.mjs` grades a finished recording from the summary: letter A–F and a 0–100 score.

## Tests

```bash
cd FreeWili
npm test
```

`npm test` runs the Node tests. They do not need a board. `test/usb_bridge_test.py` is the Python check the USB test spawns.
