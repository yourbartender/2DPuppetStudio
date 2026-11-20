import Foundation
import AVFoundation
import Vision
import CoreMedia
import Combine

public struct CameraDevice: Identifiable, Equatable, Hashable {
    public let id: String
    public let name: String
}

public final class HolisticTracker: NSObject, ObservableObject, @unchecked Sendable {
    @Published public private(set) var cameras: [CameraDevice] = []
    @Published public var selectedCameraId: String = "" {
        didSet {
            if oldValue != selectedCameraId && isRunning {
                reconfigureCamera()
            }
        }
    }
    @Published public var isRunning: Bool = false {
        didSet {
            if isRunning != oldValue {
                if isRunning {
                    startSession()
                } else {
                    stopSession()
                }
            }
        }
    }
    @Published public var settings: TrackerSettings = TrackerSettings() {
        didSet {
            settingsLock.lock()
            currentSettings = settings
            settingsLock.unlock()
            Self.saveSettingsToDisk(settings)
            let params = settings.oneEuroParams
            captureQueue.async { [weak self] in
                guard let self else { return }
                self.smoother.setParams(
                    enabled: params.enabled,
                    minCutoff: params.minCutoff,
                    beta: params.beta
                )
            }
        }
    }
    @Published public private(set) var calibrationBaseline = FaceCalibrationBaseline()
    @Published public private(set) var stats: TrackerStats = TrackerStats()
    @Published public private(set) var latestFrame: TrackedFrame = TrackedFrame()

    public let captureSession = AVCaptureSession()

    private let captureQueue = DispatchQueue(label: "com.handosc.native.capture", qos: .userInteractive)
    private let handQueue = DispatchQueue(label: "com.handosc.native.hand", qos: .userInteractive)
    private let faceQueue = DispatchQueue(label: "com.handosc.native.face", qos: .userInteractive)
    private let poseQueue = DispatchQueue(label: "com.handosc.native.pose", qos: .userInteractive)
    private let videoOutput = AVCaptureVideoDataOutput()
    private let oscClient = OSCClient()
    private let smoother = LandmarkSmoother(enabled: true, minCutoff: 16.0, beta: 3.2)

    private let settingsLock = NSLock()
    private var currentSettings = TrackerSettings()
    private var currentBaseline = FaceCalibrationBaseline()
    private var lastRawFace: GestureClassifier.RawFaceMeasurements? = nil
    private var recentRawFaces: [GestureClassifier.RawFaceMeasurements] = []
    private var isProcessing = false
    private let processLock = NSLock()

    // Anti-flicker state & anatomical reconstruction caches (used only on captureQueue)
    private var lastValidHandRaw: [String: [Landmark]] = [:]
    private var lastValidTrackedHand: [String: (hand: TrackedHand, timestamp: Double)] = [:]
    private var lastValidPoseJoints: [Int: (landmark: Landmark, timestamp: Double)] = [:]

    private lazy var handRequest: VNDetectHumanHandPoseRequest = {
        let req = VNDetectHumanHandPoseRequest()
        req.maximumHandCount = 2
        return req
    }()

    private lazy var poseRequest = VNDetectHumanBodyPoseRequest()
    private lazy var faceRequest = VNDetectFaceLandmarksRequest()

    private var lastSendTime: Double = 0
    private var lastStatsTime: Double = CACurrentMediaTime()
    private var frameCount: Int = 0
    private var msgCount: Int = 0

    // Canonical 21 hand joints in MediaPipe 0..20 index order
    private static let handJointOrder: [VNHumanHandPoseObservation.JointName] = [
        .wrist,
        .thumbCMC, .thumbMP, .thumbIP, .thumbTip,
        .indexMCP, .indexPIP, .indexDIP, .indexTip,
        .middleMCP, .middlePIP, .middleDIP, .middleTip,
        .ringMCP, .ringPIP, .ringDIP, .ringTip,
        .littleMCP, .littlePIP, .littleDIP, .littleTip
    ]

    // Parent joint index for each of the 21 hand joints (used to reject & reconstruct physically impossible outliers)
    private static let handParentIndex: [Int] = [
        0,
        0, 1, 2, 3,
        0, 5, 6, 7,
        0, 9, 10, 11,
        0, 13, 14, 15,
        0, 17, 18, 19
    ]

    private static let settingsDefaultsKey = "HandOSCNative.TrackerSettings.v2"
    private static let baselineDefaultsKey = "HandOSCNative.FaceCalibrationBaseline.v2"

