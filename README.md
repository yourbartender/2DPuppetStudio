# Puppet Studio (2D Character Rigging & Live Motion Capture)

A high-performance 2D character rigging, live AI motion capture, video output, and OSC (Open Sound Control) broadcasting suite. Available as a **native macOS Swift application** (`macos-native/`) leveraging the Apple Neural Engine (`Vision` + `AVFoundation` + NDI Alpha), and as a **cross-platform desktop application for Windows, Linux, and macOS** (`electron/`, `src/`) powered by Google MediaPipe Vision (offline WASM).

Both builds share the exact same **`.puppet.json`** character package format so puppets rigged on macOS open seamlessly on Windows PC and vice versa.

---

## Workspace Targets

* **`macos-native/` — Native macOS Application (Swift & SwiftUI — Apple Silicon / Intel)**:
  * Zero external dependencies — pure Swift, AppKit, SwiftUI, AVFoundation, and Apple Vision.
  * Direct Apple Neural Engine hardware acceleration for sub-millisecond hand, pose, and face inference.
  * Full **2D Puppet Studio** with Photoshop (`.PSD`) multi-layer character import (multi-slot sharing + remembered PSD), Paper Puppet Sheet auto-slicing, 3-part limb rigging, outward 2-bone Inverse Kinematics (IK), local-axis palm flip & back-of-hand swap (`L/R Hand (Back)`), speech visemes, and independent wink/brow tracking.
  * **Character-Only NDI Video Output** (`BGRA` straight transparent alpha, Match Stage Background, Chroma Green, or Solid White) via runtime NDI detection (`/usr/local/lib/libndi.dylib`).
  * **Live Camera, Video File (`.mp4`/`.mov`), and Still Photo (`.png`/`.jpg`)** tracking input with smooth tracking-loss glide-to-neutral.
  * Low-latency UDP OSC packet streaming (default `127.0.0.1:9000`).
  * See [macos-native/README.md](macos-native/README.md) for native macOS architecture details.
* **`electron/` & `src/` — Cross-Platform Desktop App (Windows PC, Linux & macOS — React 19, Vite, MediaPipe)**:
  * Full **2D Puppet Studio** parity for PC/Windows, Linux, and macOS: live 60 FPS HTML5 Canvas puppet stage, 4 workspace modes (`Split: Camera + Puppet`, `2D Puppet Studio`, `Full Stage Preview` with Clean Feed & collapsible Camera PiP, and `Camera & OSC`), Photoshop `.PSD` multi-layer importer, Paper Puppet Sheet auto-slicer, interactive Pin Rigging editor, outward 2-bone Arm/Leg IK, local-axis palm flip & back-of-hand swap, 52 ARKit blendshape visemes/winks, Live Camera / Video / Photo reference input, Undo/Redo, IndexedDB autosave, and **100% `.puppet.json` compatibility** with `macos-native/`.
  * Offline MediaPipe Hand Gesture, Full-Body Pose, and 478-point Face + 52 ARKit Blendshapes models bundled locally with WASM runtime (no internet required).
  * Native UDP OSC broadcasting via Electron bridge.
  * See [ELECTRON.md](ELECTRON.md) for detailed Windows, Linux, and macOS Electron documentation.

---

## Interface & Screenshots

| **Split: Camera + Puppet** | **2D Puppet Studio (Rigging Canvas)** |
|:---:|:---:|
| ![Split Mode](Screenshots/01%20Split%20mode.png) | ![Puppet Studio Mode](Screenshots/02%20PuppetStudio%20mode.png) |
| *Real-time tracking telemetry side-by-side with live character performance* | *Interactive canvas pin rigging, layer reordering & Free Transform controls* |

| **Full Stage Preview** | **Camera Telemetry & OSC Broadcast** |
|:---:|:---:|
| ![Full Stage Preview](Screenshots/03%20FullStage%20preview.png) | ![Camera and OSC](Screenshots/04%20Camera%20and%20OSC.png) |
| *Immersive performance stage with collapsible camera picture-in-picture* | *Live landmarks, expression meters & UDP OSC streaming* |

