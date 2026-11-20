import Foundation
import AppKit

public enum AppViewMode: String, CaseIterable, Identifiable, Sendable {
    case split = "split"
    case puppetStudio = "puppet"
    case fullStage = "fullStage"
    case trackerOnly = "tracker"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .split: return "Split: Camera + Puppet"
        case .puppetStudio: return "2D Puppet Studio"
        case .fullStage: return "Full Stage Preview"
        case .trackerOnly: return "Camera & OSC"
        }
    }

    public var icon: String {
        switch self {
        case .split: return "rectangle.split.2x1"
        case .puppetStudio: return "theatermasks.fill"
        case .fullStage: return "arrow.up.left.and.arrow.down.right"
        case .trackerOnly: return "dot.radiowaves.left.and.right"
        }
    }
}

public enum MappingMode: String, CaseIterable, Identifiable, Codable, Sendable {
    case centeredAspect = "centered_aspect"
    case normalized = "normalized"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .centeredAspect:
            return "Centered: x ∈ [-1,1], y ∈ [-1,1]"
        case .normalized:
            return "Normalized 0..1 (raw)"
        }
    }
}

public enum FaceTier: String, CaseIterable, Identifiable, Codable, Sendable {
    case off = "off"
    case essentials = "essentials"
    case curated = "curated"
    case all = "all"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .off: return "Off"
        case .essentials: return "Essentials (28)"
        case .curated: return "Curated (52)"
        case .all: return "All Vision (76)"
        }
    }
}

/// Detected mouth / speech shape (viseme) for sprite swapping & animation
public enum MouthViseme: String, CaseIterable, Identifiable, Codable, Sendable {
    case neutral = "Neutral (M/B/P)"
    case ah = "Ah (Open)"
    case oh = "Oh / Ooo (Round)"
    case smile = "Smile / Ee (Wide)"
    case wideOpen = "Wide Open (Shout)"

    public var id: String { rawValue }
}

public struct Landmark: Sendable, Codable, Equatable {
    public var x: Float
    public var y: Float
    public var z: Float

    public init(x: Float, y: Float, z: Float = 0) {
        self.x = x
        self.y = y
        self.z = z
    }

    public static let zero = Landmark(x: 0, y: 0, z: 0)
}

public struct TrackerSettings: Sendable, Codable, Equatable {
    public var host: String = "127.0.0.1"
    public var port: Int = 9000
    public var sendAsOscBundle: Bool = false
    public var fps: Double = 60
    public var mirror: Bool = true

    /// Unified simple smoothing slider: 0.0 = Off (Instant / Zero Lag), 1.0 = Max Smooth
    public var smoothing: Double = 0.15

    public var mapping: MappingMode = .centeredAspect
    public var screenWidth: Double = Double(NSScreen.main?.frame.width ?? 1920)
    public var screenHeight: Double = Double(NSScreen.main?.frame.height ?? 1080)

    // Hands
    public var trackHands: Bool = true
    public var handsSendLandmarks: Bool = true
    public var handsSendBundled: Bool = false
    public var handsSendAxisGrouped: Bool = true
    public var handsSendGesture: Bool = true

    // Pose
    public var trackPose: Bool = true
    public var poseSendLandmarks: Bool = true
    public var poseSendBundled: Bool = false
    public var poseSendAxisGrouped: Bool = true

    // Face
    public var trackFace: Bool = true
    public var faceTier: FaceTier = .curated
    public var faceSendLandmarks: Bool = false
    public var faceSendBundled: Bool = false
    public var faceSendAxisGrouped: Bool = true
    public var faceSendBlendshapes: Bool = true

    // Expression sensitivity multipliers (helpful for glasses/beard)
    public var mouthSensitivity: Double = 1.35
    public var browSensitivity: Double = 1.45
    public var blinkSensitivity: Double = 1.35

    public init() {}

    /// Derives 1€ filter (minCutoff, beta) from unified 0..1 smoothing slider.
    /// High beta ensures fast hand/head movements pass through with near-zero latency while stationary jitter is damped.
    public var oneEuroParams: (enabled: Bool, minCutoff: Double, beta: Double) {
        let clamped = max(0.0, min(1.0, smoothing))
        if clamped <= 0.01 {
            return (false, 35.0, 5.0)
        }
        let inv = 1.0 - clamped
        let minCutoff = 1.2 + 24.0 * (inv * inv)
        let beta = 1.8 + 4.2 * inv
        return (true, minCutoff, beta)
    }
}

public struct FaceCalibrationBaseline: Sendable, Codable, Equatable {
    public var centerX: Float = 0.5
    public var centerY: Float = 0.46
    public var faceWidth: Float = 0.085
    public var rollOffset: Float = 0.0
    public var yawOffset: Float = 0.0
    public var pitchOffset: Float = 0.0
    public var neutralMouthRatio: Float = 0.14
    public var neutralMouthWidth: Float = 0.88
    public var neutralBrowEyeDist: Float = 0.34
    public var neutralBrowEyeDistL: Float = 0.34
    public var neutralBrowEyeDistR: Float = 0.34
    public var neutralEyeAspect: Float = 0.25
    public var neutralEyeAspectL: Float = 0.25
    public var neutralEyeAspectR: Float = 0.25
    public var isCalibrated: Bool = false

