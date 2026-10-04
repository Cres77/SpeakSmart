# SpeakSmart

SpeakSmart is the practice site in this repository. Record a session in the browser, then review Presage metrics and, when a FreeWili is plugged in, the hand-movement grade.

## Website

From the repository root, with Node.js 20+:

```bash
npm install
npm run dev
```

Open the URL Next prints (usually http://localhost:3000). `npm run build` then `npm start` runs the production server.

Copy `.env.example` to `.env` and fill in the keys you use. Presage, xAI, Gemini, and ElevenLabs stay optional for a recording that only needs the camera. `NEXT_PUBLIC_FREEWILI_URL` defaults to `ws://127.0.0.1:4173` when it is unset. The site appends `/ws`.

## FreeWili bridge

Movement comes from a local bridge, not from the website server. The bridge is headless: it does not serve a page and it does not open a browser.

On Windows, double-click `FreeWili\start-windows.bat`. It installs Node.js, 64-bit Python, and Git when they are missing, then starts the bridge. `FreeWili\diagnose-windows.bat` runs that same setup and then a USB check.

From a terminal:

```bash
cd FreeWili
npm install
npm start
```

`npm start` listens on `ws://127.0.0.1:4173/ws`. While you record, the site connects, asks the bridge to baseline the next sample, and sends one 350 Hz, 150 ms buzz. Recording still saves if the board is unplugged; that session has no hand-movement grade.

`npm run diagnose` in `FreeWili` checks the Main USB port without starting the website.

Python 3.11+ and Git are required because OneWili installs from a git URL pinned in `FreeWili/bridge/requirements.txt`. On Windows the bridge tries `py -3`, then `python`. Elsewhere it tries `python3`, then `python`. Set `SPEAKSMART_PYTHON` to force one executable.