---

## Quick Start

### Option A: Native macOS App (Recommended on Apple Silicon)
**Prerequisites**: macOS 14.0 (Sonoma) or macOS 15.0+ (Sequoia) and Xcode Command Line Tools (`xcode-select --install`).

```bash
# Build the native macOS release .app bundle
./macos-native/build-app.sh

# Launch Puppet Studio
open "macos-native/build/Puppet Studio.app"
```

The build script compiles with release optimizations (`swift build -c release`), copies resources, strips extended attributes, and applies local ad-hoc code-signing so macOS camera permissions bind cleanly.

### Option B: Windows PC, Linux & macOS (Electron + MediaPipe)
**Prerequisites**: Node.js 18+ (tested on Node 20–24) and npm.

```bash
# Install dependencies
npm install

# Run Puppet Studio directly in Electron
npm run start:electron
```

To package standalone executables into `electron-release/`:

```bash
# Windows 64-bit (.exe)
npm run package:win

# macOS (Apple Silicon / Intel)
npm run package:mac
npm run package:mac:intel

# Linux 64-bit
npm run package:linux
```

---

## Core Capabilities

### 1. Photoshop (`.PSD`) & Character Workflow (`Ctrl/⌘N`)
* **Direct Photoshop (`.PSD`) Import**:
  * Zero-dependency parser for 8-bit RGB multi-layer Photoshop and Procreate `.psd` files (PackBits RLE & Raw channels with clean straight alpha).
  * Intelligent multilingual layer-to-slot auto-matcher (English & Finnish: `Head`/`Pää`, `Torso`/`Vartalo`, `Upper Arm`/`Olkavarsi`, `Forearm`/`Kyynärvarsi`, `Hand`/`Kämmen`, `Hand Back`/`Kämmenselkä`, `Thigh`/`Reisi`, `Shin`/`Sääri`, `Foot`/`Jalkaterä`, `Eye`/`Silmä`, `Mouth`/`Suu`, `Tail`/`Häntä`, etc.).
  * **Multi-Slot Sharing & Remembered PSD**: Assign a single PSD layer to multiple puppet slots (e.g., sharing one mouth layer across `Mouth (Ah)` and `Mouth (Oh)`), copy exact uncropped sprites between slots (`Copy From Another Part…`), and reopen your remembered PSD without re-selecting it.
  * **Smart Joint & Pin Solver**: Automatically derives exact joint pivots (neck, eyes, brows, mouth, shoulders, elbows, wrists, hips, knees, ankles) from layer overlaps on your PSD canvas and aligns mouth/eye union rects so swaps never jump.
* **New Puppet Workflow (`Ctrl/⌘N`)**:
  * Start from **Import Photoshop (`.PSD`)**, **Slice Paper Puppet Sheet**, **Demo Character**, or **Blank Puppet**.

### 2. 2D Puppet Studio & Character Rigging
* **Paper Puppet Sheet Auto-Slicer**:
  * Import drawn or scanned character sheets (PNG/JPG/WebP) with perimeter flood-fill background removal (protecting white eyes/fur inside outlines), automatic connected-component slicing, and sheet generation from the current puppet.
* **3-Part Limbs & Articulated Full Body**:
  * Full support for 3-part legs (**Thigh**, **Shin**, **Foot / Shoe**), 3-part arms (**Upper Arm**, **Forearm**, **Hand** + **Hand Back**), **Pelvis**, and swaying **Tail**.
* **Per-Part Dimensions & Layer Stack**:
  * Independent **Width**, **Height**, **Rotation**, and **Flip H / Flip V** controls per part.
  * Front-to-back reorderable layer stack (`↑`/`↓`) so arms, legs, or tail can render cleanly in front of or behind the torso.
* **Interactive Canvas Pin Editor**:
  * Drag joint pins directly on each part graphic and **double-click any pin** to snap it back to its default coordinates.