    public override init() {
        super.init()
        if let savedSettings = Self.loadSettingsFromDisk() {
            self.settings = savedSettings
            self.currentSettings = savedSettings
        }
        if let savedBaseline = Self.loadBaselineFromDisk() {
            self.calibrationBaseline = savedBaseline
            self.currentBaseline = savedBaseline
        }
        let p = currentSettings.oneEuroParams
        smoother.setParams(enabled: p.enabled, minCutoff: p.minCutoff, beta: p.beta)
        refreshCameras()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onDeviceChanged),
            name: .AVCaptureDeviceWasConnected,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onDeviceChanged),
            name: .AVCaptureDeviceWasDisconnected,
            object: nil
        )
    }

    private static func saveSettingsToDisk(_ s: TrackerSettings) {
        if let data = try? JSONEncoder().encode(s) {
            UserDefaults.standard.set(data, forKey: settingsDefaultsKey)
        }
    }

    private static func loadSettingsFromDisk() -> TrackerSettings? {
        guard let data = UserDefaults.standard.data(forKey: settingsDefaultsKey),
              let decoded = try? JSONDecoder().decode(TrackerSettings.self, from: data) else { return nil }
        return decoded
    }

    private static func saveBaselineToDisk(_ b: FaceCalibrationBaseline) {
        if let data = try? JSONEncoder().encode(b) {
            UserDefaults.standard.set(data, forKey: baselineDefaultsKey)
        }
    }

    private static func loadBaselineFromDisk() -> FaceCalibrationBaseline? {
        guard let data = UserDefaults.standard.data(forKey: baselineDefaultsKey),
              let decoded = try? JSONDecoder().decode(FaceCalibrationBaseline.self, from: data) else { return nil }
        return decoded
    }

    /// Captures the user's current neutral face posture & lip/brow/eye geometry as the zero baseline,
    /// averaging across recent frames so a single-frame jitter never corrupts calibration.
    public func calibrateNeutralFace() {
        settingsLock.lock()
        let samples = recentRawFaces.isEmpty ? (lastRawFace.map { [$0] } ?? []) : recentRawFaces
        guard !samples.isEmpty else {
            settingsLock.unlock()
            return
        }
        let n = Float(samples.count)
        var b = FaceCalibrationBaseline()
        b.centerX = samples.reduce(0) { $0 + $1.anchorX } / n
        b.centerY = samples.reduce(0) { $0 + $1.anchorY } / n
        b.faceWidth = samples.reduce(0) { $0 + $1.interOcularDist } / n
        b.rollOffset = samples.reduce(0) { $0 + $1.roll } / n
        b.yawOffset = samples.reduce(0) { $0 + $1.yaw } / n
        b.pitchOffset = samples.reduce(0) { $0 + $1.pitch } / n
        b.neutralMouthRatio = samples.reduce(0) { $0 + $1.mouthOpenRatio } / n
        b.neutralMouthWidth = samples.reduce(0) { $0 + $1.mouthWidthRatio } / n
        b.neutralBrowEyeDist = samples.reduce(0) { $0 + $1.browEyeRatio } / n
        b.neutralBrowEyeDistL = samples.reduce(0) { $0 + $1.browEyeRatioL } / n
        b.neutralBrowEyeDistR = samples.reduce(0) { $0 + $1.browEyeRatioR } / n
        b.neutralEyeAspectL = samples.reduce(0) { $0 + $1.eyeAspectL } / n
        b.neutralEyeAspectR = samples.reduce(0) { $0 + $1.eyeAspectR } / n
        b.neutralEyeAspect = (b.neutralEyeAspectL + b.neutralEyeAspectR) * 0.5
        b.isCalibrated = true
        currentBaseline = b
        settingsLock.unlock()
        Self.saveBaselineToDisk(b)

        DispatchQueue.main.async {
            self.calibrationBaseline = b
        }
    }

    public func resetFaceCalibration() {
        let b = FaceCalibrationBaseline()
        settingsLock.lock()
        currentBaseline = b
        settingsLock.unlock()
        Self.saveBaselineToDisk(b)
        DispatchQueue.main.async {
            self.calibrationBaseline = b
        }
    }

    @objc private func onDeviceChanged(_ note: Notification) {
        refreshCameras()
    }

    public func refreshCameras() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let discovery = AVCaptureDevice.DiscoverySession(
                deviceTypes: [.builtInWideAngleCamera, .external, .continuityCamera],
                mediaType: .video,
                position: .unspecified
            )
            let list = discovery.devices.map { CameraDevice(id: $0.uniqueID, name: $0.localizedName) }
            DispatchQueue.main.async {
                guard let self else { return }
                self.cameras = list
                if self.selectedCameraId.isEmpty || !list.contains(where: { $0.id == self.selectedCameraId }) {
                    self.selectedCameraId = list.first?.id ?? ""
                }
            }
        }
    }

    private func startSession() {
        let camId = selectedCameraId
        captureQueue.async { [weak self] in
            guard let self else { return }
            self.smoother.reset()
            self.configureCaptureSession(deviceId: camId)
            if !self.captureSession.isRunning {
                self.captureSession.startRunning()
            }
        }
    }

    private func stopSession() {
        captureQueue.async { [weak self] in
            guard let self else { return }
            if self.captureSession.isRunning {
                self.captureSession.stopRunning()
            }
            self.smoother.reset()
            DispatchQueue.main.async {
                self.latestFrame = TrackedFrame()
                self.stats = TrackerStats()
            }
        }
    }

    private func reconfigureCamera() {
        let camId = selectedCameraId
        captureQueue.async { [weak self] in
            guard let self else { return }
            self.configureCaptureSession(deviceId: camId)
        }
    }

    private func configureCaptureSession(deviceId: String) {
        let authStatus = AVCaptureDevice.authorizationStatus(for: .video)
        if authStatus == .notDetermined {
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                if granted {
                    self?.captureQueue.async {
                        self?.configureCaptureSession(deviceId: deviceId)
                        if self?.isRunning == true && self?.captureSession.isRunning == false {
                            self?.captureSession.startRunning()
                        }
                    }
                } else {
                    DispatchQueue.main.async {
                        self?.stats.lastError = "Camera permission denied. Grant access in System Settings → Privacy & Security → Camera."
                        self?.isRunning = false
                    }
                }
            }
            return
        } else if authStatus == .denied || authStatus == .restricted {
            DispatchQueue.main.async {
                self.stats.lastError = "Camera permission denied. Grant access in System Settings → Privacy & Security → Camera."
                self.isRunning = false
            }
            return
        }

        captureSession.beginConfiguration()
        defer { captureSession.commitConfiguration() }

        if captureSession.canSetSessionPreset(.hd1280x720) {
            captureSession.sessionPreset = .hd1280x720
        }

        for input in captureSession.inputs {
            captureSession.removeInput(input)
        }

        let device: AVCaptureDevice? = {
            if !deviceId.isEmpty, let d = AVCaptureDevice(uniqueID: deviceId) {
                return d
            }
            return AVCaptureDevice.default(for: .video)
        }()

        guard let captureDevice = device else {
            DispatchQueue.main.async {
                self.stats.lastError = "No video camera found."
            }
            return
        }

        do {
            let input = try AVCaptureDeviceInput(device: captureDevice)
            if captureSession.canAddInput(input) {
                captureSession.addInput(input)
            }
        } catch {
            DispatchQueue.main.async {
                self.stats.lastError = "Camera error: \(error.localizedDescription)"
            }
            return
        }

        if !captureSession.outputs.contains(videoOutput) {
            videoOutput.alwaysDiscardsLateVideoFrames = true
            videoOutput.videoSettings = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
            ]
            videoOutput.setSampleBufferDelegate(self, queue: captureQueue)
            if captureSession.canAddOutput(videoOutput) {
                captureSession.addOutput(videoOutput)
            }
        }

        DispatchQueue.main.async {
            self.stats.lastError = nil
        }
    }
}

