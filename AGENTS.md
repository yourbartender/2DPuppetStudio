# Puppet Studio (Native macOS Swift & 2D Animation Rig) — Agent Instructions & Context

## Workspace Overview & Targets
* **Repository Root**: `/Users/tknuutil/HandBodyFaceOSCsource`
* **Primary Active Target**: `macos-native/` — zero-dependency native macOS app (Swift / SwiftUI / Apple Vision Neural Engine / AVFoundation / UDP OSC).
  * Build & Launch: `./macos-native/build-app.sh` -> creates and opens `macos-native/build/Puppet Studio.app` (symlinked also as `HandOSC Native.app`).
* **Secondary Target**: `electron/` & `src/` — React 19 / Vite / MediaPipe cross-platform desktop app for PC/Windows.

## Architectural & Technical Invariants

### 1. 2D Puppet Studio & Character Rigging
* **Presets**: Aurora Fox (`Maskotti_testi_Aurora_Alert.psd` articulated cuts) and Standard Human.
* **Canvas Pin Rigging**: Drag-and-drop pins on features/joints; double-click resets pin to default coordinates.
* **Undo/Redo**: Full undo (⌘Z) / redo (⇧⌘Z) stack.
* **Persistence**: Save Rig (⌘S) button, debounced 350ms background autosave (`DispatchQueue.global(qos: .utility)`), and `.puppet.json` export/import.
* **Layer Depth Ordering**: Per-limb front/behind body ordering (e.g., right arm/leg behind torso for 3/4 view).
* **Proportions**: Character Scale, Hand Scale, Arm Length & Thickness, Leg Length & Thickness.

### 2. Inverse Kinematics (IK) & Natural Limbs
* **Outward 2-Bone IK Solver**: Circle-intersection candidates are matched against the user's camera pose elbow vector via dot product. Raising hands near ears/head bends elbows naturally outward/up instead of collapsing inward.
* **Local-Axis Hand Transforms**: Sprite intrinsic rotation occurs before palm flip, preserving thumb mirroring without twisting pointing direction.
* **Candidate Gating**: Hand detection requires >= 11 joints (>= 0.34 average confidence) and enforces <= 0.74 screen distance from shoulders to reject background false positives.

### 3. Face, Wink & Speech Tracking
* **Inter-Ocular Distance (IOD)**: Skull-referenced IOD normalization resilient to facial hair and glasses.
* **Wink vs. Blink**: Tilt-compensated Eye Aspect Ratio (EAR) asymmetry + brow compression. Single-eye winks clamp open eye to 0.0%, suppressing sympathetic blinks.
* **Visemes**: Real-time speech mapping (`Neutral`, `Ah`, `Oh`, `Ee`/`Smile`).

### 4. AppKit & CoreMediaIO Stability
* `refreshCameras()` must execute asynchronously on a background queue (`DispatchQueue.global(qos: .userInitiated)`) to prevent virtual camera extensions (e.g. OBS, DAL plugins) from blocking the UI thread.
* `ApplePersistenceIgnoreState = YES` stops AppKit restore loops after force quits.
* Camera daemon hung state cleanup:
  ```bash
  sudo killall -9 UVCAssistant appleh13camerad cameracaptured com.apple.cmio.registerassistantservice com.obsproject.obs-studio.mac-camera-extension
  ```

## Pending Roadmap & Next Steps
1. Verify live camera tracking in `HandOSC Native.app`.
2. Direct stage video output: Syphon / NDI streaming into OBS, TouchDesigner, or Resolume.
3. Animation recording: MP4 / ProRes with alpha channel, or in-app timeline with keyframing.
4. Cross-platform PC/Windows version using Electron / MediaPipe.