* **Cross-Platform `.puppet.json` Persistence & Undo/Redo**:
  * **Save Character Package (`Ctrl/⌘S`)**: Self-contained `.puppet.json` with embedded base64 PNGs, pins, transforms, and layer stack — compatible between macOS Native and Electron/Windows.
  * **Load Character / Rig (`Ctrl/⌘O`)** and background autosaving.
  * Full **Undo (`Ctrl/⌘Z`)** and **Redo (`Ctrl/⌘⇧Z` / `Ctrl+Y`)** stack.

### 3. Natural Outward 2-Bone Inverse Kinematics (IK) & Legs
* **Outward Elbow Bias & Camera Pose Alignment**: Solves shoulder → elbow → wrist kinematics by matching circle-intersection candidates against the user's live elbow vector so raising hands beside or above the head bends elbows naturally outward/up rather than collapsing inward.
* **Ground-Anchored & Lifted Legs**: Feet stay grounded during normal torso/head sway, and lift naturally (including high kicks) when lifting a leg in front of the camera, with screen-X L/R matching so legs never mirror-swap.
* **Smooth Tracking-Loss Recovery**: Briefly holds pose on momentary tracking loss, then glides smoothly back toward the neutral resting A-pose instead of snapping or showing ghost skeletons.

### 4. Face, Wink, Brow & Speech Viseme Tracking
* **Glasses & Facial Hair Resilient**: Uses rigid skull geometry (Inter-Ocular Distance & yaw-invariant vertical skull height with turn-lock) on macOS Vision, and 478 FaceMesh landmarks + 52 ARKit blendshapes on Electron/MediaPipe.
* **Independent Eye Wink vs. Bilateral Blink**: Isolates single-eye winks (suppressing sympathetic squinting on the open eye) with open/closed sprite swaps and hybrid squash tweening.
* **Speech Viseme Lip-Sync**: Real-time mouth opening, smile, and pucker analysis drives `Neutral`, `Ah`, `Oh`, and `Smile / Ee` visemes alongside 24-strip lower-jaw stretch warp.
* **Instant & Countdown Calibration**: One-click **Calibrate** plus **`3s Pose`** countdown timer for standing neutral A-Pose calibration.

### 5. Hand Tracking, 3D Palm Orientation & Back-of-Hand Swap
* **Skeleton-Anchored L/R Identity**: Matches single-hand detections to live pose wrists so half-body framing never swaps left and right hands.
* **Local-Axis Palm Flip & Back-of-Hand Slots**: Detects palm vs. back-of-hand orientation. When `Dynamic Palm Flip` is active, swaps in `L Hand (Back)` / `R Hand (Back)` (`Kämmenselkä`) if provided, or flips cleanly along the local finger axis without twisting pointing direction.

### 6. Multi-Mode Stage, Reference Media & Video Output (NDI / OBS)
* **4 Workspace Modes**:
  * **Split: Camera + Puppet**: Side-by-side tracking preview, puppet stage, and telemetry/OSC controls.
  * **2D Puppet Studio**: Main stage, mini-camera bar, and full 2-tab Rigging & Proportions Inspector.
  * **Full Stage Preview**: Fullscreen stage with collapsible camera PiP and **Clean Feed (Hide UI)** for direct OBS Window Capture or projector output.
  * **Camera & OSC**: Dedicated full-frame tracking telemetry and OSC configuration.
* **Character-Only NDI Video Output (macOS Native)**:
  * Click **`NDI Out`** in the header bar to stream `1280×720` character-only video to **OBS Studio**, **TouchDesigner**, **Resolume**, or **NDI Video Monitor** (auto-detects `/usr/local/lib/libndi.dylib` from NDI Tools/Runtime at runtime with zero build dependency).
  * Header dropdown lets you pick **Transparent (Alpha BGRA)** (straight alpha for compositing directly over paintings/scenes), **Match Stage Background**, **Chroma Green**, or **Solid White**.
* **OBS & Broadcast Integration (Windows / Linux / macOS Electron)**:
  * Use **Full Stage Preview → Clean Feed (Hide UI)** with **Chroma Green** or **Chroma Blue** backgrounds for instant OBS Studio Window Capture + Chroma Key.
