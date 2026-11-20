# HandOSC Native & 2D Puppet Studio (macOS Swift)

A high-performance, zero-dependency native macOS application built with Swift and SwiftUI. It tracks **hands**, **body pose**, and **face landmarks & expressions** using Apple's Neural Engine via the `Vision` + `AVFoundation` frameworks, drives a real-time **2D Puppet Animator**, and broadcasts normalized **OSC (Open Sound Control) over UDP**.

---

## Quick Start (Build & Run)

```bash
# Build the native macOS .app bundle (release mode)
./macos-native/build-app.sh

# Launch the app
open "macos-native/build/HandOSC Native.app"
```

---

## Key Features & Capabilities

### 1. 2D Puppet Studio & Character Rigging
* **Symmetrical Front-Facing Architecture**: Designed from the ground up for clean, anatomically balanced characters (humanoids, stylized characters, robots, fantasy rigs).
* **Paper Puppet Sheet Auto-Slicer & AI Guide**:
  * One-click import of traditional cut-out sprite sheets (transparent PNG/WebP or solid black/custom backgrounds).
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

### 2. Inverse Kinematics (IK) & Natural Arm Motion
* **2-Bone Outward IK**: Solves shoulder-to-elbow and elbow-to-wrist kinematics with natural outward elbow bias.
* **Camera Pose Elbow Alignment**: Circle-intersection IK solutions test dynamically against real-time body pose elbow vectors. Raising hands above or beside the head bends elbows naturally outward/up rather than collapsing into the torso.
* **Limb Proportions Control**: Sliders for Character Scale, Hand Scale, Arm Length & Thickness, and Leg Length & Thickness prevent limbs from stretching into distorted shapes.

### 3. Face, Wink, Brow & Speech Tracking
* **Glasses & Beard Resilient**: Facial expressions and 2.5D head turn/tilt are normalized by Inter-Ocular Distance (rigid skull distance between eye centers) rather than the jaw contour.
* **Single-Eye Wink vs. Bilateral Blink**:
  * Combines tilt-compensated Eye Aspect Ratio (EAR) asymmetry with per-side Brow-to-Eye compression.
  * Classifies single-eye winks cleanly while clamping the open eye to 0%, preventing sympathetic squints.
  * Squashed open-eye blink fallback when dedicated closed-eye sprites are not provided.
* **Independent Eyebrow Tracking**: Left and right eyebrow arching, frowning, and winking with 2.5D depth parallax.
* **Speech Visemes & Mouth Shapes**: Detects mouth open height and smile/pucker width, mapping speech dynamically into viseme sprites (`Neutral`, `Ah`, `Oh`, `Ee`/`Smile`) with hybrid sprite-swap and jaw-warp options.
* **One-Click Neutral Calibration**: Look at the camera with a relaxed posture and click **"Calibrate Neutral Face"** to zero personal baselines.

### 4. Hand Tracking & Palm Orientation
* **Outlier & False-Positive Rejection**: Hand candidate gating requires $\ge 11$ confident joints and enforces anatomical body reach gating ($\le 0.74$ screen distance from shoulders), rejecting false detections on room mouldings or ceiling edges.
* **3D Palm Orientation**: Detects palm facing camera vs. back-of-hand. Flipping the hand mirrors the thumb along the hand's local coordinate axis without twisting or mirroring pointing direction.

### 5. Multi-Mode Stage & Video Keying
* **View Modes**:
  * **Split: Camera + Puppet**: Side-by-side view for monitoring tracking alongside the live character.
  * **2D Puppet Studio**: Full rigging and editing workspace with interactive canvas, pin telemetry, and layer ordering.
  * **Full Stage Preview**: Full-window puppet view with a collapsible camera picture-in-picture preview.
  * **Clean Feed**: Toggle off all UI overlays for clean screen capture or broadcasting.
* **Stage Backgrounds**: Switch between **Dark Stage**, **Clean White Stage**, **Chroma Green**, and **Chroma Blue** for live chroma keying into OBS Studio, TouchDesigner, Vuo, Resolume, or Max/MSP.

### 6. Low-Latency OSC Broadcasting
* Broadcasts bundled or per-landmark float coordinates over UDP socket (configurable IP and port, default `127.0.0.1:9000`).
* Compatible with standard MediaPipe / VMC OSC naming conventions (`/hand/L/...`, `/hand/R/...`, `/pose/...`, `/face/...`).
* Send rate throttle slider ($10\text{ Hz}$ to $120\text{ Hz}$).

---

## System Architecture

```
macos-native/
├── Info.plist                     # App metadata, camera usage string, window restoration policies
├── Package.swift                  # Swift Package Manager manifest (macOS 14+)
├── build-app.sh                   # Release build & code-signing script
├── README.md                      # Native app documentation
└── Sources/HandOSCNative/
    ├── HandOSCNativeApp.swift     # App entry point, lifecycle & AppKit window persistence overrides
    ├── Models/
    │   ├── PuppetModel.swift      # Rig state, pins, layer ordering, presets, undo/redo & JSON persistence
    │   └── TrackerSettings.swift  # Landmark models, calibration baseline & OSC preferences
    ├── OSC/
    │   └── OSCClient.swift        # UDP socket broadcasting for OSC packets
    ├── Tracking/
    │   ├── HolisticTracker.swift  # AVFoundation video capture, Apple Vision requests & smoothing
    │   ├── GestureClassifier.swift# Face/wink measurements, 2.5D head pose, hand gestures & palm sign
    │   └── OneEuroFilter.swift    # 1 Euro filter for landmark jitter reduction
    └── UI/
        ├── ContentView.swift      # Main container, navigation bar, OSC telemetry & split view
        ├── CameraPreviewView.swift# Hardware-accelerated camera preview with skeleton overlays
        └── PuppetStudioView.swift # 2-bone IK rendering, stage canvas, pin editor & rigging UI
```

---

## Troubleshooting: macOS Camera Extensions & CoreMediaIO

If the camera fails to start or the app becomes unresponsive on launch:

1. **Stuck Virtual Camera Extension (OBS / NDI / Elgato)**:
   * Third-party virtual camera extensions (e.g. `com.obsproject.obs-studio.mac-camera-extension` or legacy DAL plugins in `/Library/CoreMediaIO/Plug-Ins/DAL/`) can occasionally lock macOS's `CoreMediaIO` daemon in a Mach IPC trap. When this occurs, even Apple's built-in **Photo Booth** or **FaceTime** will hang on launch.
   * **Fix (Recommended)**: Restart your Mac to clear all kernel Mach IPC ports.
   * **Quick Terminal Fix (Without Reboot)**:
     ```bash
     sudo killall -9 UVCAssistant appleh13camerad cameracaptured com.apple.cmio.registerassistantservice com.obsproject.obs-studio.mac-camera-extension
     ```
2. **Disable Unused Camera Extensions**:
   * Go to **System Settings → General → Login Items & Extensions → Camera Extensions** and turn off OBS Virtual Camera when not in use.
3. **Camera Permissions**:
   * Ensure HandOSC Native is granted access in **System Settings → Privacy & Security → Camera**.

---

## Roadmap

* **Syphon / NDI Output**: Native Syphon and NDI video server output directly from the puppet stage.
* **Animation Timeline & Recording**: Direct-to-disk video capture (`.mp4` / ProRes with alpha) and keyframe timeline recording.
* **Electron / Cross-Platform Port**: Windows/PC build utilizing MediaPipe / ONNX runtime.
