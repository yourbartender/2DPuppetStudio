# Puppet Studio (2D Character Rigging & Live Motion Capture)

A high-performance 2D character rigging, live AI motion capture, and OSC (Open Sound Control) broadcasting suite. Available as a **high-performance native macOS Swift application** (`macos-native/`) leveraging the Apple Neural Engine (`Vision` + `AVFoundation`), and as a **cross-platform desktop and web application** (`electron/`, `src/`) powered by Google MediaPipe Vision.

---

## Workspace Targets

* **`macos-native/` — Primary Native macOS Application (Swift & SwiftUI)**:
  * Zero external dependencies — pure Swift, AppKit, SwiftUI, AVFoundation, and Apple Vision.
  * Direct Apple Neural Engine hardware acceleration for sub-millisecond hand, pose, and face inference.
  * Full-featured **2D Puppet Studio** with Photoshop (.PSD) multi-layer character import (multi-slot sharing + remembered PSD), Paper Puppet Sheet auto-slicing, 3-part limb rigging, 2-bone Inverse Kinematics (IK), speech visemes, and independent wink/brow tracking.
  * **Character-Only NDI Video Output** (`BGRA` transparent alpha or Chroma/White) via runtime NDI detection (`/usr/local/lib/libndi.dylib`) and **Live Camera / Video / Photo** reference tracking input.
  * Low-latency UDP OSC packet streaming (default `127.0.0.1:9000`).
  * See [macos-native/README.md](macos-native/README.md) for dedicated native architecture docs.
* **`electron/` & `src/` — Cross-Platform Desktop & Web App (Windows, Linux, macOS — React 19, Vite, MediaPipe)**:
  * Full **2D Puppet Studio** parity for PC/Windows, Linux, and macOS: live 60 FPS HTML5 Canvas puppet stage, 4 workspace modes (`Split`, `2D Puppet Studio`, `Full Stage Preview` + Clean Feed, `Camera & OSC`), Photoshop `.PSD` multi-layer importer, Paper Puppet Sheet auto-slicer, interactive Pin Rigging editor, outward 2-bone Arm/Leg IK, local-axis palm flip & back-of-hand swap, 52 ARKit blendshape visemes/winks, Live Camera / Video / Photo reference input, Undo/Redo, and **100% `.puppet.json` compatibility** with the native macOS app.
  * Offline MediaPipe Hand Gesture, Full-Body Pose, and 478-point Face + 52 Blendshapes models bundled locally with WASM runtime.
  * Native UDP OSC broadcasting via Electron bridge (`npm run start:electron`, `npm run package:win`, `npm run package:mac`, `npm run package:linux`).
  * See [ELECTRON.md](ELECTRON.md) for Windows, Linux, and macOS build & packaging instructions.

---

## Interface & Screenshots

| **Split: Camera + Puppet** | **2D Puppet Studio (Rigging Canvas)** |
|:---:|:---:|
| ![Split Mode](Screenshots/01%20Split%20mode.png) | ![Puppet Studio Mode](Screenshots/02%20PuppetStudio%20mode.png) |
| *Real-time tracking telemetry side-by-side with live character performance* | *Interactive canvas pin rigging, layer reordering & Free Transform controls* |

| **Full Stage Preview** | **Camera Telemetry & OSC Broadcast** |
|:---:|:---:|
| ![Full Stage Preview](Screenshots/03%20FullStage%20preview.png) | ![Camera and OSC](Screenshots/04%20Camera%20and%20OSC.png) |
| *Immersive performance stage with collapsible camera picture-in-picture* | *Apple Vision Neural Engine landmarks, speech meters & UDP OSC streaming* |

---

## Quick Start (Native macOS App)

### Prerequisites
* macOS 14.0 (Sonoma) or macOS 15.0+ (Sequoia).
* Xcode Command Line Tools installed (`xcode-select --install`).

### Build & Launch
```bash
# Build the native macOS release .app bundle
./macos-native/build-app.sh

# Launch Puppet Studio
open "macos-native/build/Puppet Studio.app"
```

The build script compiles with optimizations (`swift build -c release`), copies resources, strips extended attributes, and applies local ad-hoc code-signing so macOS camera security permissions bind cleanly.

---

## Core Capabilities (Native macOS App)

### 1. Photoshop (.PSD) & Character Workflow (⌘N)
* **Direct Photoshop (.PSD) Import**:
  * One-click zero-dependency parser for multi-layer Photoshop and Procreate `.psd` files.
  * Extracts trimmed RGBA layers directly from PackBits RLE bitmap streams with clean alpha premultiplication.
  * Intelligent multilingual layer-to-slot auto-matcher (Finnish & English: `Pää`, `Vartalo`, `Olkavarsi`, `Kyynärvarsi`, `Kämmen`, `Kämmenselkä`, `Reisi`, `Sääri`, `Jalkaterä`, `Silmä`, `Suu`, etc.).
  * **Multi-Slot Sharing & Remembered PSD**: Assign a single PSD layer to multiple puppet slots (e.g. sharing one mouth layer across `Mouth (Ah)` and `Mouth (Oh)`), copy exact uncropped sprites between slots, and reopen your remembered PSD without re-selecting it from Finder.
  * **Smart Joint & Pin Solver**: Automatically derives exact joint pivots (neck base, eye anchors, brow warp points, mouth visemes, and shoulder mount sockets) directly from layer overlaps on your Photoshop canvas.