extension HolisticTracker: AVCaptureVideoDataOutputSampleBufferDelegate {
    public func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        processLock.lock()
        if isProcessing {
            processLock.unlock()
            return
        }
        isProcessing = true
        processLock.unlock()

        defer {
            processLock.lock()
            isProcessing = false
            processLock.unlock()
        }

        settingsLock.lock()
        let s = currentSettings
        let baseline = currentBaseline
        settingsLock.unlock()

        let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
        let nowSec = pts.isValid && !pts.seconds.isNaN ? pts.seconds : CACurrentMediaTime()
        let wallNow = CACurrentMediaTime()

        // Run Hand, Face, and Pose detections concurrently across CPU/Neural Engine cores
        let group = DispatchGroup()

        if s.trackHands {
            group.enter()
            handQueue.async { [weak self] in
                guard let self else { group.leave(); return }
                try? VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:]).perform([self.handRequest])
                group.leave()
            }
        }

        if s.trackFace {
            group.enter()
            faceQueue.async { [weak self] in
                guard let self else { group.leave(); return }
                try? VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:]).perform([self.faceRequest])
                group.leave()
            }
        }

        if s.trackPose {
            group.enter()
            poseQueue.async { [weak self] in
                guard let self else { group.leave(); return }
                try? VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .up, options: [:]).perform([self.poseRequest])
                group.leave()
            }
        }

        group.wait()

        let sendInterval = 1.0 / max(1.0, s.fps)
        let shouldSend = (wallNow - lastSendTime) >= sendInterval
        if shouldSend {
            lastSendTime = wallNow
        }

        var oscMessages: [OSCMessage] = []
        var frame = TrackedFrame()
        var presentL = false
        var presentR = false
        var gestureL: String? = nil
        var gestureR: String? = nil
        var expressionSummary = "—"

        // ── 1. HANDS (With Confidence Gate, Anatomical Bone Sanitizer & Anti-Flicker Grace Hold) ──
        let handObservations = s.trackHands ? (handRequest.results ?? []) : []

        struct CandidateHand {
            let obs: VNHumanHandPoseObservation
            let recognized: [VNHumanHandPoseObservation.JointName: VNRecognizedPoint]
            let wrist: Landmark
            let screenX: Float
        }

        var candidateHands: [CandidateHand] = []
        for obs in handObservations {
            guard let recognized = try? obs.recognizedPoints(.all),
                  let wristPt = recognized[.wrist],
                  wristPt.confidence >= 0.24,
                  wristPt.location.x > 0.008, wristPt.location.x < 0.992,
                  wristPt.location.y > 0.005, wristPt.location.y < 0.995 else { continue }

            let wx = Float(wristPt.location.x)
            let wy = Float(1.0 - wristPt.location.y)

            // Require at least 11 anatomically plausible joints with solid confidence near the wrist
            var validJointCount = 0
            var confSum: Float = 0
            for jName in Self.handJointOrder {
                if let p = recognized[jName],
                   p.confidence >= 0.26,
                   p.location.x > 0.005, p.location.x < 0.995,
                   p.location.y > 0.002, p.location.y < 0.998 {
                    let jx = Float(p.location.x)
                    let jy = Float(1.0 - p.location.y)
                    let distFromWrist = hypot(jx - wx, jy - wy)
                    if distFromWrist <= 0.42 {
                        validJointCount += 1
                        confSum += Float(p.confidence)
                    }
                }
            }
            guard validJointCount >= 11 else { continue }
            let avgConf = confSum / Float(validJointCount)
            guard avgConf >= 0.34 else { continue }

            // Reject impossible floating false detections at ceiling or far outside human reach
            if let ls = lastValidPoseJoints[11]?.landmark, let rs = lastValidPoseJoints[12]?.landmark {
                let dL = hypot(wx - ls.x, wy - ls.y)
                let dR = hypot(wx - rs.x, wy - rs.y)
                let minShoulderDist = min(dL, dR)
                if minShoulderDist > 0.74 { continue }
            }

            let screenX = s.mirror ? (1.0 - wx) : wx
            candidateHands.append(
                CandidateHand(
                    obs: obs,
                    recognized: recognized,
                    wrist: Landmark(x: wx, y: wy, z: 0),
                    screenX: screenX
                )
            )
        }

        // Sort left-to-right on screen
        candidateHands.sort { $0.screenX < $1.screenX }

        for (handIdx, item) in candidateHands.enumerated() {
            let anatomicalLabel = (item.obs.chirality == .left) ? "L" : "R"
            let finalLabel: String = {
                if candidateHands.count == 2 {
                    return handIdx == 0 ? "L" : "R"
                }
                return s.mirror ? anatomicalLabel : (anatomicalLabel == "L" ? "R" : "L")
            }()
            if finalLabel == "L" { presentL = true } else { presentR = true }

            let prevRaw = lastValidHandRaw[finalLabel]
            var rawTopLeft: [Landmark] = []
            rawTopLeft.reserveCapacity(21)

            // Build all 21 joints hierarchically from wrist (0) outward so no joint can EVER jump to (0,0) or across the screen!
            for (jIdx, jointName) in Self.handJointOrder.enumerated() {
                if jIdx == 0 {
                    rawTopLeft.append(item.wrist)
                    continue
                }
                let parentIdx = Self.handParentIndex[jIdx]
                let parentPt = rawTopLeft[parentIdx]
                let isKnuckleBase = (parentIdx == 0)
                let maxBoneLen: Float = isKnuckleBase ? 0.22 : 0.13

                var acceptedPt: Landmark? = nil
                if let pt = item.recognized[jointName],
                   pt.confidence >= 0.22,
                   pt.location.x > 0.005, pt.location.x < 0.995,
                   pt.location.y > 0.002, pt.location.y < 0.998 {
                    let cand = Landmark(x: Float(pt.location.x), y: Float(1.0 - pt.location.y), z: 0)
                    let distToParent = hypot(cand.x - parentPt.x, cand.y - parentPt.y)
                    let distToWrist = hypot(cand.x - item.wrist.x, cand.y - item.wrist.y)
                    if distToParent <= maxBoneLen && distToWrist <= 0.44 {
                        acceptedPt = cand
                    }
                }

                if let valid = acceptedPt {
                    rawTopLeft.append(valid)
                } else if let prev = prevRaw, prev.count == 21 {
                    // Reconstruct missing/clipped finger joint from its parent using the last valid bone offset
                    var dx = prev[jIdx].x - prev[parentIdx].x
                    var dy = prev[jIdx].y - prev[parentIdx].y
                    let len = hypot(dx, dy)
                    if len > maxBoneLen && len > 1e-4 {
                        dx = dx / len * maxBoneLen
                        dy = dy / len * maxBoneLen
                    }
                    rawTopLeft.append(
                        Landmark(
                            x: max(0.005, min(0.995, parentPt.x + dx)),
                            y: max(0.005, min(0.995, parentPt.y + dy)),
                            z: 0
                        )
                    )
                } else if parentIdx > 0 {
                    // Extrapolate gently along parent bone direction
                    let grandParentPt = rawTopLeft[Self.handParentIndex[parentIdx]]
                    let dx = (parentPt.x - grandParentPt.x) * 0.65
                    let dy = (parentPt.y - grandParentPt.y) * 0.65
                    rawTopLeft.append(
                        Landmark(
                            x: max(0.005, min(0.995, parentPt.x + dx)),
                            y: max(0.005, min(0.995, parentPt.y + dy)),
                            z: 0
                        )
                    )
                } else {
                    rawTopLeft.append(parentPt)
                }
            }

            lastValidHandRaw[finalLabel] = rawTopLeft

            let smoothed = smoother.smooth(prefix: "H_\(finalLabel)", landmarks: rawTopLeft, timestampSec: nowSec, maxJump: 0.16)
            let mapped = smoothed.map { Self.mapCoord($0, settings: s) }

            let (gName, gScore) = GestureClassifier.classify(smoothed)
            let pinch = GestureClassifier.pinchAmount(smoothed)
            let fState = GestureClassifier.fingerState(smoothed)
            let curls = [fState.thumbCurl, fState.indexCurl, fState.middleCurl, fState.ringCurl, fState.pinkyCurl]

            // Calculate wrist angle in screen space (mirror-adjusted)
            let screenWristX = s.mirror ? (1.0 - smoothed[0].x) : smoothed[0].x
            let screenMidX = s.mirror ? (1.0 - smoothed[9].x) : smoothed[9].x
            let wristAngle = atan2(screenMidX - screenWristX, -(smoothed[9].y - smoothed[0].y))

            // Dedicated thumb direction in screen space (Landmark 1/2 base to Landmark 4 tip)
            let screenThumbBaseX = s.mirror ? (1.0 - smoothed[1].x) : smoothed[1].x
            let screenThumbTipX = s.mirror ? (1.0 - smoothed[4].x) : smoothed[4].x
            let thumbDx = screenThumbTipX - screenThumbBaseX
            let thumbDy = -(smoothed[4].y - smoothed[1].y)
            let rawThumbAngle = (hypot(thumbDx, thumbDy) > 1e-4) ? atan2(thumbDx, thumbDy) : wristAngle
            let thumbAngle = smoother.filter(key: "TA_\(finalLabel)", value: rawThumbAngle, timestampSec: nowSec, maxJump: 0.35)
            let thumbSpread = thumbAngle - wristAngle

            // Depth scale (closer to camera -> larger) and 3D palm orientation (palm vs back-of-hand)
            let rawHandScale = GestureClassifier.handDepthScale(smoothed)
            let smoothedHandScale = smoother.filter(key: "HS_\(finalLabel)", value: rawHandScale, timestampSec: nowSec, maxJump: 0.25)
            let rawPalmSign = GestureClassifier.palmFacingSign(smoothed, screenLabel: finalLabel, mirror: s.mirror)
            let smoothedPalmSign = smoother.filter(key: "HP_\(finalLabel)", value: rawPalmSign, timestampSec: nowSec, maxJump: 0.45)

            let gDisplay = gName == "None" ? "None" : String(format: "%@ %.2f", gName, gScore)
            if finalLabel == "L" { gestureL = gDisplay } else { gestureR = gDisplay }

            let trackedHand = TrackedHand(
                label: finalLabel,
                rawLandmarks: rawTopLeft,
                smoothedLandmarks: smoothed,
                gesture: gName,
                gestureScore: gScore,
                pinch: pinch,
                wristAngle: wristAngle,
                thumbAngle: thumbAngle,
                thumbSpread: thumbSpread,
                scale: smoothedHandScale,
                palmFacingSign: smoothedPalmSign,
                fingerCurls: curls
            )
            lastValidTrackedHand[finalLabel] = (trackedHand, nowSec)
            frame.hands.append(trackedHand)

            if shouldSend {
                let base = "/hand/\(finalLabel)"
                if s.handsSendLandmarks { Self.pushPerLandmark(&oscMessages, base: base, mapped: mapped) }
                if s.handsSendBundled { Self.pushBundled(&oscMessages, base: base, mapped: mapped) }
                if s.handsSendAxisGrouped { Self.pushAxisGrouped(&oscMessages, base: base, mapped: mapped) }
                if s.handsSendGesture {
                    oscMessages.append(OSCMessage(address: "\(base)/gesture", args: [.string(gName)]))
                    oscMessages.append(OSCMessage(address: "\(base)/gesture_score", args: [.float(gScore)]))
                    oscMessages.append(OSCMessage(address: "\(base)/pinch", args: [.float(pinch)]))
                    oscMessages.append(OSCMessage(address: "\(base)/fingers", floats: curls))
                }
            }
        }

        // Anti-flicker Grace Hold: if a hand drops out for 1-4 frames (<= 170ms), hold its last valid state
        // so the puppet's arm never snaps back and forth to the resting pose!
        if s.trackHands {
            for label in ["L", "R"] {
                let isPresent = (label == "L") ? presentL : presentR
                if !isPresent, let cached = lastValidTrackedHand[label], (nowSec - cached.timestamp) <= 0.17 {
                    frame.hands.append(cached.hand)
                    if label == "L" { presentL = true } else { presentR = true }
                }
            }
        }

        if shouldSend && s.trackHands {
            oscMessages.append(OSCMessage(address: "/hand/L/present", args: [.float(presentL ? 1 : 0)]))
            oscMessages.append(OSCMessage(address: "/hand/R/present", args: [.float(presentR ? 1 : 0)]))
        }

        // ── 2. POSE (33 landmarks compatible with MediaPipe Pose indices) ───
        // Suppress redundant body-pose face landmarks (indices 0..10) when dedicated Face Tracking is active!
        let poseObservations = s.trackPose ? (poseRequest.results ?? []) : []
        if let poseObs = poseObservations.first,
           let pts = try? poseObs.recognizedPoints(.all) {
            let (rawPose, validMask) = Self.extract33PoseLandmarks(
                from: pts,
                includeFacePoints: !s.trackFace,
                lastValidJoints: &lastValidPoseJoints,
                timestampSec: nowSec
            )
            let smoothedPose = smoother.smooth(prefix: "P", landmarks: rawPose, timestampSec: nowSec, maxJump: 0.14)
            let mappedPose = smoothedPose.map { Self.mapCoord($0, settings: s) }

            frame.poseLandmarks = zip(smoothedPose, validMask).map { lm, valid in valid ? lm : nil }

            if shouldSend {
                let base = "/pose"
                if s.poseSendLandmarks { Self.pushPerLandmark(&oscMessages, base: base, mapped: mappedPose) }
                if s.poseSendBundled { Self.pushBundled(&oscMessages, base: base, mapped: mappedPose) }
                if s.poseSendAxisGrouped { Self.pushAxisGrouped(&oscMessages, base: base, mapped: mappedPose) }
            }
        }
        if shouldSend && s.trackPose {
            oscMessages.append(OSCMessage(address: "/pose/present", args: [.float(poseObservations.isEmpty ? 0 : 1)]))
        }

        // ── 3. FACE ─────────────────────────────────────────────────────────
        let faceObservations = s.trackFace ? (faceRequest.results ?? []) : []
        if let faceObs = faceObservations.first,
           let landmarks2D = faceObs.landmarks {
            let bbox = faceObs.boundingBox

            // Measure skull-referenced (beard/glasses resilient) face parameters
            let rawMeas = GestureClassifier.measureFace(
                observation: faceObs,
                landmarks: landmarks2D,
                mirror: s.mirror
            )
            settingsLock.lock()
            lastRawFace = rawMeas
            recentRawFaces.append(rawMeas)
            if recentRawFaces.count > 10 {
                recentRawFaces.removeFirst()
            }
            settingsLock.unlock()

            let evaluated = GestureClassifier.evaluateFace(
                raw: rawMeas,
                baseline: baseline,
                mouthSensitivity: Float(s.mouthSensitivity),
                browSensitivity: Float(s.browSensitivity),
                blinkSensitivity: Float(s.blinkSensitivity)
            )

            // Smooth the high-level face pose & expression channels
            var fm = evaluated.metrics
            fm.headX = smoother.filter(key: "FM_x", value: fm.headX, timestampSec: nowSec, maxJump: 0.20)
            fm.headY = smoother.filter(key: "FM_y", value: fm.headY, timestampSec: nowSec, maxJump: 0.20)
            fm.headScale = smoother.filter(key: "FM_scale", value: fm.headScale, timestampSec: nowSec, maxJump: 0.18)
            fm.roll = smoother.filter(key: "FM_roll", value: fm.roll, timestampSec: nowSec, maxJump: 0.16)
            fm.yaw = smoother.filter(key: "FM_yaw", value: fm.yaw, timestampSec: nowSec, maxJump: 0.22)
            fm.pitch = smoother.filter(key: "FM_pitch", value: fm.pitch, timestampSec: nowSec, maxJump: 0.22)
            fm.mouthOpen = smoother.filter(key: "FM_mouthOpen", value: fm.mouthOpen, timestampSec: nowSec, maxJump: 0.35)
            fm.mouthSmile = smoother.filter(key: "FM_smile", value: fm.mouthSmile, timestampSec: nowSec, maxJump: 0.30)
            fm.mouthPucker = smoother.filter(key: "FM_pucker", value: fm.mouthPucker, timestampSec: nowSec, maxJump: 0.30)
            fm.browRaise = smoother.filter(key: "FM_browUp", value: fm.browRaise, timestampSec: nowSec, maxJump: 0.30)
            fm.eyeBlinkL = smoother.filter(key: "FM_blinkL", value: fm.eyeBlinkL, timestampSec: nowSec, maxJump: 0.65)
            fm.eyeBlinkR = smoother.filter(key: "FM_blinkR", value: fm.eyeBlinkR, timestampSec: nowSec, maxJump: 0.65)
            if fm.eyeBlinkL < 0.08 { fm.eyeBlinkL = 0.0 }
            if fm.eyeBlinkR < 0.08 { fm.eyeBlinkR = 0.0 }
            if fm.mouthOpen < 0.05 { fm.mouthOpen = 0.0 }

            expressionSummary = fm.summaryLabel
            frame.faceMetrics = fm
            frame.faceKeyPoints = rawMeas.keyPoints
            frame.blendshapes = evaluated.blendshapes

            if s.faceTier != .off {
                let rawFace = Self.extractFaceLandmarks(from: landmarks2D, boundingBox: bbox, tier: s.faceTier)
                let smoothedFace = smoother.smooth(prefix: "F", landmarks: rawFace, timestampSec: nowSec, maxJump: 0.14)
                let mappedFace = smoothedFace.map { Self.mapCoord($0, settings: s) }
                frame.faceLandmarks = smoothedFace

                if shouldSend {
                    let base = "/face"
                    if s.faceSendLandmarks { Self.pushPerLandmark(&oscMessages, base: base, mapped: mappedFace) }
                    if s.faceSendBundled { Self.pushBundled(&oscMessages, base: base, mapped: mappedFace) }
                    if s.faceSendAxisGrouped { Self.pushAxisGrouped(&oscMessages, base: base, mapped: mappedFace) }
                }
            }

            if shouldSend && s.faceSendBlendshapes {
                var scores: [Float] = []
                scores.reserveCapacity(evaluated.blendshapes.count)
                for item in evaluated.blendshapes {
                    scores.append(item.score)
                    oscMessages.append(OSCMessage(address: "/face/blendshape/\(item.name)", args: [.float(item.score)]))
                }
                oscMessages.append(OSCMessage(address: "/face/blendshapes", floats: scores))
            }
        }
        if shouldSend && s.trackFace {
            oscMessages.append(OSCMessage(address: "/face/present", args: [.float(faceObservations.isEmpty ? 0 : 1)]))
        }

        // ── 4. DISPATCH OSC ─────────────────────────────────────────────────
        if shouldSend && !oscMessages.isEmpty {
            msgCount += oscMessages.count
            oscClient.send(
                messages: oscMessages,
                host: s.host,
                port: s.port,
                asBundle: s.sendAsOscBundle
            )
        }

        frameCount += 1
        let elapsed = wallNow - lastStatsTime
        var updatedStats: TrackerStats? = nil
        if elapsed >= 0.5 {
            updatedStats = TrackerStats(
                fps: Int((Double(frameCount) / elapsed).rounded()),
                msgsPerSec: Int((Double(msgCount) / elapsed).rounded()),
                hands: frame.hands.count,
                poses: poseObservations.count,
                faces: faceObservations.count,
                gestureL: gestureL,
                gestureR: gestureR,
                expressionSummary: expressionSummary,
                lastError: nil
            )
            frameCount = 0
            msgCount = 0
            lastStatsTime = wallNow
        }

        let handsCount = frame.hands.count
        let posesCount = poseObservations.count
        let facesCount = faceObservations.count
        let exprSummaryCopy = expressionSummary

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.latestFrame = frame
            if let st = updatedStats {
                self.stats = st
            } else {
                self.stats.hands = handsCount
                self.stats.poses = posesCount
                self.stats.faces = facesCount
                self.stats.gestureL = gestureL
                self.stats.gestureR = gestureR
                self.stats.expressionSummary = exprSummaryCopy
            }
        }
    }

    // MARK: - Coordinate & Landmark Helpers

    private static func mapCoord(_ p: Landmark, settings s: TrackerSettings) -> Landmark {
        if s.mapping == .normalized {
            return Landmark(
                x: s.mirror ? (1.0 - p.x) : p.x,
                y: 1.0 - p.y,
                z: p.z
            )
        }
        let x = (s.mirror ? (1.0 - p.x) : p.x) * 2.0 - 1.0
        let aspect = Float(s.screenWidth / max(1.0, s.screenHeight))
        let y = -(p.y * 2.0 - 1.0)
        return Landmark(x: x, y: y, z: p.z * aspect)
    }

    private static func pushPerLandmark(_ out: inout [OSCMessage], base: String, mapped: [Landmark]) {
        for (k, pt) in mapped.enumerated() {
            out.append(OSCMessage(address: "\(base)/landmark/\(k)", floats: [pt.x, pt.y, pt.z]))
        }
    }

    private static func pushBundled(_ out: inout [OSCMessage], base: String, mapped: [Landmark]) {
        var flat: [Float] = []
        flat.reserveCapacity(mapped.count * 3)
        for pt in mapped {
            flat.append(pt.x)
            flat.append(pt.y)
            flat.append(pt.z)
        }
        out.append(OSCMessage(address: base, floats: flat))
    }

    private static func pushAxisGrouped(_ out: inout [OSCMessage], base: String, mapped: [Landmark]) {
        var xs: [Float] = []
        var ys: [Float] = []
        var zs: [Float] = []
        xs.reserveCapacity(mapped.count)
        ys.reserveCapacity(mapped.count)
        zs.reserveCapacity(mapped.count)
        for pt in mapped {
            xs.append(pt.x)
            ys.append(pt.y)
            zs.append(pt.z)
        }
        out.append(OSCMessage(address: "\(base)/x", floats: xs))
        out.append(OSCMessage(address: "\(base)/y", floats: ys))
        out.append(OSCMessage(address: "\(base)/z", floats: zs))
    }

    private static func extract33PoseLandmarks(
        from pts: [VNHumanBodyPoseObservation.JointName: VNRecognizedPoint],
        includeFacePoints: Bool,
        lastValidJoints: inout [Int: (landmark: Landmark, timestamp: Double)],
        timestampSec: Double
    ) -> ([Landmark], [Bool]) {
        func get(_ name: VNHumanBodyPoseObservation.JointName, minConf: Float = 0.40) -> Landmark? {
            guard let p = pts[name],
                  p.confidence >= minConf,
                  p.location.x > 0.02, p.location.x < 0.98,
                  p.location.y > 0.03, p.location.y < 0.97 else { return nil }
            return Landmark(x: Float(p.location.x), y: Float(1.0 - p.location.y), z: 0)
        }

        func validBone(_ a: Landmark?, _ b: Landmark?, minLen: Float = 0.04, maxLen: Float = 0.44) -> Landmark? {
            guard let parent = a, let child = b else { return nil }
            let d = hypot(child.x - parent.x, child.y - parent.y)
            guard d >= minLen && d <= maxLen else { return nil }
            return child
        }

        let nose = includeFacePoints ? get(.nose) : nil
        let lEye = includeFacePoints ? get(.leftEye) : nil
        let rEye = includeFacePoints ? get(.rightEye) : nil
        let lEar = includeFacePoints ? get(.leftEar) : nil
        let rEar = includeFacePoints ? get(.rightEar) : nil

        let lShoulder = get(.leftShoulder, minConf: 0.38)
        let rShoulder = get(.rightShoulder, minConf: 0.38)
        let lElbow = validBone(lShoulder, get(.leftElbow, minConf: 0.40), minLen: 0.04, maxLen: 0.42)
        let rElbow = validBone(rShoulder, get(.rightElbow, minConf: 0.40), minLen: 0.04, maxLen: 0.42)
        let lWrist = validBone(lElbow, get(.leftWrist, minConf: 0.40), minLen: 0.03, maxLen: 0.42)
        let rWrist = validBone(rElbow, get(.rightWrist, minConf: 0.40), minLen: 0.03, maxLen: 0.42)

        let lHip = get(.leftHip, minConf: 0.40)
        let rHip = get(.rightHip, minConf: 0.40)
        let lKnee = validBone(lHip, get(.leftKnee, minConf: 0.40), minLen: 0.05, maxLen: 0.48)
        let rKnee = validBone(rHip, get(.rightKnee, minConf: 0.40), minLen: 0.05, maxLen: 0.48)
        let lAnkle = validBone(lKnee, get(.leftAnkle, minConf: 0.40), minLen: 0.05, maxLen: 0.48)
        let rAnkle = validBone(rKnee, get(.rightAnkle, minConf: 0.40), minLen: 0.05, maxLen: 0.48)

        var rawSlots: [Landmark?] = [
            nose, lEye, lEye, lEye, rEye, rEye, rEye,
            lEar, rEar, nose, nose,
            lShoulder, rShoulder, lElbow, rElbow, lWrist, rWrist,
            lWrist, rWrist, lWrist, rWrist, lWrist, rWrist,
            lHip, rHip, lKnee, rKnee, lAnkle, rAnkle,
            lAnkle, rAnkle, lAnkle, rAnkle
        ]

        // Apply 170ms anti-flicker grace hold on body joints (11..32)
        for idx in 11..<rawSlots.count {
            if let valid = rawSlots[idx] {
                lastValidJoints[idx] = (valid, timestampSec)
            } else if let cached = lastValidJoints[idx], (timestampSec - cached.timestamp) <= 0.17 {
                rawSlots[idx] = cached.landmark
            }
        }

        let landmarks = rawSlots.map { $0 ?? Landmark(x: 0.5, y: 0.5, z: 0) }
        let mask = rawSlots.map { $0 != nil }
        return (landmarks, mask)
    }

    private static func extractFaceLandmarks(
        from face: VNFaceLandmarks2D,
        boundingBox bbox: CGRect,
        tier: FaceTier
    ) -> [Landmark] {
        func toImageLandmark(_ pt: CGPoint) -> Landmark {
            let imgX = bbox.origin.x + pt.x * bbox.size.width
            let imgY = bbox.origin.y + pt.y * bbox.size.height
            return Landmark(x: Float(imgX), y: Float(1.0 - imgY), z: 0)
        }

        func appendRegion(_ region: VNFaceLandmarkRegion2D?, stride step: Int = 1, into out: inout [Landmark]) {
            guard let r = region, r.pointCount > 0 else { return }
            let pts = r.normalizedPoints
            var i = 0
            while i < pts.count {
                out.append(toImageLandmark(pts[i]))
                i += max(1, step)
            }
        }

        var result: [Landmark] = []
        switch tier {
        case .off:
            break
        case .essentials:
            appendRegion(face.faceContour, stride: 3, into: &result)
            appendRegion(face.leftEye, stride: 2, into: &result)
            appendRegion(face.rightEye, stride: 2, into: &result)
            appendRegion(face.leftEyebrow, stride: 2, into: &result)
            appendRegion(face.rightEyebrow, stride: 2, into: &result)
            appendRegion(face.nose, stride: 3, into: &result)
            appendRegion(face.outerLips, stride: 2, into: &result)
            appendRegion(face.leftPupil, stride: 1, into: &result)
            appendRegion(face.rightPupil, stride: 1, into: &result)
        case .curated:
            appendRegion(face.faceContour, stride: 2, into: &result)
            appendRegion(face.leftEye, stride: 1, into: &result)
            appendRegion(face.rightEye, stride: 1, into: &result)
            appendRegion(face.leftEyebrow, stride: 1, into: &result)
            appendRegion(face.rightEyebrow, stride: 1, into: &result)
            appendRegion(face.nose, stride: 2, into: &result)
            appendRegion(face.outerLips, stride: 1, into: &result)
            appendRegion(face.innerLips, stride: 2, into: &result)
            appendRegion(face.leftPupil, stride: 1, into: &result)
            appendRegion(face.rightPupil, stride: 1, into: &result)
        case .all:
            if let all = face.allPoints {
                appendRegion(all, stride: 1, into: &result)
            }
        }
        return result
    }
}
