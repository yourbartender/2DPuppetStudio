# Puppet Studio (Electron — Windows, Linux & macOS)

Cross-platform desktop build of **Puppet Studio** powered by **React 19 + Vite + Electron + Google MediaPipe Vision (offline WASM)** with real UDP OSC sockets.

Designed as a full cross-platform counterpart to `macos-native/` so **Windows / PC and Linux** users get the complete **2D Puppet Studio** experience and can load/save the exact same **`.puppet.json`** character files!

---

## Features Included in the Electron Build

- **Full 2D Puppet Studio (60 FPS Canvas Engine)**:
  - **4 Workspace Modes**: `Split: Camera + Puppet`, `2D Puppet Studio`, `Full Stage Preview` (with Clean Feed & collapsible Camera PiP for OBS Window Capture / Chroma Key), and `Camera & OSC`.
  - **Photoshop (`.PSD`) Multi-Layer Importer**: Zero-dependency client-side 8-bit RGB PackBits parser, multilingual English/Finnish slot auto-matcher (including `Kämmenselkä` → `L/R Hand (Back)`), multi-slot layer sharing, union-rect eye/mouth alignment, and automatic 1:1 joint pin rigging.
  - **Paper Puppet Sheet Auto-Slicer**: Perimeter flood-fill background remover, connected-component cut-out detector, and sheet generator from the current puppet.
  - **Interactive Rigging & Proportions Inspector**: Drag-and-drop Pin Editor (double-click pin to reset), layer order `↑/↓`, `"Copy From Part…"`, per-part Width / Height / Rotate / Flip H / Flip V, Character & Limb proportion sliders, Undo/Redo (`Ctrl/⌘Z`, `Ctrl/⌘⇧Z`), and IndexedDB autosave.
  - **100% `.puppet.json` Interoperability**: Exported character packages from macOS Native load seamlessly on Windows/PC and vice versa.
- **MediaPipe Holistic Tracking (100% Offline)**:
  - **Hands** (`gesture_recognizer.task`): 2 × 21 landmarks, skeleton-anchored L/R matching, local-axis palm flip & back-of-hand detection, outward 2-bone Arm IK.
  - **Full-Body Pose** (`pose_landmarker_full.task`): 33 landmarks, torso lean, ground-anchored & lifted-leg / high-kick tracking (screen-X L/R matched).
  - **Face & Expressions** (`face_landmarker.task`): 478 landmarks + **52 ARKit blendshapes** driving jaw warp, brow lift, independent L/R winks, and speech visemes (`Neutral`, `Ah`, `Oh`, `Smile`, `Wide`).
  - **Input Sources**: Switch between **Live Camera**, **Video File** (`.mp4`/`.mov`/`.webm` with Play/Pause), and **Still Photo** (`.png`/`.jpg`) plus instant **Calibrate** & **`3s Pose`** countdown.
  - **Smooth Tracking Timeout**: Holds briefly on lost tracking, then glides smoothly back to neutral resting pose instead of snapping or leaving ghost skeletons.
- **UDP OSC Broadcasting**:
  - Streams `/hand/L|R/*`, `/pose/*`, `/face/*`, and `/face/blendshape/*` to Max/MSP, TouchDesigner, Ableton Live, Resolume, VCV Rack, etc. (default `127.0.0.1:9000`).

---

## Quick Start (Windows PC, Linux & macOS)

Requires **Node.js 18+** (tested on Node 20–24) and **npm**.

### 1. Install & Run Immediately in Electron
```bash
npm install
npm run start:electron
```

### 2. Package Standalone Executables

#### Windows (64-bit `.exe` folder)
```bash
npm run package:win
```
Output: `electron-release/Puppet Studio-win32-x64/Puppet Studio.exe`

#### macOS (Apple Silicon or Intel `.app`)
```bash
npm run package:mac         # Apple Silicon (arm64)
npm run package:mac:intel   # Intel (x64)
```
Output: `electron-release/Puppet Studio-darwin-arm64/Puppet Studio.app`

#### Linux (64-bit)
```bash
npm run package:linux
```
Output: `electron-release/Puppet Studio-linux-x64/Puppet Studio`

### 3. Browser-Only Development Server (Preview without UDP)
```bash
npm run dev
```

---

## Offline MediaPipe Assets

All models and WASM files live locally in `public/mediapipe/` and are bundled into `dist-electron/mediapipe/` during `npm run build:electron`:
- `public/mediapipe/gesture_recognizer.task`
- `public/mediapipe/pose_landmarker_full.task`
- `public/mediapipe/face_landmarker.task`
- `public/mediapipe/wasm/` (auto-synced from `node_modules/@mediapipe/tasks-vision/wasm/`)

No internet access is required at runtime!
