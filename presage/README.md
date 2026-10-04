# Presage / SmartSpectra proof of concept

Minimal Node.js script: default webcam → SmartSpectra → printed physiological metrics.

## Run

Work in this `presage/` folder.

1. Copy `.env.example` to `.env`.
2. Put your API key on the `PRESAGE_API_KEY=` line.
3. Install once: `npm install`
4. Start: `npm start`
5. `npm start` opens a local browser preview and asks for the camera.
6. Allow the camera, sit so your face and upper chest are both visible, then hold still. Stop with Ctrl+C.

If the default camera fails:

```bash
npm run cameras
```

Then add `CAMERA_ID=` (an id from that list) to `.env` and run `npm start` again.

Requires Node.js 20+ and a webcam. Metrics are raw measurements (pulse, breathing, HRV, quality). They are not stress, emotion, or lie detection.