* **New Puppet Workflow (⌘N)**:
  * Modal with 3 clean options: **Import Layered Photoshop (.PSD)**, **Import Paper Puppet Sprite Sheet**, or **Start Blank Human Rig**.

### 2. 2D Puppet Studio & Character Rigging
* **Symmetrical Front-Facing Architecture**: Designed from the ground up for clean, anatomically balanced characters (humanoids, stylized characters, robots, fantasy rigs).
* **Paper Puppet Sheet Auto-Slicer & AI Guide**:
  * One-click import of traditional cut-out sprite sheets (transparent PNG/WebP or solid black/custom background).
  * Automatically segments artwork into isolated body-part islands via connected-component analysis.
  * Interactive slot assignment modal with sequential mapping.
  * Built-in prompt generator with copy-paste prompts tailored for AI image generators (Midjourney, DALL-E, etc.).
* **3-Part Legs & Articulated Limbs**:
  * Full support for 3-part legs (**Thigh**, **Shin / Lower Leg**, and **Foot / Shoe**), 2-part limbs, or 1-piece limbs.
  * Automatic ground-tilt alignment for feet and shoes based on shin angle.
* **Per-Part Dimensions & Free Transform**:
  * Independent **Width** and **Height** multipliers for every limb segment, torso, pelvis, and head overlay.
  * Rotation angle controls with numeric input and slider adjustments.
  * Horizontal and Vertical flipping per part (allowing left limbs/shoes to mirror right limbs seamlessly).
  * Free Transform box directly on the stage canvas.
* **IK Hierarchical Articulation**:
  * `Follow Children on Move` and `Follow Children on Rotate` toggles per bone chain.
* **Interactive Canvas Pin Editor**:
  * Zoom from **100% to 450%** with smooth drag-to-pan.
  * Yellow active-pin highlighting, drag handles, and **arrow-key micro-nudging**.
  * **Double-click any pin** to instantly snap it back to its anatomical default.
  * Tag label visibility toggle (`Tags On` / `Tags Hidden`) to declutter dense facial features.
* **Character Package Persistence & Undo/Redo**:
  * **Save Character Package (⌘S)**: Exports a self-contained `.puppet.json` bundle with embedded base64 graphics, pin coordinates, and layer orders.
  * **Export Rig Only (⌥⌘S)**: Exports a lightweight coordinates-only `.puppet.json` file.
  * **Load Character / Rig (⌘O)**: Import existing character packages or rig presets.
  * Debounced 350 ms background autosaving for 60 FPS slider interactions.
  * Full **Undo (⌘Z)** and **Redo (⇧⌘Z)** stack for all pin moves and sprite replacements.
* **Front-to-Back Layer Depth Ordering**:
  * Reorderable layer stack allowing limbs, accessories, and shoes to render cleanly in front of or behind the torso and pelvis.

### 2. Natural 2-Bone Inverse Kinematics (IK)
* **Outward Elbow Bias**: Solves shoulder-to-elbow and elbow-to-wrist kinematics with a natural outward bend.
* **Camera Pose Alignment**: Evaluates circle-intersection candidates against real-time body pose elbow vectors so raising hands beside or above the head bends elbows naturally outward/up rather than collapsing into the chest.

### 3. Face, Wink, Brow & Speech Tracking
* **Glasses & Facial Hair Resilient**: Normalizes 2.5D head turns and scale using rigid skull Inter-Ocular Distance (IOD) rather than jaw contours.
* **Independent Eye Wink vs. Bilateral Blink**:
  * Combines tilt-compensated Eye Aspect Ratio (EAR) asymmetry with per-side Brow-to-Eye compression.
  * Clamps the open eye to 0% during winks, suppressing sympathetic squinting.
  * Squashed open-eye blink fallback when dedicated closed-eye sprites are not provided.
* **Independent Eyebrow Tracking**: Left and right eyebrow arching, frowning, and winking with 2.5D depth parallax.
* **Speech Viseme Lip-Sync**: Real-time mouth height and smile/pucker analysis dynamically drives speech visemes (`Neutral`, `Ah`, `Oh`, `Ee`/`Smile`) with hybrid sprite-swap and jaw-warp options.
* **One-Click Neutral Calibration**: Instant baseline zeroing for resting face posture.

### 4. Precise Hand Tracking, 3D Palm Orientation & Back-of-Hand Swap
* **Skeleton-Anchored L/R Identity**: Candidate filtering requires $\ge 11$ confident joints and anchors single-hand detections to live body-pose wrists/shoulders so half-body poses never swap left and right.
* **3D Palm Orientation & Back-of-Hand Slots**: Detects palm facing camera vs. back-of-hand. Supports dedicated `L Hand (Back)` / `R Hand (Back)` sprites (`Kämmenselkä`) when `Dynamic Palm Flip` is active, or mirrors the palm cleanly along its local finger axis without twisting pointing direction.