    public init() {}
}

public struct FaceMetrics: Sendable, Equatable {
    public var present: Bool = false
    /// Screen-space head anchor (0..1 top-left, mirror-adjusted) for relative hand-to-head mapping
    public var rawAnchorX: Float = 0.50
    public var rawAnchorY: Float = 0.48
    public var rawIOD: Float = 0.085
    /// Normalized centered position (-1..1, where 0,0 is calibrated neutral position)
    public var headX: Float = 0
    public var headY: Float = 0
    /// Relative scale (1.0 = neutral distance, >1 = closer to camera)
    public var headScale: Float = 1.0
    /// Head roll (tilt) in radians
    public var roll: Float = 0
    /// Head yaw (left/right turn) in normalized range -1..1
    public var yaw: Float = 0
    /// Head pitch (up/down nod) in normalized range -1..1
    public var pitch: Float = 0

    /// Key expression values (0..1)
    public var mouthOpen: Float = 0
    public var mouthSmile: Float = 0
    public var mouthPucker: Float = 0
    public var browRaise: Float = 0
    public var browFurrow: Float = 0
    public var eyeBlinkL: Float = 0
    public var eyeBlinkR: Float = 0
    public var viseme: MouthViseme = .neutral

    public var summaryLabel: String = "—"

    public init() {}
}

public struct TrackerStats: Sendable, Equatable {
    public var fps: Int
    public var msgsPerSec: Int
    public var hands: Int
    public var poses: Int
    public var faces: Int
    public var gestureL: String?
    public var gestureR: String?
    public var expressionSummary: String
    public var lastError: String?

    public init(
        fps: Int = 0,
        msgsPerSec: Int = 0,
        hands: Int = 0,
        poses: Int = 0,
        faces: Int = 0,
        gestureL: String? = nil,
        gestureR: String? = nil,
        expressionSummary: String = "—",
        lastError: String? = nil
    ) {
        self.fps = fps
        self.msgsPerSec = msgsPerSec
        self.hands = hands
        self.poses = poses
        self.faces = faces
        self.gestureL = gestureL
        self.gestureR = gestureR
        self.expressionSummary = expressionSummary
        self.lastError = lastError
    }
}

public struct TrackedHand: Sendable {
    /// "L" or "R" in screen space (L = left side of mirrored view, R = right side of mirrored view)
    public let label: String
    /// 21 landmarks in normalized image space (x: 0..1 left-to-right, y: 0..1 top-to-bottom for drawing)
    public let rawLandmarks: [Landmark]
    /// 21 smoothed landmarks in normalized top-left space
    public let smoothedLandmarks: [Landmark]
    public let gesture: String
    public let gestureScore: Float
    public let pinch: Float
    /// Wrist angle in radians (wrist -> middle MCP)
    public let wristAngle: Float
    /// Independent thumb orientation in screen space (wrist/CMC -> thumb tip, radians)
    public let thumbAngle: Float
    /// Angle difference between thumb vector and middle-finger vector (radians)
    public let thumbSpread: Float
    /// Relative depth scale based on apparent hand size in camera (1.0 = normal distance, >1 = closer)
    public let scale: Float
    /// Palm orientation sign (+1 = palm facing camera, -1 = back of hand facing camera)
    public let palmFacingSign: Float
    /// Per-finger curl ratios [Thumb, Index, Middle, Ring, Pinky] (0.0 = extended, 1.0 = curled into fist)
    public let fingerCurls: [Float]

    public init(
        label: String,
        rawLandmarks: [Landmark],
        smoothedLandmarks: [Landmark],
        gesture: String,
        gestureScore: Float,
        pinch: Float,
        wristAngle: Float,
        thumbAngle: Float = 0,
        thumbSpread: Float = 0,
        scale: Float,
        palmFacingSign: Float,
        fingerCurls: [Float]
    ) {
        self.label = label
        self.rawLandmarks = rawLandmarks
        self.smoothedLandmarks = smoothedLandmarks
        self.gesture = gesture
        self.gestureScore = gestureScore
        self.pinch = pinch
        self.wristAngle = wristAngle
        self.thumbAngle = thumbAngle
        self.thumbSpread = thumbSpread
        self.scale = scale
        self.palmFacingSign = palmFacingSign
        self.fingerCurls = fingerCurls
    }
}

public struct TrackedFrame: Sendable {
    public var hands: [TrackedHand] = []
    /// 33 pose landmarks in top-left normalized drawing coordinates (nil entries where untracked)
    public var poseLandmarks: [Landmark?] = []
    /// Face landmarks in top-left normalized drawing coordinates
    public var faceLandmarks: [Landmark] = []
    /// Named facial landmarks in top-left image space for direct puppet mapping
    public var faceKeyPoints: [String: Landmark] = [:]
    /// Estimated facial expression blendshapes (0..1)
    public var blendshapes: [(name: String, score: Float)] = []
    /// High-level face pose & calibrated expression metrics
    public var faceMetrics: FaceMetrics = FaceMetrics()

    public init() {}
}