* **Live Camera, Video File & Still Photo Input**:
  * Switch between **Camera**, **Video** (`.mp4`/`.mov`/`.webm` with Play/Pause), and **Photo** (`.png`/`.jpg`) directly in the preview bar to tune character rigs hands-free.

### 7. Sub-Millisecond UDP OSC Broadcasting
* Streams normalized or aspect-centered coordinates, gesture classifications, and facial blendshapes over UDP (`127.0.0.1:9000`) to **TouchDesigner**, **Max/MSP**, **Ableton Live**, **Resolume**, **VCV Rack**, and **Vuo**.
* Standard address namespaces: `/hand/L/...`, `/hand/R/...`, `/pose/...`, `/face/...`, `/face/blendshape/...`.

---

## Architecture & Data Flow

```
Input Source: Live Webcam │ Reference Video (.mp4/.mov) │ Still Photo (.png/.jpg)
  │
  ├──► macOS Native (macos-native/)              ├──► Cross-Platform Electron (src/ + electron/)
  │     ├── Apple Vision Neural Engine           │     ├── MediaPipe Offline WASM (GPU)
  │     ├── SwiftUI Canvas & Metal Compositor    │     ├── 60 FPS HTML5 2D Canvas Stage
  │     ├── NDI Out (Alpha BGRA / Chroma)        │     ├── Clean Feed + Chroma Key (OBS)
  │     └── Native UDP OSC Broadcaster           │     └── Electron Main UDP OSC Bridge
  │                                              │
  └──────────────────────┬───────────────────────┘
                         ▼
         Shared .puppet.json Character Packages
      & UDP OSC → OBS / TouchDesigner / Max / Resolume
```

---

## Contributing & Development

1. Clone this repository:
   ```bash
   git clone https://github.com/yourbartender/2DPuppetStudio.git
   cd 2DPuppetStudio
   ```
2. Verify both targets before opening a Pull Request:
   ```bash
   # Native macOS build
   ./macos-native/build-app.sh
   open "macos-native/build/Puppet Studio.app"

   # Cross-platform Electron build
   npm install
   npx tsc --noEmit && npm run build:electron
   ```
3. Build artifacts (`.build/`, `macos-native/build/`, `dist-electron/`, `electron-release/`) and local caches are automatically ignored by [`.gitignore`](.gitignore).

---

## Troubleshooting: Camera & CoreMediaIO (macOS)

If your webcam preview freezes or displays a black frame on macOS:

* **Cause**: Virtual camera extensions (e.g., OBS Virtual Camera, Elgato, NDI, or legacy DAL plugins in `/Library/CoreMediaIO/Plug-Ins/DAL/`) can occasionally lock macOS's `CoreMediaIO` daemon in a Mach IPC trap.
* **Quick Terminal Fix** (resets camera daemons without rebooting):
  ```bash
  sudo killall -9 UVCAssistant appleh13camerad cameracaptured com.apple.cmio.registerassistantservice com.obsproject.obs-studio.mac-camera-extension
  ```
* **Permissions**: Ensure **Puppet Studio** has permission under **System Settings → Privacy & Security → Camera**.

---

## Roadmap

* [x] **Character-Only NDI Video Output (macOS Native)**: Live `1280×720` straight-alpha `BGRA` and Chroma/White NDI streaming into OBS Studio, TouchDesigner, and Resolume.
* [x] **Cross-Platform Windows / Linux / macOS Electron Port**: Full 2D Puppet Studio parity (stage, PSD import, sheet slicer, pin rigging, 2-bone IK, MediaPipe 52 blendshapes, `.puppet.json` compatibility, and `package:win` / `package:mac` / `package:linux` scripts).
* [ ] **Syphon GPU Texture Output (macOS)** & **Native NDI Output on Windows/Electron**.
* [ ] **Animation Recording & Timeline**: Direct video export to MP4 / ProRes (with alpha channel) and in-app keyframe timeline.
