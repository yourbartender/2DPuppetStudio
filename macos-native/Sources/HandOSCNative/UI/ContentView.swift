import SwiftUI

public struct ContentView: View {
    @StateObject private var tracker = HolisticTracker()
    @StateObject private var puppet = PuppetController()
    @State private var viewMode: AppViewMode = .split
    @State private var showFullStageCamera: Bool = true
    @State private var cleanStageFeed: Bool = false

    private let portFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .none
        f.minimum = 1
        f.maximum = 65535
        return f
    }()

    private let dimFormatter: NumberFormatter = {
        let f = NumberFormatter()
        f.numberStyle = .none
        f.minimum = 1
        f.maximum = 16384
        return f
    }()

    public init() {}

    public var body: some View {
        VStack(spacing: 0) {
            if !(viewMode == .fullStage && cleanStageFeed) {
                headerBar
                Divider().overlay(Color.white.opacity(0.08))
            }

            if viewMode == .fullStage {
                fullStagePreviewView
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if viewMode == .puppetStudio {
                PuppetStudioView(
                    puppet: puppet,
                    tracker: tracker,
                    onOpenFullStage: { viewMode = .fullStage }
                )
                .padding(18)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HStack(alignment: .top, spacing: 20) {
                    // Left column: Camera preview (+ Puppet Stage in Split mode) + Stats
                    VStack(alignment: .leading, spacing: 14) {
                        if viewMode == .split {
                            HStack(spacing: 14) {
                                CameraPreviewView(
                                    session: tracker.captureSession,
                                    frame: tracker.latestFrame,
                                    mirror: tracker.settings.mirror,
                                    isRunning: tracker.isRunning
                                )
                                PuppetStageView(
                                    puppet: puppet,
                                    frame: tracker.latestFrame,
                                    isCalibrated: tracker.calibrationBaseline.isCalibrated,
                                    onCalibrate: { tracker.calibrateNeutralFace() },
                                    onToggleFullStage: { viewMode = .fullStage }
                                )
                            }
                        } else {
                            CameraPreviewView(
                                session: tracker.captureSession,
                                frame: tracker.latestFrame,
                                mirror: tracker.settings.mirror,
                                isRunning: tracker.isRunning
                            )
                        }

                        // 5 Telemetry Tiles including Facial Expressions
                        HStack(spacing: 10) {
                            StatTileView(label: "FPS", value: "\(tracker.stats.fps)")
                            StatTileView(label: "MSGS/S", value: "\(tracker.stats.msgsPerSec)")
                            StatTileView(
                                label: "DETECTED",
                                value: "H:\(tracker.stats.hands) P:\(tracker.stats.poses) F:\(tracker.stats.faces)"
                            )
                            StatTileView(label: "HAND GESTURES", value: formattedGestures)
                            StatTileView(label: "FACE EXPRESSION", value: tracker.stats.expressionSummary)
                        }

                        if viewMode == .split {
                            quickPuppetCalloutBar
                        }

                        if let err = tracker.stats.lastError, !err.isEmpty {
                            HStack(spacing: 8) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .foregroundStyle(.red)
                                Text(err)
                                    .font(.caption)
                                    .foregroundStyle(.red)
                                Spacer()
                            }
                            .padding(10)
                            .background(Color.red.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color.red.opacity(0.35), lineWidth: 1)
                            )
                        }

                        Spacer(minLength: 0)
                    }
                    .frame(maxWidth: .infinity)

                    // Right column: Controls sidebar
                    ScrollView(.vertical, showsIndicators: true) {
                        VStack(spacing: 14) {
                            smoothingAndRateSection
                            faceSection
                            handsSection
                            poseSection
                            cameraSection
                            oscSection
                            mappingSection
                        }
                        .padding(.bottom, 16)
                    }
                    .frame(width: 355)
                }
                .padding(20)
            }
        }
        .background(Color(red: 0.09, green: 0.11, blue: 0.14))
        .preferredColorScheme(.dark)
        .onReceive(NotificationCenter.default.publisher(for: .saveCharacterPackageRequested)) { _ in
            puppet.exportCharacterPackage()
        }
        .onReceive(NotificationCenter.default.publisher(for: .exportRigOnlyRequested)) { _ in
            puppet.exportRigOnly()
        }
        .onReceive(NotificationCenter.default.publisher(for: .importCharacterRequested)) { _ in
            puppet.importRigFromFile()
        }
    }

    private var formattedGestures: String {
        var parts: [String] = []
        if let l = tracker.stats.gestureL { parts.append("L:\(l)") }
        if let r = tracker.stats.gestureR { parts.append("R:\(r)") }
        return parts.isEmpty ? "—" : parts.joined(separator: "  ")
    }

    private var smoothingLabelText: String {
        let pct = Int((tracker.settings.smoothing * 100).rounded())
        if pct <= 1 {
            return "Off (Instant / 0 Lag)"
        } else if pct < 25 {
            return "\(pct)% (Fast / Low Lag)"
        } else if pct < 60 {
            return "\(pct)% (Balanced)"
        } else {
            return "\(pct)% (Heavy Smooth)"
        }
    }

    private var quickPuppetCalloutBar: some View {
        HStack(spacing: 12) {
            Image(systemName: "theatermasks.fill")
                .font(.system(size: 16))
                .foregroundStyle(Color.teal)
            VStack(alignment: .leading, spacing: 2) {
                Text("2D Puppet Rigging & Custom Graphics")
                    .font(.system(size: 12.5, weight: .semibold))
                Text("Drop your own Face/Head, Body, or Hand PNGs, place control points on your image, and follow the built-in step-by-step guide.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button {
                viewMode = .puppetStudio
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "mappin.and.ellipse")
                    Text("Open 2D Puppet Studio & Guide")
                        .fontWeight(.semibold)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(Color.teal.opacity(0.22))
                .foregroundStyle(Color.teal)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(Color.teal.opacity(0.5), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
        }
        .padding(12)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private var fullStagePreviewView: some View {
        ZStack(alignment: .bottomLeading) {
            PuppetStageView(
                puppet: puppet,
                frame: tracker.latestFrame,
                isCalibrated: tracker.calibrationBaseline.isCalibrated,
                onCalibrate: { tracker.calibrateNeutralFace() },
                fillsWindow: true,
                showOverlayControls: !cleanStageFeed,
                onToggleFullStage: {
                    cleanStageFeed = false
                    viewMode = .puppetStudio
                }
            )

            // Bottom floating control & PiP camera bar
            HStack(alignment: .bottom, spacing: 14) {
                if showFullStageCamera && !cleanStageFeed {
                    VStack(alignment: .leading, spacing: 6) {
                        CameraPreviewView(
                            session: tracker.captureSession,
                            frame: tracker.latestFrame,
                            mirror: tracker.settings.mirror,
                            isRunning: tracker.isRunning
                        )
                        .frame(width: 260)
                        .shadow(color: .black.opacity(0.6), radius: 10, x: 0, y: 4)
                    }
                }

                if !cleanStageFeed {
                    HStack(spacing: 10) {
                        Button {
                            showFullStageCamera.toggle()
                        } label: {
                            Label(
                                showFullStageCamera ? "Hide Camera" : "Show Camera",
                                systemImage: showFullStageCamera ? "video.slash.fill" : "video.fill"
                            )
                            .font(.system(size: 11.5, weight: .semibold))
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.teal)
                        .controlSize(.small)

                        Picker("", selection: $puppet.stageBackground) {
                            ForEach(PuppetStageBackground.allCases) { bg in
                                Text(bg.label).tag(bg)
                            }
                        }
                        .labelsHidden()
                        .frame(width: 170)
                        .controlSize(.small)

                        Button {
                            cleanStageFeed = true
                        } label: {
                            Label("Clean Feed (Hide UI)", systemImage: "eye.slash")
                                .font(.system(size: 11.5, weight: .medium))
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .help("Hides all toolbars and camera preview for clean OBS / Syphon / NDI window capture")

                        Button {
                            viewMode = .puppetStudio
                        } label: {
                            Label("Back to Studio", systemImage: "slider.horizontal.3")
                                .font(.system(size: 11.5, weight: .medium))
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.black.opacity(0.72))
                    .clipShape(Capsule())
                    .overlay(
                        Capsule().stroke(Color.white.opacity(0.14), lineWidth: 1)
                    )
                } else {
                    // Subtle corner button to restore UI from Clean Feed mode
                    Button {
                        cleanStageFeed = false
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "eye")
                            Text("Show Controls")
                        }
                        .font(.system(size: 10.5, weight: .medium))
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(Color.black.opacity(0.38))
                        .foregroundStyle(.white.opacity(0.75))
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }

                Spacer()
            }
            .padding(16)
        }
    }

    private var headerBar: some View {
        HStack {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.25, green: 0.85, blue: 0.65),
                                    Color(red: 0.15, green: 0.60, blue: 0.90)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 36, height: 36)
                    Image(systemName: "hand.raised.fill")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(.black)
                }

                VStack(alignment: .leading, spacing: 1) {
                    Text("HandOSC Native & 2D Puppet Studio")
                        .font(.system(size: 15.5, weight: .semibold))
                    Text("Apple Vision Neural Engine → 2D Puppet & OSC")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            // Workspace Mode Switcher
            HStack(spacing: 4) {
                ForEach(AppViewMode.allCases) { mode in
                    let active = (viewMode == mode)
                    Button {
                        viewMode = mode
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: mode.icon)
                                .font(.system(size: 11))
                            Text(mode.label)
                                .font(.system(size: 11.5, weight: active ? .semibold : .medium))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(active ? Color.teal : Color.clear)
                        .foregroundStyle(active ? Color.black : Color.secondary)
                        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(3)
            .background(Color.white.opacity(0.06))
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))

            Spacer()

            HStack(spacing: 12) {
                HStack(spacing: 6) {
                    Image(systemName: "dot.radiowaves.left.and.right")
                        .font(.system(size: 11))
                    Text("OSC live (UDP)")
                        .font(.system(size: 11, weight: .medium))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(Color.teal.opacity(0.16))
                .foregroundStyle(Color.teal)
                .clipShape(Capsule())
                .overlay(Capsule().stroke(Color.teal.opacity(0.4), lineWidth: 1))

                Button {
                    tracker.isRunning.toggle()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "power")
                        Text(tracker.isRunning ? "Stop" : "Start tracking")
                            .fontWeight(.semibold)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .background(tracker.isRunning ? Color.red : Color.teal)
                    .foregroundStyle(tracker.isRunning ? Color.white : Color.black)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 11)
        .background(Color.black.opacity(0.25))
    }

    // MARK: - Sidebar Sections

    private var smoothingAndRateSection: some View {
        SectionCard(title: "Responsiveness & Send Rate", systemImage: "waveform.path.ecg") {
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    FieldLabel("MOVEMENT SMOOTHING")
                    Spacer()
                    Text(smoothingLabelText)
                        .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(tracker.settings.smoothing <= 0.01 ? Color.orange : Color.teal)
                }
                Slider(value: $tracker.settings.smoothing, in: 0.0...1.0, step: 0.01)
                    .tint(.teal)
                HStack {
                    Text("← 0%: Instant (Zero Lag)")
                        .font(.system(size: 9.5))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("100%: Max Smooth →")
                        .font(.system(size: 9.5))
                        .foregroundStyle(.secondary)
                }
            }

            Divider().overlay(Color.white.opacity(0.07))

            SliderControlRow(
                label: "OSC SEND RATE",
                value: $tracker.settings.fps,
                range: 5...120,
                step: 1,
                format: "%.0f Hz"
            )
        }
    }

    private var faceSection: some View {
        let fm = tracker.latestFrame.faceMetrics
        return SectionCard(title: "Face & Expressions", systemImage: "face.smiling") {
            ToggleRow(label: "Track face & head pose", isOn: $tracker.settings.trackFace)
            if tracker.settings.trackFace {
                // Calibration button for glasses & beard
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Button {
                            tracker.calibrateNeutralFace()
                        } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "scope")
                                Text(tracker.calibrationBaseline.isCalibrated ? "Re-Calibrate Neutral Face" : "Calibrate Neutral Face")
                                    .fontWeight(.semibold)
                            }
                            .font(.system(size: 11.5))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                            .background(Color.teal)
                            .foregroundStyle(.black)
                            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                        }
                        .buttonStyle(.plain)

                        if tracker.calibrationBaseline.isCalibrated {
                            Button("Reset") {
                                tracker.resetFaceCalibration()
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)
                        }
                    }
                    Text("Look straight ahead with a relaxed face & click Calibrate to set your personal zero baseline.")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
                .padding(8)
                .background(Color.white.opacity(0.03))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                // Live Expression Bars
                VStack(alignment: .leading, spacing: 5) {
                    ExpressionBarRow(label: "Mouth / Jaw Open", value: Double(fm.mouthOpen), color: .orange)
                    ExpressionBarRow(label: "Smile / Width", value: Double(fm.mouthSmile), color: .green)
                    ExpressionBarRow(label: "Eyebrows Raise", value: Double(fm.browRaise), color: .cyan)
                    ExpressionBarRow(label: "Left Eye Wink", value: Double(fm.eyeBlinkL), color: .yellow)
                    ExpressionBarRow(label: "Right Eye Wink", value: Double(fm.eyeBlinkR), color: .yellow)
                    ExpressionBarRow(label: "Head Tilt (Roll)", value: Double(min(1, abs(fm.roll) / 0.5)), color: .purple)
                }
                .padding(.vertical, 4)

                SliderControlRow(
                    label: "MOUTH SENSITIVITY",
                    value: $tracker.settings.mouthSensitivity,
                    range: 0.4...3.0,
                    step: 0.05,
                    format: "%.2fx"
                )
                SliderControlRow(
                    label: "EYEBROW SENSITIVITY",
                    value: $tracker.settings.browSensitivity,
                    range: 0.4...3.0,
                    step: 0.05,
                    format: "%.2fx"
                )
                SliderControlRow(
                    label: "EYE BLINK SENSITIVITY",
                    value: $tracker.settings.blinkSensitivity,
                    range: 0.4...3.0,
                    step: 0.05,
                    format: "%.2fx"
                )

                Divider().overlay(Color.white.opacity(0.07))

                VStack(alignment: .leading, spacing: 6) {
                    FieldLabel("2D PUPPET FACIAL ANIMATION")

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Eyes & Eyebrows Mode")
                            .font(.system(size: 9.5, weight: .medium))
                            .foregroundStyle(.secondary)
                        Picker("", selection: $puppet.eyeAnimationMode) {
                            ForEach(EyeAnimationMode.allCases) { mode in
                                Text(mode.label).tag(mode)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.menu)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Mouth Visemes Mode")
                            .font(.system(size: 9.5, weight: .medium))
                            .foregroundStyle(.secondary)
                        Picker("", selection: $puppet.mouthAnimationMode) {
                            ForEach(MouthAnimationMode.allCases) { mode in
                                Text(mode.label).tag(mode)
                            }
                        }
                        .labelsHidden()
                        .pickerStyle(.menu)
                    }

                    Toggle("Jaw Stretch Warp (Disable for Robot Head)", isOn: $puppet.jawWarpEnabled)
                        .font(.system(size: 10.5))
                        .toggleStyle(.checkbox)

                    Toggle("Auto-Blink When Gaze Still", isOn: $puppet.autoBlinkEnabled)
                        .font(.system(size: 10.5))
                        .toggleStyle(.checkbox)
                }

                Divider().overlay(Color.white.opacity(0.07))

                VStack(alignment: .leading, spacing: 4) {
                    FieldLabel("OSC LANDMARK COUNT")
                    Picker("", selection: $tracker.settings.faceTier) {
                        ForEach(FaceTier.allCases) { tier in
                            Text(tier.label).tag(tier)
                        }
                    }
                    .labelsHidden()
                }
                ToggleRow(
                    label: "/face/landmark/N (per-point)",
                    isOn: $tracker.settings.faceSendLandmarks
                )
                ToggleRow(
                    label: "/face bundled floats",
                    isOn: $tracker.settings.faceSendBundled
                )
                ToggleRow(
                    label: "/face/x|y|z (per axis)",
                    isOn: $tracker.settings.faceSendAxisGrouped
                )
                ToggleRow(
                    label: "/face/blendshape/* (expressions)",
                    isOn: $tracker.settings.faceSendBlendshapes
                )
            }
        }
    }

    private var handsSection: some View {
        SectionCard(title: "Hands", systemImage: "hand.raised") {
            ToggleRow(label: "Track hands", isOn: $tracker.settings.trackHands)
            if tracker.settings.trackHands {
                ToggleRow(
                    label: "/hand/L|R/landmark/0..20",
                    isOn: $tracker.settings.handsSendLandmarks
                )
                ToggleRow(
                    label: "/hand/L|R bundled floats",
                    isOn: $tracker.settings.handsSendBundled
                )
                ToggleRow(
                    label: "/hand/L|R/x|y|z (21 per axis)",
                    isOn: $tracker.settings.handsSendAxisGrouped
                )
                ToggleRow(
                    label: "/hand/L|R/gesture + /pinch",
                    isOn: $tracker.settings.handsSendGesture
                )
            }
        }
    }

    private var poseSection: some View {
        SectionCard(title: "Pose (body)", systemImage: "figure.stand") {
            ToggleRow(label: "Track pose", isOn: $tracker.settings.trackPose)
            if tracker.settings.trackPose {
                ToggleRow(
                    label: "/pose/landmark/0..32",
                    isOn: $tracker.settings.poseSendLandmarks
                )
                ToggleRow(
                    label: "/pose bundled floats",
                    isOn: $tracker.settings.poseSendBundled
                )
                ToggleRow(
                    label: "/pose/x|y|z (33 per axis)",
                    isOn: $tracker.settings.poseSendAxisGrouped
                )
            }
        }
    }

    private var cameraSection: some View {
        SectionCard(title: "Camera", systemImage: "video") {
            VStack(alignment: .leading, spacing: 4) {
                FieldLabel("DEVICE")
                Picker("", selection: $tracker.selectedCameraId) {
                    ForEach(tracker.cameras) { cam in
                        Text(cam.name).tag(cam.id)
                    }
                }
                .labelsHidden()
            }
            ToggleRow(label: "Mirror horizontally", isOn: $tracker.settings.mirror)
        }
    }

    private var oscSection: some View {
        SectionCard(title: "OSC destination", systemImage: "dot.radiowaves.left.and.right") {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    FieldLabel("HOST")
                    TextField("127.0.0.1", text: $tracker.settings.host)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))
                }
                VStack(alignment: .leading, spacing: 4) {
                    FieldLabel("PORT")
                    TextField("9000", value: $tracker.settings.port, formatter: portFormatter)
                        .textFieldStyle(.roundedBorder)
                        .font(.system(.body, design: .monospaced))
                        .frame(width: 95)
                }
            }
            ToggleRow(
                label: "Send frame as atomic #bundle",
                isOn: $tracker.settings.sendAsOscBundle
            )
        }
    }

    private var mappingSection: some View {
        SectionCard(title: "Coordinate mapping", systemImage: "viewfinder") {
            VStack(alignment: .leading, spacing: 4) {
                FieldLabel("MODE")
                Picker("", selection: $tracker.settings.mapping) {
                    ForEach(MappingMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .labelsHidden()
            }

            if tracker.settings.mapping == .centeredAspect {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 4) {
                        FieldLabel("SCREEN W")
                        TextField("1920", value: $tracker.settings.screenWidth, formatter: dimFormatter)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(.body, design: .monospaced))
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        FieldLabel("SCREEN H")
                        TextField("1080", value: $tracker.settings.screenHeight, formatter: dimFormatter)
                            .textFieldStyle(.roundedBorder)
                            .font(.system(.body, design: .monospaced))
                    }
                }
            }
        }
    }
}

// MARK: - Reusable Subviews

private struct StatTileView: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 14.5, weight: .semibold, design: .monospaced))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct SectionCard<Content: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 7) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.teal)
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct FieldLabel: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.secondary)
    }
}

private struct ToggleRow: View {
    let label: String
    @Binding var isOn: Bool

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 11.5, design: .monospaced))
                .lineLimit(1)
            Spacer()
            Toggle("", isOn: $isOn)
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.white.opacity(0.035))
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
    }
}

private struct SliderControlRow: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    let format: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                FieldLabel(label)
                Spacer()
                Text(String(format: format, value))
                    .font(.system(size: 11.5, design: .monospaced))
            }
            Slider(value: $value, in: range, step: step)
                .tint(.teal)
        }
    }
}