### 5. Multi-Mode Stage, Reference Media & NDI Alpha Output
* **View Modes**:
  * **Split: Camera + Puppet**: Side-by-side view for monitoring tracking telemetry and character performance simultaneously.
  * **2D Puppet Studio**: Full rigging and editing workspace with pin telemetry and layer stack controls.
  * **Full Stage Preview**: Fullscreen puppet view with collapsible camera picture-in-picture.
  * **Clean Feed**: Toggle off all UI elements for direct screen capture or projector output.
* **NDI Video Output (Transparent Alpha / Chroma)**:
  * Click **`NDI Out`** in the header bar to stream `1280×720` character-only video to **OBS Studio**, **TouchDesigner**, **Resolume**, or **NDI Video Monitor** (requires `/usr/local/lib/libndi.dylib` from NDI Tools/Runtime).
  * Choose **Transparent (Alpha BGRA)**, **Match Stage Background**, **Chroma Green**, or **Solid White** from the NDI dropdown.
* **Live Camera, Video File & Reference Photo Input**:
  * Switch between **Live Camera**, **Video…** (`.mp4`/`.mov` with Play/Pause), and **Photo…** (`.png`/`.jpg`) directly in the camera preview or sidebar to tune puppet rigs hands-free, plus a **`3s Pose`** countdown timer for A-Pose / neutral calibration.
* **Stage Backgrounds**: Switch between **Dark Stage**, **Clean White Stage**, **Chroma Green**, and **Chroma Blue** for live chroma keying.

### 6. Sub-Millisecond OSC Broadcasting
* Streams normalized coordinates, gesture classifications, and facial blendshapes over UDP socket (`127.0.0.1:9000`).
* Compatible with standard MediaPipe / VMC naming conventions (`/hand/L/...`, `/hand/R/...`, `/pose/...`, `/face/...`).
* Send rate throttle slider ($10\text{ Hz}$ to $120\text{ Hz}$).

---

## Architecture & Data Flow

```
Camera Input (AVFoundation 60 FPS)
  │
  ├──► Apple Vision Neural Engine
  │     ├── Face Landmarks & IOD Metrics (2.5D Head Pose, Winks, Visemes)
  │     ├── Hand Landmarks (21 Joints, Wrist Angle, 3D Palm Orientation)
  │     └── Body Pose (33 Joints, Outward 2-Bone IK Target Evaluation)
  │
  ├──► 2D Puppet Studio (SwiftUI Canvas & Metal Compositor)
  │     ├── Hierarchical Articulation & Forward/Inverse Kinematics
  │     ├── Multi-Layer Depth Ordering (Front/Behind Body & Head)
  │     ├── Speech Viseme Lip-Sync & Sympathetic Wink Isolation
  │     └── Free Transform Canvas Tool (CMD+T / Multi-Handle Scaling & Rotation)
  │
  └──► OSC Broadcaster (UDP Socket / Sub-Millisecond Dispatch)
        └── OBS Studio, TouchDesigner, Resolume, Max/MSP, Vuo
```

---

## Contributing & Development

Contributions are welcome! To get started:

1. Clone this repository:
   ```bash
   git clone https://github.com/yourbartender/2DPuppetStudio.git
   cd 2DPuppetStudio
   ```
2. Build and launch the native macOS application:
   ```bash
   ./macos-native/build-app.sh
   open "macos-native/build/HandOSC Native.app"
   ```
3. Make sure all local builds pass before opening a Pull Request. Build artifacts (`.build/`, `build/`) and OS caches are automatically ignored by [`.gitignore`](.gitignore).

---

## Troubleshooting: Camera & CoreMediaIO

If your webcam preview freezes or displays a black frame on macOS:

* **Cause**: Virtual camera extensions (e.g., OBS Virtual Camera, Elgato, NDI, or legacy DAL plugins in `/Library/CoreMediaIO/Plug-Ins/DAL/`) can occasionally lock macOS's `CoreMediaIO` daemon in a Mach IPC trap, hanging all camera access system-wide.
* **Quick Terminal Fix** (clears camera daemons without rebooting):
  ```bash
  sudo killall -9 UVCAssistant appleh13camerad cameracaptured com.apple.cmio.registerassistantservice com.obsproject.obs-studio.mac-camera-extension
  ```
* **Permissions**: Ensure HandOSC Native has permission under **System Settings → Privacy & Security → Camera**.

---

## Roadmap

* **Syphon & NDI Video Output**: Direct GPU texture sharing from the stage canvas to OBS Studio, TouchDesigner, and Resolume.
* **Animation Timeline & Recording**: Direct export to MP4 / ProRes (with alpha channel) and timeline keyframing.
* **Cross-Platform PC/Windows Port**: Full feature parity on Windows utilizing the Electron / MediaPipe runtime.
