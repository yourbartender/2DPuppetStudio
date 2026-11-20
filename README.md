# HandOSC & 2D Puppet Studio

A multi-modal motion tracking, real-time 2D puppet animation, and OSC (Open Sound Control) broadcasting suite. Available as a **high-performance native macOS Swift application** (`macos-native/`) leveraging the Apple Neural Engine (`Vision` + `AVFoundation`), and as a **cross-platform desktop and web application** (`electron/`, `src/`) powered by Google MediaPipe Vision.

---

## Workspace Targets

* **`macos-native/` — Primary Native macOS Application (Swift & SwiftUI)**:
  * Zero external dependencies — pure Swift, AppKit, SwiftUI, AVFoundation, and Apple Vision.
  * Direct Apple Neural Engine hardware acceleration for sub-millisecond hand, pose, and face inference.
  * Full-featured **2D Puppet Studio** with Paper Puppet Sheet auto-slicing, 3-part limb rigging, 2-bone Inverse Kinematics (IK), speech visemes, and independent wink/brow tracking.
  * Low-latency UDP OSC packet streaming (default `127.0.0.1:9000`).
  * See [macos-native/README.md](macos-native/README.md) for dedicated native architecture docs.
* **`electron/` & `src/` — Cross-Platform Desktop & Web App (React 19, Vite, MediaPipe)**:
  * MediaPipe Hand Landmarker, Pose, and Gesture Recognizer running locally/offline with bundled WASM runtimes.
  * Native UDP socket broadcasting via Electron bridge.
  * See [ELECTRON.md](ELECTRON.md) for build, development, and packaging instructions.

---

## Quick Start (Native macOS App)

### Prerequisites
* macOS 14.0 (Sonoma) or macOS 15.0+ (Sequoia).
* Xcode Command Line Tools installed (`xcode-select --install`).

### Build & Launch
```bash
# Build the native macOS release .app bundle
./macos-native/build-app.sh

# Launch the app
open "macos-native/build/HandOSC Native.app"
```

The build script compiles with optimizations (`swift build -c release`), copies resources, strips extended attributes, and applies local ad-hoc code-signing so macOS camera security permissions bind cleanly.

---

## Core Capabilities (Native macOS App)

### 1. 2D Puppet Studio & Character Rigging
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

### 4. Precise Hand Tracking & 3D Palm Orientation
* **Anatomical Gating**: Candidate filtering requires $\ge 11$ confident joints and enforces body reach boundaries ($\le 0.74$ screen distance from shoulders) to eliminate background false positives.
* **3D Palm Orientation**: Detects palm facing camera vs. back-of-hand. Flipping the palm mirrors the thumb along the hand's local coordinate axis without twisting pointing direction.

### 5. Multi-Mode Stage & Broadcast Video Keying
* **View Modes**:
  * **Split: Camera + Puppet**: Side-by-side view for monitoring tracking telemetry and character performance simultaneously.
  * **2D Puppet Studio**: Full rigging and editing workspace with pin telemetry and layer stack controls.
  * **Full Stage Preview**: Fullscreen puppet view with collapsible camera picture-in-picture.
  * **Clean Feed**: Toggle off all UI elements for direct screen capture or projector output.
* **Stage Backgrounds**: Switch between **Dark Stage**, **Clean White Stage**, **Chroma Green**, and **Chroma Blue** for live chroma keying in OBS Studio, TouchDesigner, Resolume, Vuo, or Max/MSP.

### 6. Sub-Millisecond OSC Broadcasting
* Streams normalized coordinates, gesture classifications, and facial blendshapes over UDP socket (`127.0.0.1:9000`).
* Compatible with standard MediaPipe / VMC naming conventions (`/hand/L/...`, `/hand/R/...`, `/pose/...`, `/face/...`).
* Send rate throttle slider ($10\text{ Hz}$ to $120\text{ Hz}$).

---

## Publishing with GitHub Desktop

To publish this project to GitHub using **GitHub Desktop**:

1. **Open GitHub Desktop**.
2. Go to **File → Add Local Repository...** (or press `⌘O`).
3. Select this folder: `/Users/tknuutil/HandBodyFaceOSCsource` (or your local clone path).
4. GitHub Desktop will read the pre-configured [`.gitignore`](.gitignore), ensuring all compiled binaries (`macos-native/build/`, `macos-native/.build/`), dependencies (`node_modules/`), and OS metadata (`.DS_Store`) are automatically excluded.
5. Enter a summary (e.g. `Initial commit: HandOSC & 2D Puppet Studio`) and click **Commit to main**.
6. Click **Publish repository** to push it to your GitHub account (public or private).

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
