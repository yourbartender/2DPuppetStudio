# Puppet Studio (Electron) — MediaPipe Hand, Body & Face → OSC

A cross-platform desktop app that uses Google MediaPipe Landmarkers to track hands, body pose, and face expressions through your webcam and broadcasts OSC messages over UDP to creative tools like Max/MSP, Ableton Live, TouchDesigner, VCV Rack, etc.

Built on TanStack Start (Vite + React) for the UI and Electron for native camera access + real UDP sockets.

---

## OSC output formats

All addresses are namespaced per hand: `L` (left) or `R` (right). Each format can be toggled independently in the UI.

### 1. Per-landmark messages — `sendLandmarks`
One OSC message per landmark (21 per hand, up to 42 messages/frame for two hands).

```
/hand/L/landmark/0   x  y  z
/hand/L/landmark/1   x  y  z
...
/hand/L/landmark/20  x  y  z
```

### 2. Bundled message — `sendBundled`
All 21 landmarks flattened into one message of 63 floats `[x0,y0,z0, x1,y1,z1, ...]`.

```
/hand/L   x0 y0 z0 x1 y1 z1 ... x20 y20 z20
```

### 3. Axis-grouped messages — `sendAxisGrouped` (recommended for Max/MSP & TouchDesigner)
One message per axis, each carrying a list of 21 floats. Lets you handle all landmarks of one axis with a single iteration in your patch instead of routing 20+ separate xyz bundles.

```
/hand/L/x   x0 x1 x2 ... x20
/hand/L/y   y0 y1 y2 ... y20
/hand/L/z   z0 z1 z2 ... z20
```

### 4. Gesture + pinch — `sendGesture`
```
/hand/L/gesture         "None" | "Closed_Fist" | "Open_Palm" | "Pointing_Up"
                        | "Thumb_Down" | "Thumb_Up" | "Victory" | "ILoveYou"
/hand/L/gesture_score   0..1   (classifier confidence)
/hand/L/pinch           0..1   (1 = open, 0 = fully pinched — geometric, always emitted)
```

Gesture labels come directly from Google MediaPipe's official **Gesture Recognizer**
task (no hand-rolled heuristics). Pinch remains a separate continuous control
derived from thumb↔index distance, since the recognizer doesn't output it.

## Coordinate mapping

- **Centered (default)**: `x ∈ [-1, 1]` left-to-right, `y ∈ [-1, 1]` top-to-bottom. Matches the convention "x is -1..1, y is in relation to the screen height".
- **Normalized**: raw `0..1` MediaPipe coordinates.

`z` is depth (smaller = closer to camera), in normalized units. `mirror` flips the camera horizontally and swaps L/R handedness so the preview behaves like a mirror.

---

## Offline / local MediaPipe model

The MediaPipe models and WASM runtime are **bundled inside the app** — the packaged `.app` makes **no network connections** at runtime, and will keep working even if Google or jsDelivr change their CDN URLs.

- `public/mediapipe/gesture_recognizer.task` — the **active** model (~8 MB). Provides 21-point hand landmarks AND the 8 official gesture labels listed above. Checked into the repo.
- `public/mediapipe/hand_landmarker.task` — legacy landmarks-only model (~7.5 MB). Currently unused at runtime; kept for easy A/B or fallback. Safe to delete if you want to slim the repo.
- `public/mediapipe/wasm/` — the MediaPipe WASM runtime, copied automatically from `node_modules/@mediapipe/tasks-vision/wasm/` at build time by a small Vite plugin (`vite-plugins/copy-mediapipe-wasm.ts`). You don't need to maintain it manually — `npm install` + `npm run build:electron` keeps it in sync with the installed npm version.

### Upgrading the model later
If Google publishes a newer gesture model and you want it:
```bash
curl -L -o public/mediapipe/gesture_recognizer.task \
  https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/<NEW_VERSION>/gesture_recognizer.task
```
Then rebuild and repackage.

### Upgrading the WASM runtime
```bash
npm install @mediapipe/tasks-vision@latest
npm run build:electron   # auto-copies the new WASM into public/mediapipe/wasm/
```

---

## Run in development

Requires Node.js 18+ (tested on Node v24) and npm.

```bash
npm install
npm run dev          # Vite dev server (preview only — no real UDP, messages are logged)
```

The browser preview shows tracking but logs OSC instead of sending UDP. For real OSC you need the packaged Electron app.

---

## Build the macOS app

Tested on Apple Silicon with Electron Packager **v20** and Node v24.

### 1. Build the renderer
```bash
npm install
npm run build:electron
```

### 2. Package the `.app`

Use `npm exec electron-packager -- ...`. I verified this form locally in this project; it avoids the `npx` parsing issue that can surface in zsh/npm 11 as `Invalid processed options` or `Invalid Processing options`.

```bash
npm exec electron-packager -- . "HandOSC" \
  --platform=darwin --arch=arm64 \
  --out=electron-release --overwrite --prune=true \
  --ignore=/src --ignore=/public --ignore=/electron-release --ignore=/dist
```

If you want the most direct fallback, this also works:

```bash
./node_modules/.bin/electron-packager . "HandOSC" \
  --platform=darwin --arch=arm64 \
  --out=electron-release --overwrite --prune=true \
  --ignore=/src --ignore=/public --ignore=/electron-release --ignore=/dist
```

Replace `--arch=arm64` with `--arch=x64` for Intel Macs. The result is in `electron-release/HandOSC-darwin-*/HandOSC.app`.

You can also use `npm run package:mac` or `npm run package:mac:intel`.

> Note: Cross-compiled `.app` bundles built outside macOS are unsigned. On first launch right-click → Open to bypass Gatekeeper, or codesign locally.

---

## How to apply updates from Lovable

You don't need git — just download the changed files as a zip:

1. Download the zip linked at the bottom of the assistant's message (e.g. `handosc-changes-axis-grouped.zip`).
2. Unzip it **at your project root**. Folder structure is preserved (`src/hooks/...`, `src/components/...`), so files land in the right place and overwrite the old versions.
3. Rebuild + repackage:
   ```bash
   npm run build:electron
   npm exec electron-packager -- . "HandOSC" --platform=darwin --arch=arm64 --out=electron-release --overwrite
   ```
4. Only run `npm install` again if the assistant explicitly says `package.json` changed.

The assistant ends every code-change message with a "Changed files" block listing exactly which files were touched and whether `npm install` is needed.

---

## Vite config

`vite.config.ts` must produce relative asset paths so Electron's `file://` loader can find them:

```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
export default defineConfig({ vite: { base: "./" } });
```

---

## Project layout

```
src/
  components/HandOscApp.tsx     # main UI (camera, settings, stats)
  hooks/useHandTracker.ts       # MediaPipe loop + OSC dispatch
  lib/
    gestures.ts                 # gesture classification + pinch
    oneEuro.ts                  # 1 euro landmark smoothing filter
    oscBridge.ts                # UDP send (real in Electron, logged in browser)
  routes/                       # TanStack Start routes
electron/
  main.cjs                      # Electron main process + UDP socket bridge
  preload.cjs                   # contextBridge exposing osc.send()
  index.html                    # renderer entry
```