import Foundation
import AppKit
import SwiftUI

public enum PuppetCharacterPreset: String, CaseIterable, Identifiable, Codable, Sendable {
    case auroraFox = "aurora_fox"
    case humanCharacter = "human"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .auroraFox, .humanCharacter: return "Standard Character"
        }
    }
}

public enum PuppetPartCategory: String, CaseIterable, Identifiable, Sendable {
    case headAndExpressions = "Head, Eyes, Nose & Mouth"
    case upperBodyAndArms = "Torso, Shoulders & Arms"
    case lowerBodyAndLegs = "Pelvis, Tail & Legs"

    public var id: String { rawValue }

    public var icon: String {
        switch self {
        case .headAndExpressions: return "face.smiling"
        case .upperBodyAndArms: return "figure.arms.open"
        case .lowerBodyAndLegs: return "figure.walk"
        }
    }

    public var shortLabel: String {
        switch self {
        case .headAndExpressions: return "Head & Face"
        case .upperBodyAndArms: return "Torso & Arms"
        case .lowerBodyAndLegs: return "Legs & Tail"
        }
    }
}

public enum EyeAnimationMode: String, CaseIterable, Identifiable, Codable, Sendable {
    case hybridSpriteAndTween = "hybrid"
    case spriteSwapOnly = "sprite"
    case autoSquashSingleImage = "squash"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .hybridSpriteAndTween:
            return "Hybrid: Swap Open/Closed Sprites + Squash Tween"
        case .spriteSwapOnly:
            return "Sprite Swap Only (Open ↔ Closed PNGs)"
        case .autoSquashSingleImage:
            return "Single Head Image Only (Auto-Squash Blink)"
        }
    }
}

public enum MouthAnimationMode: String, CaseIterable, Identifiable, Codable, Sendable {
    case hybridVisemesAndWarp = "hybrid"
    case visemeSpritesOnly = "sprites"
    case singleImageJawWarp = "warp"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .hybridVisemesAndWarp:
            return "Hybrid: Viseme Sprites (Ah/Oh/Ee/M) + Jaw Warp & Tween"
        case .visemeSpritesOnly:
            return "Viseme Sprite Swap Only (Cut-Out Mouth PNGs)"
        case .singleImageJawWarp:
            return "Single Head Image Only (Auto Jaw Stretch — 1 PNG)"
        }
    }
}

public enum PuppetPartSlot: String, CaseIterable, Identifiable, Codable, Sendable {
    // 1. Head, Eyes, Nose & Mouth Visemes
    case head = "head"
    case eyesOpen = "eyesOpen"
    case rightEyeOpen = "rightEyeOpen"
    case eyesClosed = "eyesClosed"
    case rightEyeClosed = "rightEyeClosed"
    case noseOverlay = "noseOverlay"
    case browsOverlay = "browsOverlay"
    case rightBrows = "rightBrows"
    case mouthNeutral = "mouthNeutral"
    case mouthAh = "mouthAh"
    case mouthOh = "mouthOh"
    case mouthSmile = "mouthSmile"

    // 2. Upper Body, Shoulders & Arms
    case torso = "torso"
    case leftUpperArm = "leftUpperArm"
    case leftForearm = "leftForearm"
    case leftHand = "leftHand"
    case rightUpperArm = "rightUpperArm"
    case rightForearm = "rightForearm"
    case rightHand = "rightHand"

    // 3. Pelvis, Tail & Legs
    case pelvis = "pelvis"
    case tail = "tail"
    case leftThigh = "leftThigh"
    case leftShin = "leftShin"
    case leftFoot = "leftFoot"
    case rightThigh = "rightThigh"
    case rightShin = "rightShin"
    case rightFoot = "rightFoot"

    public var id: String { rawValue }

    public var category: PuppetPartCategory {
        switch self {
        case .head, .eyesOpen, .rightEyeOpen, .eyesClosed, .rightEyeClosed, .noseOverlay, .browsOverlay, .rightBrows, .mouthNeutral, .mouthAh, .mouthOh, .mouthSmile:
            return .headAndExpressions
        case .torso, .leftUpperArm, .leftForearm, .leftHand, .rightUpperArm, .rightForearm, .rightHand:
            return .upperBodyAndArms
        case .pelvis, .tail, .leftThigh, .leftShin, .leftFoot, .rightThigh, .rightShin, .rightFoot:
            return .lowerBodyAndLegs
        }
    }

    public var title: String {
        switch self {
        case .head: return "Head"
        case .eyesOpen: return "L Eye (Open)"
        case .rightEyeOpen: return "R Eye (Open)"
        case .eyesClosed: return "L Eye (Closed)"
        case .rightEyeClosed: return "R Eye (Closed)"
        case .noseOverlay: return "Nose"
        case .browsOverlay: return "L Eyebrow"
        case .rightBrows: return "R Eyebrow"
        case .mouthNeutral: return "Mouth (Neutral)"
        case .mouthAh: return "Mouth (Ah)"
        case .mouthOh: return "Mouth (Oh)"
        case .mouthSmile: return "Mouth (Smile)"
        case .torso: return "Torso"
        case .leftUpperArm: return "L Upper Arm"
        case .leftForearm: return "L Forearm"
        case .leftHand: return "L Hand"
        case .rightUpperArm: return "R Upper Arm"
        case .rightForearm: return "R Forearm"
        case .rightHand: return "R Hand"
        case .pelvis: return "Pelvis"
        case .tail: return "Tail"
        case .leftThigh: return "L Thigh"
        case .leftShin: return "L Shin"
        case .leftFoot: return "L Foot"
        case .rightThigh: return "R Thigh"
        case .rightShin: return "R Shin"
        case .rightFoot: return "R Foot"
        }
    }

    public var subtitle: String {
        switch self {
        case .head: return "Main head graphic — tilts, turns in 2.5D & stretches lower jaw"
        case .eyesOpen: return "Left open eye sprite (placed at Left Eye pin; mirrors to Right Eye if R Eye is empty)"
        case .rightEyeOpen: return "Right open eye sprite (placed at Right Eye pin; if empty, uses mirrored Left Eye)"
        case .eyesClosed: return "Left blink/wink sprite (replaces Left Eye when blinking or winking)"
        case .rightEyeClosed: return "Right blink/wink sprite (replaces Right Eye when blinking or winking)"
        case .noseOverlay: return "Attaches to Head Nose Pin with 2.5D depth parallax"
        case .browsOverlay: return "Left eyebrow graphic moving up/down with brow raises"
        case .rightBrows: return "Right eyebrow graphic moving up/down with brow raises"
        case .mouthNeutral: return "Displayed at Mouth pin when lips are resting"
        case .mouthAh: return "Swapped in when speaking open vowels (Ah / Open)"
        case .mouthOh: return "Swapped in when lips are rounded (Oh / Ooo)"
        case .mouthSmile: return "Swapped in when smiling or wide vowels (Ee / Smile)"
        case .torso: return "Neck & torso — Head attaches to Neck Mount; Arms attach to Shoulders"
        case .leftUpperArm: return "Connects Left Shoulder to Elbow"
        case .leftForearm: return "Connects Left Elbow to Wrist"
        case .leftHand: return "Follows tracked Left Hand position & wrist rotation"
        case .rightUpperArm: return "Connects Right Shoulder to Elbow"
        case .rightForearm: return "Connects Right Elbow to Wrist"
        case .rightHand: return "Follows tracked Right Hand position & wrist rotation"
        case .pelvis: return "Attaches under Torso Waist Pivot; Legs attach to Hips"
        case .tail: return "Attaches behind lower torso/waist and sways with movement"
        case .leftThigh: return "Connects Left Hip to Knee"
        case .leftShin: return "Connects Left Knee to Ankle"
        case .leftFoot: return "Attaches to Left Ankle and rests naturally on ground"
        case .rightThigh: return "Connects Right Hip to Knee"
        case .rightShin: return "Connects Right Knee to Ankle"
        case .rightFoot: return "Attaches to Right Ankle and rests naturally on ground"
        }
    }

    public var systemIcon: String {
        switch self {
        case .head: return "face.smiling"
        case .eyesOpen, .rightEyeOpen: return "eye"
        case .eyesClosed, .rightEyeClosed: return "eye.slash"
        case .noseOverlay: return "nose"
        case .browsOverlay, .rightBrows: return "eyebrow"
        case .mouthNeutral, .mouthAh, .mouthOh, .mouthSmile: return "mouth"
        case .torso: return "person.bust"
        case .leftUpperArm, .leftForearm, .rightUpperArm, .rightForearm: return "figure.arms.open"
        case .leftHand: return "hand.raised.fill"
        case .rightHand: return "hand.raised"
        case .pelvis: return "figure.stand"
        case .tail: return "wind"
        case .leftThigh, .leftShin, .rightThigh, .rightShin, .leftFoot, .rightFoot: return "figure.walk"
        }
    }
}

public struct PuppetControlPin: Identifiable, Codable, Equatable, Sendable {
    public let id: String
    public var name: String
    public var trackedSourceLabel: String
    /// Normalized 0..1 coordinates on the part's image (top-left origin)
    public var x: CGFloat
    public var y: CGFloat

    public init(id: String, name: String, trackedSourceLabel: String, x: CGFloat, y: CGFloat) {
        self.id = id
        self.name = name
        self.trackedSourceLabel = trackedSourceLabel
        self.x = x
        self.y = y
    }

    public var point: CGPoint {
        get { CGPoint(x: x, y: y) }
        set {
            x = max(0.02, min(0.98, newValue.x))
            y = max(0.02, min(0.98, newValue.y))
        }
    }
}

public enum PuppetStageBackground: String, CaseIterable, Identifiable, Codable, Sendable {
    case darkStage = "dark"
    case solidWhite = "white"
    case chromaGreen = "green"
    case chromaBlue = "blue"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .darkStage: return "Dark Studio"
        case .solidWhite: return "Solid White"
        case .chromaGreen: return "Chroma Green"
        case .chromaBlue: return "Chroma Blue"
        }
    }

    public var color: Color {
        switch self {
        case .darkStage: return Color(red: 0.08, green: 0.09, blue: 0.12)
        case .solidWhite: return Color.white
        case .chromaGreen: return Color(red: 0.0, green: 0.85, blue: 0.15)
        case .chromaBlue: return Color(red: 0.0, green: 0.25, blue: 0.90)
        }
    }
}

public enum PuppetLayerOrder: Int, CaseIterable, Identifiable, Comparable, Codable, Sendable {
    case behindBody = 0
    case inFrontOfBody = 1
    case inFrontOfHead = 2

    public var id: Int { rawValue }

    public var label: String {
        switch self {
        case .behindBody: return "Behind Body (Back)"
        case .inFrontOfBody: return "In Front of Body"
        case .inFrontOfHead: return "In Front of Head (Top)"
        }
    }

    public var shortLabel: String {
        switch self {
        case .behindBody: return "Behind Body"
        case .inFrontOfBody: return "Front of Body"
        case .inFrontOfHead: return "Front of Head"
        }
    }

    public static func < (lhs: PuppetLayerOrder, rhs: PuppetLayerOrder) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

public struct PuppetPersistedRigState: Codable {
    public var preset: PuppetCharacterPreset
    public var pinsBySlot: [String: [PuppetControlPin]]
    public var partEnabled: [String: Bool]
    public var partLayerOrder: [String: Int]
    public var customImagePaths: [String: String]
    public var partFileNames: [String: String]

    public var eyeAnimationMode: EyeAnimationMode
    public var mouthAnimationMode: MouthAnimationMode
    public var blinkThreshold: Double
    public var autoBlinkEnabled: Bool

    public var headMoveAmount: Double
    public var headTiltAmount: Double
    public var headTurnParallax: Double
    public var bodyTurnAmount: Double
    public var headScaleAmount: Double
    public var jawWarpAmount: Double
    public var browWarpAmount: Double
    public var eyeSpriteScale: Double
    public var noseSpriteScale: Double
    public var mouthSpriteScale: Double
    public var characterScale: Double
    public var handScale: Double
    public var armLengthScale: Double
    public var armThicknessScale: Double
    public var legLengthScale: Double
    public var legThicknessScale: Double
    public var showFullBodyLegs: Bool
    public var stageBackground: PuppetStageBackground

    // Individual per-part adjustments
    public var partWidthScale: [String: Double]?
    public var partHeightScale: [String: Double]?
    public var partRotationOffset: [String: Double]?
    public var partFlipH: [String: Bool]?
    public var partFlipV: [String: Bool]?
    public var partOffsetX: [String: Double]?
    public var partOffsetY: [String: Double]?
    /// Ordered Front-to-Back list of stage body-part slots (index 0 = Frontmost)
    public var layerStack: [String]?

    // Embedded character sprites (base64 PNG) for self-contained packages
    public var embeddedImagesBase64: [String: String]?
    public var puppetStageOffsetX: Double?
    public var puppetStageOffsetY: Double?
    public var idleMotionAmount: Double?
    public var characterName: String?
    public var humanAnatomyConstraints: Double?
    public var dynamicPalmFlip: Bool?
    public var jawWarpEnabled: Bool?
    public var followChildrenOnMove: Bool?
    public var followChildrenOnRotate: Bool?
}

private struct PuppetUndoSnapshot {
    let preset: PuppetCharacterPreset
    let characterName: String
    let pinsBySlot: [PuppetPartSlot: [PuppetControlPin]]
    let partImages: [PuppetPartSlot: NSImage]
    let partFileNames: [PuppetPartSlot: String]
    let partEnabled: [PuppetPartSlot: Bool]
    let partLayerOrder: [PuppetPartSlot: PuppetLayerOrder]
    let layerStack: [PuppetPartSlot]
    let partWidthScale: [PuppetPartSlot: Double]
    let partHeightScale: [PuppetPartSlot: Double]
    let partRotationOffset: [PuppetPartSlot: Double]
    let partFlipH: [PuppetPartSlot: Bool]
    let partFlipV: [PuppetPartSlot: Bool]
    let partOffsetX: [PuppetPartSlot: Double]
    let partOffsetY: [PuppetPartSlot: Double]
    let puppetStageOffset: CGSize
    let idleMotionAmount: Double
}

public final class PuppetController: ObservableObject {
    @Published public var activePreset: PuppetCharacterPreset = .humanCharacter
    @Published public var characterName: String = "Character" { didSet { autoSaveIfNeeded() } }
    @Published public var idleMotionAmount: Double = 0.5 { didSet { autoSaveIfNeeded() } }
    @Published public var humanAnatomyConstraints: Double = 0.85 { didSet { autoSaveIfNeeded() } }
    @Published public var dynamicPalmFlip: Bool = false { didSet { autoSaveIfNeeded() } }
    @Published public var jawWarpEnabled: Bool = true { didSet { autoSaveIfNeeded() } }
    @Published public var followChildrenOnMove: Bool = true { didSet { autoSaveIfNeeded() } }
    @Published public var followChildrenOnRotate: Bool = true { didSet { autoSaveIfNeeded() } }
    @Published public var selectedCategory: PuppetPartCategory = .headAndExpressions
    @Published public var selectedSlot: PuppetPartSlot = .head
    @Published public var selectedPinId: String? = nil
    @Published public var showStageTransformBox: Bool = true
    @Published public var showSheetImporter: Bool = false
    @Published public var partImages: [PuppetPartSlot: NSImage] = [:]
    @Published public var partFileNames: [PuppetPartSlot: String] = [:]
    @Published public var partEnabled: [PuppetPartSlot: Bool] = [:]
    @Published public var partLayerOrder: [PuppetPartSlot: PuppetLayerOrder] = [:]
    /// Ordered Front-to-Back list of all stage drawable slots (index 0 = Frontmost, rendered last)
    @Published public var layerStack: [PuppetPartSlot] = PuppetController.defaultLayerStack(for: .humanCharacter)

    // Individual per-part scaling, rotation, flipping & stage position nudge
    @Published public var partWidthScale: [PuppetPartSlot: Double] = [:]
    @Published public var partHeightScale: [PuppetPartSlot: Double] = [:]
    @Published public var partRotationOffset: [PuppetPartSlot: Double] = [:]
    @Published public var partFlipH: [PuppetPartSlot: Bool] = [:]
    @Published public var partFlipV: [PuppetPartSlot: Bool] = [:]
    @Published public var partOffsetX: [PuppetPartSlot: Double] = [:]
    @Published public var partOffsetY: [PuppetPartSlot: Double] = [:]

    // Puppet stage position offset
    @Published public var stagePuppetOffset: CGSize = .zero

    private var customImagePaths: [PuppetPartSlot: String] = [:]
    private var isRestoringState: Bool = false

    /// Control pins per part slot
    @Published public var pinsBySlot: [PuppetPartSlot: [PuppetControlPin]] = [:]

    // Undo / Redo Stacks
    private var undoStack: [PuppetUndoSnapshot] = []
    private var redoStack: [PuppetUndoSnapshot] = []
    @Published public private(set) var canUndo: Bool = false
    @Published public private(set) var canRedo: Bool = false
    @Published public private(set) var lastSavedStatus: String = "Auto-Saved"

    // Animation Modes (Single-Image Auto-Deform vs Multi-Sprite Replacement vs Hybrid)
    @Published public var eyeAnimationMode: EyeAnimationMode = .hybridSpriteAndTween { didSet { autoSaveIfNeeded() } }
    @Published public var mouthAnimationMode: MouthAnimationMode = .hybridVisemesAndWarp { didSet { autoSaveIfNeeded() } }
    @Published public var blinkThreshold: Double = 0.42 { didSet { autoSaveIfNeeded() } }
    @Published public var autoBlinkEnabled: Bool = true { didSet { autoSaveIfNeeded() } }

    // Live motion mapping amounts
    @Published public var headMoveAmount: Double = 1.0 { didSet { autoSaveIfNeeded() } }
    @Published public var headTiltAmount: Double = 1.0 { didSet { autoSaveIfNeeded() } }
    @Published public var headTurnParallax: Double = 1.0 { didSet { autoSaveIfNeeded() } }
    @Published public var bodyTurnAmount: Double = 0.85 { didSet { autoSaveIfNeeded() } }
    @Published public var headScaleAmount: Double = 0.45 { didSet { autoSaveIfNeeded() } }
    @Published public var jawWarpAmount: Double = 1.0 { didSet { autoSaveIfNeeded() } }
    @Published public var browWarpAmount: Double = 1.0 { didSet { autoSaveIfNeeded() } }
    @Published public var eyeSpriteScale: Double = 1.0 { didSet { autoSaveIfNeeded() } }
    @Published public var noseSpriteScale: Double = 1.0 { didSet { autoSaveIfNeeded() } }
    @Published public var mouthSpriteScale: Double = 1.0 { didSet { autoSaveIfNeeded() } }
    @Published public var characterScale: Double = 0.34 { didSet { autoSaveIfNeeded() } }
    @Published public var handScale: Double = 0.16 { didSet { autoSaveIfNeeded() } }
    @Published public var armLengthScale: Double = 1.0 { didSet { autoSaveIfNeeded() } }
    @Published public var armThicknessScale: Double = 1.0 { didSet { autoSaveIfNeeded() } }
    @Published public var legLengthScale: Double = 1.0 { didSet { autoSaveIfNeeded() } }
    @Published public var legThicknessScale: Double = 1.0 { didSet { autoSaveIfNeeded() } }
    @Published public var showFullBodyLegs: Bool = true { didSet { autoSaveIfNeeded() } }
    @Published public var showPinsOnStage: Bool = false
    @Published public var showGuideBanner: Bool = false
    @Published public var stageBackground: PuppetStageBackground = .darkStage { didSet { autoSaveIfNeeded() } }

    private static let activePresetDefaultsKey = "HandOSCNative.ActivePuppetPreset.v2"

    public init() {
        let initialPreset: PuppetCharacterPreset = {
            if let raw = UserDefaults.standard.string(forKey: Self.activePresetDefaultsKey),
               let p = PuppetCharacterPreset(rawValue: raw) {
                if p == .auroraFox && !FileManager.default.fileExists(atPath: Self.rigFileURL(for: .auroraFox).path) {
                    return .humanCharacter
                }
                return p
            }
            return .humanCharacter
        }()
        loadPreset(initialPreset, recordUndo: false)
        if !FileManager.default.fileExists(atPath: Self.rigFileURL(for: activePreset).path) {
            saveNow()
        }
    }

    // MARK: - Automatic Rig & Pin Persistence + File Export/Import

    private static func appSupportDirectory() -> URL {
        let fm = FileManager.default
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        let dir = base.appendingPathComponent("HandOSCNative", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    private static func rigFileURL(for preset: PuppetCharacterPreset) -> URL {
        appSupportDirectory().appendingPathComponent("rig_\(preset.rawValue).puppet.json")
    }

    private static func customAssetDirectory(for preset: PuppetCharacterPreset) -> URL {
        let dir = appSupportDirectory()
            .appendingPathComponent("CustomAssets", isDirectory: true)
            .appendingPathComponent(preset.rawValue, isDirectory: true)
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    private func autoSaveIfNeeded() {
        guard !isRestoringState else { return }
        saveCurrentPresetState()
    }

    public func buildPersistedState(includeImages: Bool = true) -> PuppetPersistedRigState {
        var pinsMap: [String: [PuppetControlPin]] = [:]
        for (slot, pins) in pinsBySlot {
            pinsMap[slot.rawValue] = pins
        }
        var enabledMap: [String: Bool] = [:]
        for (slot, flag) in partEnabled {
            enabledMap[slot.rawValue] = flag
        }
        var orderMap: [String: Int] = [:]
        for (slot, order) in partLayerOrder {
            orderMap[slot.rawValue] = order.rawValue
        }
        var customPaths: [String: String] = [:]
        for (slot, path) in customImagePaths {
            customPaths[slot.rawValue] = path
        }
        var fileNamesMap: [String: String] = [:]
        for (slot, name) in partFileNames {
            fileNamesMap[slot.rawValue] = name
        }

        var widthMap: [String: Double] = [:]
        for (slot, w) in partWidthScale {
            widthMap[slot.rawValue] = w
        }
        var heightMap: [String: Double] = [:]
        for (slot, h) in partHeightScale {
            heightMap[slot.rawValue] = h
        }
        var rotMap: [String: Double] = [:]
        for (slot, r) in partRotationOffset {
            rotMap[slot.rawValue] = r
        }
        var flipHMap: [String: Bool] = [:]
        for (slot, f) in partFlipH {
            flipHMap[slot.rawValue] = f
        }
        var flipVMap: [String: Bool] = [:]
        for (slot, f) in partFlipV {
            flipVMap[slot.rawValue] = f
        }
        var offsetXMap: [String: Double] = [:]
        for (slot, ox) in partOffsetX {
            offsetXMap[slot.rawValue] = ox
        }
        var offsetYMap: [String: Double] = [:]
        for (slot, oy) in partOffsetY {
            offsetYMap[slot.rawValue] = oy
        }
        let serializedLayerStack = normalizedLayerStack(layerStack, preset: activePreset).map(\.rawValue)

        var embeddedImgs: [String: String]? = nil
        if includeImages {
            var b64Map: [String: String] = [:]
            for (slot, img) in partImages {
                if let tiff = img.tiffRepresentation,
                   let rep = NSBitmapImageRep(data: tiff),
                   let png = rep.representation(using: .png, properties: [:]) {
                    b64Map[slot.rawValue] = png.base64EncodedString()
                }
            }
            if !b64Map.isEmpty {
                embeddedImgs = b64Map
            }
        }

        return PuppetPersistedRigState(
            preset: activePreset,
            pinsBySlot: pinsMap,
            partEnabled: enabledMap,
            partLayerOrder: orderMap,
            customImagePaths: customPaths,
            partFileNames: fileNamesMap,
            eyeAnimationMode: eyeAnimationMode,
            mouthAnimationMode: mouthAnimationMode,
            blinkThreshold: blinkThreshold,
            autoBlinkEnabled: autoBlinkEnabled,
            headMoveAmount: headMoveAmount,
            headTiltAmount: headTiltAmount,
            headTurnParallax: headTurnParallax,
            bodyTurnAmount: bodyTurnAmount,
            headScaleAmount: headScaleAmount,
            jawWarpAmount: jawWarpAmount,
            browWarpAmount: browWarpAmount,
            eyeSpriteScale: eyeSpriteScale,
            noseSpriteScale: noseSpriteScale,
            mouthSpriteScale: mouthSpriteScale,
            characterScale: characterScale,
            handScale: handScale,
            armLengthScale: armLengthScale,
            armThicknessScale: armThicknessScale,
            legLengthScale: legLengthScale,
            legThicknessScale: legThicknessScale,
            showFullBodyLegs: showFullBodyLegs,
            stageBackground: stageBackground,
            partWidthScale: widthMap,
            partHeightScale: heightMap,
            partRotationOffset: rotMap,
            partFlipH: flipHMap,
            partFlipV: flipVMap,
            partOffsetX: offsetXMap,
            partOffsetY: offsetYMap,
            layerStack: serializedLayerStack,
            embeddedImagesBase64: embeddedImgs,
            puppetStageOffsetX: Double(stagePuppetOffset.width),
            puppetStageOffsetY: Double(stagePuppetOffset.height),
            idleMotionAmount: idleMotionAmount,
            characterName: characterName,
            humanAnatomyConstraints: humanAnatomyConstraints,
            dynamicPalmFlip: dynamicPalmFlip,
            jawWarpEnabled: jawWarpEnabled,
            followChildrenOnMove: followChildrenOnMove,
            followChildrenOnRotate: followChildrenOnRotate
        )
    }

    private var saveWorkItem: DispatchWorkItem?

    public func saveCurrentPresetState(immediate: Bool = false) {
        guard !isRestoringState else { return }
        UserDefaults.standard.set(activePreset.rawValue, forKey: Self.activePresetDefaultsKey)
        let state = buildPersistedState(includeImages: true)
        let fileURL = Self.rigFileURL(for: activePreset)
        let label = characterName.isEmpty ? "Character" : characterName

        saveWorkItem?.cancel()
        if immediate {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            if let data = try? encoder.encode(state) {
                try? data.write(to: fileURL, options: .atomic)
                self.lastSavedStatus = "Saved (\(label))"
            }
        } else {
            let work = DispatchWorkItem {
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                if let data = try? encoder.encode(state) {
                    try? data.write(to: fileURL, options: .atomic)
                    DispatchQueue.main.async { [weak self] in
                        self?.lastSavedStatus = "Saved (\(label))"
                    }
                }
            }
            saveWorkItem = work
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + 0.35, execute: work)
        }
    }

    public func saveNow() {
        saveCurrentPresetState(immediate: true)
    }

    public func applyPersistedState(_ state: PuppetPersistedRigState) {
        let wasRestoring = isRestoringState
        isRestoringState = true
        defer { isRestoringState = wasRestoring }

        let legacyFoxSlots: Set<PuppetPartSlot> = Set(
            state.partFileNames.compactMap { rawSlot, name in
                name.hasPrefix("Aurora Fox ") ? PuppetPartSlot(rawValue: rawSlot) : nil
            }
        )

        for (rawSlot, pins) in state.pinsBySlot {
            if let slot = PuppetPartSlot(rawValue: rawSlot), !pins.isEmpty {
                pinsBySlot[slot] = pins
            }
        }
        for (rawSlot, flag) in state.partEnabled {
            if let slot = PuppetPartSlot(rawValue: rawSlot) {
                if legacyFoxSlots.contains(slot) && slot == .tail {
                    partEnabled[slot] = false
                } else {
                    partEnabled[slot] = flag
                }
            }
        }
        for (rawSlot, rawOrder) in state.partLayerOrder {
            if let slot = PuppetPartSlot(rawValue: rawSlot),
               let order = PuppetLayerOrder(rawValue: rawOrder) {
                partLayerOrder[slot] = order
            }
        }
        for (rawSlot, path) in state.customImagePaths {
            if let slot = PuppetPartSlot(rawValue: rawSlot),
               !legacyFoxSlots.contains(slot),
               FileManager.default.fileExists(atPath: path),
               let img = NSImage(contentsOfFile: path) {
                partImages[slot] = img
                customImagePaths[slot] = path
                if let fname = state.partFileNames[rawSlot] {
                    partFileNames[slot] = fname
                }
            }
        }

        eyeAnimationMode = state.eyeAnimationMode
        mouthAnimationMode = state.mouthAnimationMode
        blinkThreshold = state.blinkThreshold
        autoBlinkEnabled = state.autoBlinkEnabled
        headMoveAmount = state.headMoveAmount
        headTiltAmount = state.headTiltAmount
        headTurnParallax = state.headTurnParallax
        bodyTurnAmount = state.bodyTurnAmount
        headScaleAmount = state.headScaleAmount
        jawWarpAmount = state.jawWarpAmount
        browWarpAmount = state.browWarpAmount
        eyeSpriteScale = state.eyeSpriteScale
        noseSpriteScale = state.noseSpriteScale
        mouthSpriteScale = state.mouthSpriteScale
        characterScale = state.characterScale
        handScale = state.handScale
        armLengthScale = state.armLengthScale
        armThicknessScale = state.armThicknessScale
        legLengthScale = state.legLengthScale
        legThicknessScale = state.legThicknessScale
        showFullBodyLegs = state.showFullBodyLegs
        stageBackground = state.stageBackground

        partWidthScale = [:]
        partHeightScale = [:]
        partRotationOffset = [:]
        partFlipH = [:]
        partFlipV = [:]
        partOffsetX = [:]
        partOffsetY = [:]

        if let widths = state.partWidthScale {
            for (rawSlot, w) in widths {
                if let slot = PuppetPartSlot(rawValue: rawSlot) {
                    partWidthScale[slot] = w
                }
            }
        }
        if let heights = state.partHeightScale {
            for (rawSlot, h) in heights {
                if let slot = PuppetPartSlot(rawValue: rawSlot) {
                    partHeightScale[slot] = h
                }
            }
        }
        if let ha = state.humanAnatomyConstraints {
            humanAnatomyConstraints = ha
        }
        if let dp = state.dynamicPalmFlip {
            dynamicPalmFlip = dp
        }
        if let jw = state.jawWarpEnabled {
            jawWarpEnabled = jw
        }
        followChildrenOnMove = state.followChildrenOnMove ?? true
        followChildrenOnRotate = state.followChildrenOnRotate ?? true
        if let rots = state.partRotationOffset {
            for (rawSlot, r) in rots {
                if let slot = PuppetPartSlot(rawValue: rawSlot) {
                    partRotationOffset[slot] = r
                }
            }
        }
        if let flipsH = state.partFlipH {
            for (rawSlot, f) in flipsH {
                if let slot = PuppetPartSlot(rawValue: rawSlot) {
                    partFlipH[slot] = f
                }
            }
        }
        if let flipsV = state.partFlipV {
            for (rawSlot, f) in flipsV {
                if let slot = PuppetPartSlot(rawValue: rawSlot) {
                    partFlipV[slot] = f
                }
            }
        }
        if let offsetsX = state.partOffsetX {
            for (rawSlot, ox) in offsetsX {
                if let slot = PuppetPartSlot(rawValue: rawSlot) {
                    partOffsetX[slot] = ox
                }
            }
        }
        if let offsetsY = state.partOffsetY {
            for (rawSlot, oy) in offsetsY {
                if let slot = PuppetPartSlot(rawValue: rawSlot) {
                    partOffsetY[slot] = oy
                }
            }
        }
        if let rawStack = state.layerStack, !rawStack.isEmpty {
            let decoded = rawStack.compactMap { PuppetPartSlot(rawValue: $0) }
            layerStack = normalizedLayerStack(decoded, preset: state.preset)
        } else {
            layerStack = Self.migrateLayerStack(from: partLayerOrder, preset: state.preset)
        }

        // Restore embedded sprite graphics if bundled in package (skipping legacy Aurora Fox baked assets)
        if let embedded = state.embeddedImagesBase64 {
            for (rawSlot, b64) in embedded {
                if let slot = PuppetPartSlot(rawValue: rawSlot),
                   !legacyFoxSlots.contains(slot),
                   let data = Data(base64Encoded: b64),
                   let img = NSImage(data: data) {
                    setCustomPartImage(img, label: state.partFileNames[rawSlot] ?? "\(slot.title).png", for: slot)
                }
            }
        }

        if let ox = state.puppetStageOffsetX, let oy = state.puppetStageOffsetY {
            stagePuppetOffset = CGSize(width: ox, height: oy)
        }
        if let ima = state.idleMotionAmount {
            idleMotionAmount = ima
        }
        if let cn = state.characterName, !cn.isEmpty {
            characterName = cn
        }

        let loadedLabel = characterName.isEmpty ? "Character" : characterName
        lastSavedStatus = "Loaded (\(loadedLabel))"
    }

    public func exportCharacterPackage(customName: String? = nil) {
        let panel = NSSavePanel()
        panel.title = "Save Full Puppet Character Package"
        let base = customName ?? (characterName.isEmpty ? activePreset.rawValue : characterName)
        panel.nameFieldStringValue = "\(base).puppet.json"
        panel.allowedContentTypes = [.json]
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            let pureName = url.deletingPathExtension().deletingPathExtension().lastPathComponent
            if !pureName.isEmpty {
                self.characterName = pureName
            }
            let state = buildPersistedState(includeImages: true)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            if let data = try? encoder.encode(state) {
                try? data.write(to: url, options: .atomic)
                lastSavedStatus = "Saved Character Package: \(url.lastPathComponent)"
            }
        }
    }

    public func exportRigOnly() {
        let panel = NSSavePanel()
        panel.title = "Export Rig Pins & Settings Only"
        let base = characterName.isEmpty ? activePreset.rawValue : characterName
        panel.nameFieldStringValue = "\(base)_rig_only.puppet.json"
        panel.allowedContentTypes = [.json]
        panel.canCreateDirectories = true
        if panel.runModal() == .OK, let url = panel.url {
            let state = buildPersistedState(includeImages: false)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            if let data = try? encoder.encode(state) {
                try? data.write(to: url, options: .atomic)
                lastSavedStatus = "Exported Rig Only: \(url.lastPathComponent)"
            }
        }
    }

    public func exportRigToFile() {
        exportCharacterPackage()
    }

    public func importRigFromFile() {
        let panel = NSOpenPanel()
        panel.title = "Load Puppet Character / Rig (.puppet.json)"
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url,
           let data = try? Data(contentsOf: url),
           let state = try? JSONDecoder().decode(PuppetPersistedRigState.self, from: data) {
            recordUndoSnapshot()
            let baseName = url.deletingPathExtension().deletingPathExtension().lastPathComponent
            if state.preset != activePreset {
                loadPreset(state.preset, recordUndo: false)
            }
            applyPersistedState(state)
            if state.characterName == nil || state.characterName?.isEmpty == true {
                characterName = baseName
            }
            saveCurrentPresetState()
            lastSavedStatus = "Loaded \(url.lastPathComponent)"
        }
    }

    // MARK: - Undo / Redo Management

    public func recordUndoSnapshot() {
        let snap = PuppetUndoSnapshot(
            preset: activePreset,
            characterName: characterName,
            pinsBySlot: pinsBySlot,
            partImages: partImages,
            partFileNames: partFileNames,
            partEnabled: partEnabled,
            partLayerOrder: partLayerOrder,
            layerStack: layerStack,
            partWidthScale: partWidthScale,
            partHeightScale: partHeightScale,
            partRotationOffset: partRotationOffset,
            partFlipH: partFlipH,
            partFlipV: partFlipV,
            partOffsetX: partOffsetX,
            partOffsetY: partOffsetY,
            puppetStageOffset: stagePuppetOffset,
            idleMotionAmount: idleMotionAmount
        )
        undoStack.append(snap)
        if undoStack.count > 40 {
            undoStack.removeFirst()
        }
        redoStack.removeAll()
        updateUndoRedoFlags()
    }

    public func undo() {
        guard let last = undoStack.popLast() else { return }
        let current = PuppetUndoSnapshot(
            preset: activePreset,
            characterName: characterName,
            pinsBySlot: pinsBySlot,
            partImages: partImages,
            partFileNames: partFileNames,
            partEnabled: partEnabled,
            partLayerOrder: partLayerOrder,
            layerStack: layerStack,
            partWidthScale: partWidthScale,
            partHeightScale: partHeightScale,
            partRotationOffset: partRotationOffset,
            partFlipH: partFlipH,
            partFlipV: partFlipV,
            partOffsetX: partOffsetX,
            partOffsetY: partOffsetY,
            puppetStageOffset: stagePuppetOffset,
            idleMotionAmount: idleMotionAmount
        )
        redoStack.append(current)
        applySnapshot(last)
        updateUndoRedoFlags()
        saveCurrentPresetState()
    }

    public func redo() {
        guard let next = redoStack.popLast() else { return }
        let current = PuppetUndoSnapshot(
            preset: activePreset,
            characterName: characterName,
            pinsBySlot: pinsBySlot,
            partImages: partImages,
            partFileNames: partFileNames,
            partEnabled: partEnabled,
            partLayerOrder: partLayerOrder,
            layerStack: layerStack,
            partWidthScale: partWidthScale,
            partHeightScale: partHeightScale,
            partRotationOffset: partRotationOffset,
            partFlipH: partFlipH,
            partFlipV: partFlipV,
            partOffsetX: partOffsetX,
            partOffsetY: partOffsetY,
            puppetStageOffset: stagePuppetOffset,
            idleMotionAmount: idleMotionAmount
        )
        undoStack.append(current)
        applySnapshot(next)
        updateUndoRedoFlags()
        saveCurrentPresetState()
    }

    private func applySnapshot(_ s: PuppetUndoSnapshot) {
        activePreset = s.preset
        characterName = s.characterName
        pinsBySlot = s.pinsBySlot
        partImages = s.partImages
        partFileNames = s.partFileNames
        partEnabled = s.partEnabled
        partLayerOrder = s.partLayerOrder
        layerStack = s.layerStack
        partWidthScale = s.partWidthScale
        partHeightScale = s.partHeightScale
        partRotationOffset = s.partRotationOffset
        partFlipH = s.partFlipH
        partFlipV = s.partFlipV
        partOffsetX = s.partOffsetX
        partOffsetY = s.partOffsetY
        stagePuppetOffset = s.puppetStageOffset
        idleMotionAmount = s.idleMotionAmount
    }

    // MARK: - Ordered Front-to-Back Stage Layer Stack

    public static let stageLayerSlots: [PuppetPartSlot] = [
        .leftHand,
        .rightHand,
        .head,
        .leftForearm,
        .leftUpperArm,
        .rightForearm,
        .rightUpperArm,
        .torso,
        .pelvis,
        .leftThigh,
        .leftShin,
        .leftFoot,
        .rightThigh,
        .rightShin,
        .rightFoot,
        .tail
    ]

    public static func defaultLayerStack(for preset: PuppetCharacterPreset) -> [PuppetPartSlot] {
        [
            .leftHand,
            .rightHand,
            .head,
            .leftForearm,
            .rightForearm,
            .leftUpperArm,
            .rightUpperArm,
            .torso,
            .pelvis,
            .leftThigh,
            .rightThigh,
            .leftShin,
            .rightShin,
            .leftFoot,
            .rightFoot,
            .tail
        ]
    }

    private func normalizedLayerStack(_ raw: [PuppetPartSlot], preset: PuppetCharacterPreset) -> [PuppetPartSlot] {
        var result: [PuppetPartSlot] = []
        var seen = Set<PuppetPartSlot>()
        let allowed = Set(Self.stageLayerSlots)
        for slot in raw where allowed.contains(slot) && !seen.contains(slot) {
            result.append(slot)
            seen.insert(slot)
        }
        for slot in Self.defaultLayerStack(for: preset) where !seen.contains(slot) {
            result.append(slot)
            seen.insert(slot)
        }
        return result
    }

    public static func migrateLayerStack(from orderMap: [PuppetPartSlot: PuppetLayerOrder], preset: PuppetCharacterPreset) -> [PuppetPartSlot] {
        let baseline = defaultLayerStack(for: preset)
        let baselineIndex = Dictionary(uniqueKeysWithValues: baseline.enumerated().map { ($1, $0) })

        func rank(for slot: PuppetPartSlot) -> Double {
            if slot == .head { return 2.0 }
            if slot == .torso { return 0.5 }
            if let bucket = orderMap[slot] {
                switch bucket {
                case .inFrontOfHead: return 3.0
                case .inFrontOfBody: return 1.0
                case .behindBody: return 0.0
                }
            }
            // Fall back to default bucket rank so unspecified slots keep sensible placement
            let bIdx = baselineIndex[slot] ?? baseline.count
            let torsoIdx = baselineIndex[.torso] ?? 7
            let headIdx = baselineIndex[.head] ?? 2
            if bIdx < headIdx { return 3.0 }
            if bIdx < torsoIdx { return 1.0 }
            return 0.0
        }

        return baseline.sorted { a, b in
            let ra = rank(for: a)
            let rb = rank(for: b)
            if abs(ra - rb) > 0.001 {
                return ra > rb
            }
            return (baselineIndex[a] ?? 0) < (baselineIndex[b] ?? 0)
        }
    }

    public func isStageLayerSlot(_ slot: PuppetPartSlot) -> Bool {
        Self.stageLayerSlots.contains(slot)
    }

    public func frontToBackIndex(for slot: PuppetPartSlot) -> Int {
        layerStack.firstIndex(of: slot) ?? layerStack.count
    }

    public func canMoveLayerForward(_ slot: PuppetPartSlot) -> Bool {
        guard let idx = layerStack.firstIndex(of: slot) else { return false }
        return idx > 0
    }

    public func canMoveLayerBackward(_ slot: PuppetPartSlot) -> Bool {
        guard let idx = layerStack.firstIndex(of: slot) else { return false }
        return idx < layerStack.count - 1
    }

    public func moveLayerForward(_ slot: PuppetPartSlot) {
        guard let idx = layerStack.firstIndex(of: slot), idx > 0 else { return }
        recordUndoSnapshot()
        layerStack.swapAt(idx, idx - 1)
        saveCurrentPresetState()
    }

    public func moveLayerBackward(_ slot: PuppetPartSlot) {
        guard let idx = layerStack.firstIndex(of: slot), idx < layerStack.count - 1 else { return }
        recordUndoSnapshot()
        layerStack.swapAt(idx, idx + 1)
        saveCurrentPresetState()
    }

    public func moveLayerToFront(_ slot: PuppetPartSlot) {
        guard let idx = layerStack.firstIndex(of: slot), idx > 0 else { return }
        recordUndoSnapshot()
        layerStack.remove(at: idx)
        layerStack.insert(slot, at: 0)
        saveCurrentPresetState()
    }

    public func moveLayerToBack(_ slot: PuppetPartSlot) {
        guard let idx = layerStack.firstIndex(of: slot), idx < layerStack.count - 1 else { return }
        recordUndoSnapshot()
        layerStack.remove(at: idx)
        layerStack.append(slot)
        saveCurrentPresetState()
    }

    public func moveLayer(_ slot: PuppetPartSlot, toIndex dstIdx: Int) {
        guard let srcIdx = layerStack.firstIndex(of: slot) else { return }
        let clamped = max(0, min(layerStack.count - 1, dstIdx))
        guard srcIdx != clamped else { return }
        recordUndoSnapshot()
        layerStack.remove(at: srcIdx)
        layerStack.insert(slot, at: clamped)
        saveCurrentPresetState()
    }

    public func layerOrder(for slot: PuppetPartSlot) -> PuppetLayerOrder {
        if let idx = layerStack.firstIndex(of: slot) {
            let headIdx = layerStack.firstIndex(of: .head) ?? 2
            let torsoIdx = layerStack.firstIndex(of: .torso) ?? 7
            if idx < headIdx { return .inFrontOfHead }
            if idx < torsoIdx { return .inFrontOfBody }
            return .behindBody
        }
        return partLayerOrder[slot] ?? .inFrontOfBody
    }

    public func setLayerOrder(for slot: PuppetPartSlot, order: PuppetLayerOrder, linkWholeLimb: Bool = false) {
        recordUndoSnapshot()
        partLayerOrder[slot] = order
        if linkWholeLimb {
            switch slot {
            case .leftUpperArm, .leftForearm, .leftHand:
                partLayerOrder[.leftUpperArm] = order
                partLayerOrder[.leftForearm] = order
                partLayerOrder[.leftHand] = order
            case .rightUpperArm, .rightForearm, .rightHand:
                partLayerOrder[.rightUpperArm] = order
                partLayerOrder[.rightForearm] = order
                partLayerOrder[.rightHand] = order
            case .leftThigh, .leftShin, .leftFoot:
                partLayerOrder[.leftThigh] = order
                partLayerOrder[.leftShin] = order
                partLayerOrder[.leftFoot] = order
            case .rightThigh, .rightShin, .rightFoot:
                partLayerOrder[.rightThigh] = order
                partLayerOrder[.rightShin] = order
                partLayerOrder[.rightFoot] = order
            default:
                break
            }
        }
        saveCurrentPresetState()
    }

    private func updateUndoRedoFlags() {
        canUndo = !undoStack.isEmpty
        canRedo = !redoStack.isEmpty
    }

    // MARK: - Individual Part Transform & Sprite Actions

    public func partWidth(for slot: PuppetPartSlot) -> CGFloat {
        CGFloat(partWidthScale[slot] ?? 1.0)
    }

    public func setPartWidth(_ width: Double, for slot: PuppetPartSlot) {
        partWidthScale[slot] = width
        autoSaveIfNeeded()
    }

    public func partHeight(for slot: PuppetPartSlot) -> CGFloat {
        CGFloat(partHeightScale[slot] ?? 1.0)
    }

    public func setPartHeight(_ height: Double, for slot: PuppetPartSlot) {
        partHeightScale[slot] = height
        autoSaveIfNeeded()
    }

    public func partRotationDegrees(for slot: PuppetPartSlot) -> Double {
        partRotationOffset[slot] ?? 0.0
    }

    public func setPartRotationDegrees(_ degrees: Double, for slot: PuppetPartSlot) {
        partRotationOffset[slot] = degrees
        autoSaveIfNeeded()
    }

    public func partOffset(for slot: PuppetPartSlot) -> CGSize {
        CGSize(width: partOffsetX[slot] ?? 0.0, height: partOffsetY[slot] ?? 0.0)
    }

    public func setPartOffset(_ offset: CGSize, for slot: PuppetPartSlot) {
        partOffsetX[slot] = Double(offset.width)
        partOffsetY[slot] = Double(offset.height)
        autoSaveIfNeeded()
    }

    public func isPartFlippedH(_ slot: PuppetPartSlot) -> Bool {
        partFlipH[slot] ?? false
    }

    public func togglePartFlipH(_ slot: PuppetPartSlot) {
        recordUndoSnapshot()
        partFlipH[slot] = !(partFlipH[slot] ?? false)
        autoSaveIfNeeded()
    }

    public func isPartFlippedV(_ slot: PuppetPartSlot) -> Bool {
        partFlipV[slot] ?? false
    }

    public func togglePartFlipV(_ slot: PuppetPartSlot) {
        recordUndoSnapshot()
        partFlipV[slot] = !(partFlipV[slot] ?? false)
        autoSaveIfNeeded()
    }

    public func resetPartTransform(for slot: PuppetPartSlot) {
        recordUndoSnapshot()
        partWidthScale[slot] = 1.0
        partHeightScale[slot] = 1.0
        partRotationOffset[slot] = 0.0
        partFlipH[slot] = false
        partFlipV[slot] = false
        partOffsetX[slot] = 0.0
        partOffsetY[slot] = 0.0
        autoSaveIfNeeded()
    }

    public func resetPinsToDefault(for slot: PuppetPartSlot) {
        recordUndoSnapshot()
        let defaults = Self.defaultPins(for: activePreset)[slot] ?? []
        pinsBySlot[slot] = defaults
        saveCurrentPresetState()
    }

    public func removePartImage(slot: PuppetPartSlot) {
        recordUndoSnapshot()
        partImages.removeValue(forKey: slot)
        partFileNames.removeValue(forKey: slot)
        // Right-side mirror slots fall back to their mirrored Left counterpart when empty
        let mirrorPartner: PuppetPartSlot? = {
            switch slot {
            case .rightEyeOpen: return .eyesOpen
            case .rightEyeClosed: return .eyesClosed
            case .rightBrows: return .browsOverlay
            case .rightFoot: return .leftFoot
            default: return nil
            }
        }()
        if let partner = mirrorPartner, partImages[partner] != nil {
            partEnabled[slot] = true
        } else {
            partEnabled[slot] = false
        }
        let customURL = Self.customAssetDirectory(for: activePreset).appendingPathComponent("\(slot.rawValue).png")
        try? FileManager.default.removeItem(at: customURL)
        customImagePaths.removeValue(forKey: slot)
        saveCurrentPresetState()
    }

    // MARK: - Character Presets & Default Pins

    public func loadPreset(_ preset: PuppetCharacterPreset, recordUndo: Bool = true) {
        if recordUndo {
            saveCurrentPresetState()
            recordUndoSnapshot()
        }
        isRestoringState = true
        activePreset = preset
        customImagePaths.removeAll()
        pinsBySlot = Self.defaultPins(for: preset)

        loadHumanDemoGraphics()

        // Overlay any user-saved pins, sliders, layer orders & custom PNGs for this preset!
        let savedURL = Self.rigFileURL(for: preset)
        if FileManager.default.fileExists(atPath: savedURL.path),
           let data = try? Data(contentsOf: savedURL),
           let state = try? JSONDecoder().decode(PuppetPersistedRigState.self, from: data) {
            applyPersistedState(state)
        }
        isRestoringState = false
        UserDefaults.standard.set(preset.rawValue, forKey: Self.activePresetDefaultsKey)
    }

    public func resetPinsToDefault() {
        recordUndoSnapshot()
        pinsBySlot = Self.defaultPins(for: activePreset)
        stagePuppetOffset = .zero
        saveCurrentPresetState()
        lastSavedStatus = "Reset All Pins to Defaults"
    }

    /// Double-clicking any pin in the Rigging Editor resets that single pin to its default position
    public func resetSinglePinToDefault(slot: PuppetPartSlot, id: String) {
        let defaults = Self.defaultPins(for: activePreset)
        guard let defPin = defaults[slot]?.first(where: { $0.id == id }),
              var list = pinsBySlot[slot],
              let idx = list.firstIndex(where: { $0.id == id }) else { return }
        if list[idx].point != defPin.point {
            recordUndoSnapshot()
            list[idx].point = defPin.point
            pinsBySlot[slot] = list
            saveCurrentPresetState()
        }
    }

    public static func defaultPins(for preset: PuppetCharacterPreset) -> [PuppetPartSlot: [PuppetControlPin]] {
        var map: [PuppetPartSlot: [PuppetControlPin]] = [:]

        // Shared single-anchor pins for facial overlay sprites
        let centerEyePin = [
            PuppetControlPin(id: "eyeCenter", name: "Eye Center", trackedSourceLabel: "Aligns with Head Left/Right Eye Pin", x: 0.50, y: 0.50)
        ]
        map[.eyesOpen] = centerEyePin
        map[.rightEyeOpen] = centerEyePin
        map[.eyesClosed] = centerEyePin
        map[.rightEyeClosed] = centerEyePin
        map[.noseOverlay] = [
            PuppetControlPin(id: "noseAnchor", name: "Nose Center", trackedSourceLabel: "Aligns with Head Nose Pin (2.5D Parallax)", x: 0.50, y: 0.50)
        ]
        let centerBrowPin = [
            PuppetControlPin(id: "browsAnchor", name: "Brows Center", trackedSourceLabel: "Attaches to Head Brows Midpoint", x: 0.50, y: 0.50)
        ]
        map[.browsOverlay] = centerBrowPin
        map[.rightBrows] = centerBrowPin

        let centerMouthPin = [
            PuppetControlPin(id: "mouthAnchor", name: "Mouth Center", trackedSourceLabel: "Aligns with Head Mouth Pin", x: 0.50, y: 0.50)
        ]
        map[.mouthNeutral] = centerMouthPin
        map[.mouthAh] = centerMouthPin
        map[.mouthOh] = centerMouthPin
        map[.mouthSmile] = centerMouthPin

        let forearmPins = [
            PuppetControlPin(id: "elbowJoint", name: "Elbow Joint", trackedSourceLabel: "Attaches to Upper Arm Elbow", x: 0.50, y: 0.15),
            PuppetControlPin(id: "wristJoint", name: "Wrist Joint", trackedSourceLabel: "Hand Wrist / Pose Wrist", x: 0.50, y: 0.85)
        ]
        map[.leftForearm] = forearmPins
        map[.rightForearm] = forearmPins

        let handPins = [
            PuppetControlPin(id: "wristPivot", name: "Wrist Pivot", trackedSourceLabel: "Hand Wrist (Landmark 0)", x: 0.50, y: 0.20),
            PuppetControlPin(id: "middleKnuckle", name: "Finger Direction", trackedSourceLabel: "Hand Middle MCP (Landmark 9)", x: 0.50, y: 0.78)
        ]
        map[.leftHand] = handPins
        map[.rightHand] = handPins

        map[.pelvis] = [
            PuppetControlPin(id: "waistJoint", name: "Waist Joint", trackedSourceLabel: "Supports Torso Waist Pivot", x: 0.50, y: 0.22),
            PuppetControlPin(id: "leftHip", name: "Left Hip", trackedSourceLabel: "Pose Left Hip (23) / L Leg Mount", x: 0.30, y: 0.72),
            PuppetControlPin(id: "rightHip", name: "Right Hip", trackedSourceLabel: "Pose Right Hip (24) / R Leg Mount", x: 0.70, y: 0.72)
        ]

        map[.tail] = [
            PuppetControlPin(id: "tailBase", name: "Tail Base Pivot", trackedSourceLabel: "Attaches behind Torso Waist", x: 0.50, y: 0.18),
            PuppetControlPin(id: "tailTip", name: "Tail Tip", trackedSourceLabel: "Sways with Body & 2.5D Turn", x: 0.50, y: 0.85)
        ]

        let shinPins = [
            PuppetControlPin(id: "kneeJoint", name: "Knee Joint", trackedSourceLabel: "Attaches to Thigh Knee", x: 0.50, y: 0.12),
            PuppetControlPin(id: "ankleJoint", name: "Ankle / Foot", trackedSourceLabel: "Pose Ankle (27 / 28)", x: 0.50, y: 0.88)
        ]
        map[.leftShin] = shinPins
        map[.rightShin] = shinPins

        let leftFootPins = [
            PuppetControlPin(id: "ankleJoint", name: "Ankle Joint", trackedSourceLabel: "Attaches to Left Shin Ankle", x: 0.50, y: 0.20),
            PuppetControlPin(id: "toeTip", name: "Toe Tip", trackedSourceLabel: "Toe Tip / Ground Level", x: 0.20, y: 0.85)
        ]
        let rightFootPins = [
            PuppetControlPin(id: "ankleJoint", name: "Ankle Joint", trackedSourceLabel: "Attaches to Right Shin Ankle", x: 0.50, y: 0.20),
            PuppetControlPin(id: "toeTip", name: "Toe Tip", trackedSourceLabel: "Toe Tip / Ground Level", x: 0.80, y: 0.85)
        ]
        map[.leftFoot] = leftFootPins
        map[.rightFoot] = rightFootPins

        map[.head] = [
            PuppetControlPin(id: "neckPivot", name: "Head Base / Neck Joint", trackedSourceLabel: "Attaches to Torso Neck Mount", x: 0.50, y: 0.78),
            PuppetControlPin(id: "leftBrow", name: "Left Brow", trackedSourceLabel: "Face Left Eyebrow (Lift Warp)", x: 0.35, y: 0.36),
            PuppetControlPin(id: "rightBrow", name: "Right Brow", trackedSourceLabel: "Face Right Eyebrow (Lift Warp)", x: 0.65, y: 0.36),
            PuppetControlPin(id: "leftEye", name: "Left Eye", trackedSourceLabel: "Left Eye Sprite & Wink Anchor", x: 0.35, y: 0.48),
            PuppetControlPin(id: "rightEye", name: "Right Eye", trackedSourceLabel: "Right Eye Sprite & Wink Anchor", x: 0.65, y: 0.48),
            PuppetControlPin(id: "noseCenter", name: "Nose Tip", trackedSourceLabel: "Nose Layer & 2.5D Turn Center", x: 0.50, y: 0.58),
            PuppetControlPin(id: "mouthCenter", name: "Mouth Pin", trackedSourceLabel: "Mouth Viseme Sprite & Jaw Split Line", x: 0.50, y: 0.72),
            PuppetControlPin(id: "jawChin", name: "Lower Jaw / Chin", trackedSourceLabel: "Stretches Down Over Neck When Mouth Opens", x: 0.50, y: 0.88)
        ]
        map[.torso] = [
            PuppetControlPin(id: "neckMount", name: "Neck Top (Head Mount)", trackedSourceLabel: "Stationary Neck Top Where Head Attaches", x: 0.50, y: 0.12),
            PuppetControlPin(id: "leftShoulder", name: "Left Shoulder", trackedSourceLabel: "Pose Left Shoulder (11) / L Arm Mount", x: 0.20, y: 0.34),
            PuppetControlPin(id: "rightShoulder", name: "Right Shoulder", trackedSourceLabel: "Pose Right Shoulder (12) / R Arm Mount", x: 0.80, y: 0.34),
            PuppetControlPin(id: "waistPivot", name: "Waist / Pelvis Mount", trackedSourceLabel: "Attaches to Pelvis Waist Joint", x: 0.50, y: 0.88)
        ]
        let upperArmPins = [
            PuppetControlPin(id: "shoulderJoint", name: "Shoulder Joint", trackedSourceLabel: "Attaches to Torso Shoulder", x: 0.50, y: 0.15),
            PuppetControlPin(id: "elbowJoint", name: "Elbow Joint", trackedSourceLabel: "Pose Elbow / 2-Bone IK Elbow", x: 0.50, y: 0.85)
        ]
        map[.leftUpperArm] = upperArmPins
        map[.rightUpperArm] = upperArmPins

        let thighPins = [
            PuppetControlPin(id: "hipJoint", name: "Hip Joint", trackedSourceLabel: "Attaches to Pelvis Hip", x: 0.50, y: 0.14),
            PuppetControlPin(id: "kneeJoint", name: "Knee Joint", trackedSourceLabel: "Pose Knee (25 / 26)", x: 0.50, y: 0.86)
        ]
        map[.leftThigh] = thighPins
        map[.rightThigh] = thighPins

        return map
    }

    public func pin(in slot: PuppetPartSlot, id: String) -> CGPoint {
        if let found = pinsBySlot[slot]?.first(where: { $0.id == id }) {
            return found.point
        }
        return CGPoint(x: 0.5, y: 0.5)
    }

    public func updatePin(slot: PuppetPartSlot, id: String, to newUV: CGPoint) {
        guard var list = pinsBySlot[slot],
              let idx = list.firstIndex(where: { $0.id == id }) else { return }
        list[idx].point = newUV
        pinsBySlot[slot] = list
        saveCurrentPresetState()
    }

    public func setCustomPartImage(_ img: NSImage, label: String, for slot: PuppetPartSlot) {
        recordUndoSnapshot()
        partImages[slot] = img
        partFileNames[slot] = label
        partEnabled[slot] = true
        let destURL = Self.customAssetDirectory(for: activePreset).appendingPathComponent("\(slot.rawValue).png")
        if let tiff = img.tiffRepresentation,
           let rep = NSBitmapImageRep(data: tiff),
           let pngData = rep.representation(using: .png, properties: [:]) {
            try? pngData.write(to: destURL, options: .atomic)
            customImagePaths[slot] = destURL.path
        }
        saveCurrentPresetState()
    }

    public func loadImage(from url: URL, for slot: PuppetPartSlot) {
        let accessed = url.startAccessingSecurityScopedResource()
        defer {
            if accessed { url.stopAccessingSecurityScopedResource() }
        }
        guard let img = NSImage(contentsOf: url) else { return }
        DispatchQueue.main.async {
            self.setCustomPartImage(img, label: url.lastPathComponent, for: slot)
        }
    }

    public func loadHumanDemoGraphics() {
        partImages.removeAll()
        for slot in PuppetPartSlot.allCases {
            partEnabled[slot] = (slot != .browsOverlay && slot != .rightBrows && slot != .tail)
            partFileNames[slot] = "Demo \(slot.title)"
            partLayerOrder[slot] = (slot == .tail) ? .behindBody : .inFrontOfBody
        }
        layerStack = Self.defaultLayerStack(for: .humanCharacter)
        partWidthScale = [:]
        partHeightScale = [:]
        partRotationOffset = [:]
        partFlipH = [:]
        partFlipV = [:]
        partOffsetX = [:]
        partOffsetY = [:]
        stagePuppetOffset = .zero
        armLengthScale = 1.0
        armThicknessScale = 1.0
        legLengthScale = 1.0
        legThicknessScale = 1.0

        partImages[.head] = Self.makeDemoHeadImage()
        partImages[.eyesOpen] = Self.makeDemoEyeSprite(closed: false)
        partImages[.rightEyeOpen] = Self.makeDemoEyeSprite(closed: false)
        partImages[.eyesClosed] = Self.makeDemoEyeSprite(closed: true)
        partImages[.rightEyeClosed] = Self.makeDemoEyeSprite(closed: true)
        partImages[.noseOverlay] = Self.makeDemoNoseSprite()
        partImages[.browsOverlay] = Self.makeDemoBrowsImage()
        partImages[.mouthNeutral] = Self.makeDemoMouthSprite(viseme: .neutral)
        partImages[.mouthAh] = Self.makeDemoMouthSprite(viseme: .ah)
        partImages[.mouthOh] = Self.makeDemoMouthSprite(viseme: .oh)
        partImages[.mouthSmile] = Self.makeDemoMouthSprite(viseme: .smile)

        partImages[.torso] = Self.makeDemoTorsoWithNeckImage()
        partImages[.leftUpperArm] = Self.makeDemoLimbImage(
            topColor: NSColor(calibratedRed: 0.28, green: 0.24, blue: 0.36, alpha: 1.0),
            bottomColor: NSColor(calibratedRed: 0.28, green: 0.24, blue: 0.36, alpha: 1.0),
            width: 64
        )
        partImages[.rightUpperArm] = partImages[.leftUpperArm]
        partImages[.leftForearm] = Self.makeDemoLimbImage(
            topColor: NSColor(calibratedRed: 0.28, green: 0.24, blue: 0.36, alpha: 1.0),
            bottomColor: NSColor(calibratedRed: 0.92, green: 0.75, blue: 0.61, alpha: 1.0),
            width: 56
        )
        partImages[.rightForearm] = partImages[.leftForearm]
        partImages[.leftHand] = Self.makeDemoHandImage(isLeft: true)
        partImages[.rightHand] = Self.makeDemoHandImage(isLeft: false)

        partImages[.pelvis] = Self.makeDemoPelvisImage()
        partImages[.leftThigh] = Self.makeDemoLimbImage(
            topColor: NSColor(calibratedRed: 0.18, green: 0.25, blue: 0.34, alpha: 1.0),
            bottomColor: NSColor(calibratedRed: 0.18, green: 0.25, blue: 0.34, alpha: 1.0),
            width: 72
        )
        partImages[.rightThigh] = partImages[.leftThigh]
        partImages[.leftShin] = Self.makeDemoShinWithShoeImage(isLeft: true)
        partImages[.rightShin] = Self.makeDemoShinWithShoeImage(isLeft: false)
    }

    // MARK: - Procedural Human Demo Graphics

    private static func makeDemoHeadImage() -> NSImage {
        let size = NSSize(width: 512, height: 512)
        let img = NSImage(size: size)
        img.lockFocus()
        guard let ctx = NSGraphicsContext.current?.cgContext else {
            img.unlockFocus()
            return img
        }
        ctx.translateBy(x: 0, y: size.height)
        ctx.scaleBy(x: 1, y: -1)

        let hairColor = NSColor(calibratedRed: 0.24, green: 0.22, blue: 0.20, alpha: 1.0).cgColor
        let hairHighlight = NSColor(calibratedRed: 0.42, green: 0.39, blue: 0.36, alpha: 0.85).cgColor
        let outlineColor = NSColor(calibratedRed: 0.16, green: 0.14, blue: 0.12, alpha: 0.95).cgColor

        // Top knot
        let bunOuter = CGRect(x: 198, y: 18, width: 116, height: 76)
        let bunPath = CGPath(roundedRect: bunOuter, cornerWidth: 38, cornerHeight: 38, transform: nil)
        ctx.setFillColor(hairColor)
        ctx.setStrokeColor(outlineColor)
        ctx.setLineWidth(5)
        ctx.addPath(bunPath)
        ctx.drawPath(using: .fillStroke)

        let bunTop = CGRect(x: 218, y: 8, width: 76, height: 34)
        let bunTopPath = CGPath(roundedRect: bunTop, cornerWidth: 17, cornerHeight: 17, transform: nil)
        ctx.addPath(bunTopPath)
        ctx.drawPath(using: .fillStroke)

        ctx.setStrokeColor(hairHighlight)
        ctx.setLineWidth(3)
        ctx.move(to: CGPoint(x: 218, y: 48))
        ctx.addQuadCurve(to: CGPoint(x: 294, y: 48), control: CGPoint(x: 256, y: 26))
        ctx.strokePath()

        let tieRect = CGRect(x: 210, y: 78, width: 92, height: 14)
        let tiePath = CGPath(roundedRect: tieRect, cornerWidth: 7, cornerHeight: 7, transform: nil)
        ctx.setFillColor(NSColor(calibratedRed: 0.18, green: 0.72, blue: 0.66, alpha: 1.0).cgColor)
        ctx.addPath(tiePath)
        ctx.fillPath()

        // Ears
        ctx.setFillColor(NSColor(calibratedRed: 0.90, green: 0.72, blue: 0.58, alpha: 1.0).cgColor)
        ctx.fillEllipse(in: CGRect(x: 80, y: 228, width: 44, height: 74))
        ctx.fillEllipse(in: CGRect(x: 388, y: 228, width: 44, height: 74))

        // Head base oval
        let headRect = CGRect(x: 104, y: 88, width: 304, height: 366)
        let headPath = CGPath(roundedRect: headRect, cornerWidth: 138, cornerHeight: 138, transform: nil)
        ctx.setFillColor(NSColor(calibratedRed: 0.95, green: 0.78, blue: 0.64, alpha: 1.0).cgColor)
        ctx.addPath(headPath)
        ctx.fillPath()

        ctx.saveGState()
        ctx.addPath(headPath)
        ctx.clip()
        ctx.setFillColor(hairColor)
        ctx.fillEllipse(in: CGRect(x: 88, y: 60, width: 336, height: 110))
        ctx.restoreGState()

        ctx.setStrokeColor(outlineColor)
        ctx.setLineWidth(6)
        ctx.addPath(headPath)
        ctx.strokePath()

        // Lower face beard
        let beardRect = CGRect(x: 110, y: 292, width: 292, height: 174)
        let beardPath = CGPath(roundedRect: beardRect, cornerWidth: 128, cornerHeight: 120, transform: nil)
        ctx.setFillColor(NSColor(calibratedRed: 0.34, green: 0.32, blue: 0.31, alpha: 0.94).cgColor)
        ctx.addPath(beardPath)
        ctx.fillPath()
        ctx.setStrokeColor(outlineColor)
        ctx.setLineWidth(4)
        ctx.addPath(beardPath)
        ctx.strokePath()

        // Eyebrows
        ctx.setLineCap(.round)
        ctx.setLineWidth(14)
        ctx.setStrokeColor(hairColor)
        ctx.move(to: CGPoint(x: 142, y: 188))
        ctx.addQuadCurve(to: CGPoint(x: 214, y: 184), control: CGPoint(x: 178, y: 172))
        ctx.strokePath()

        ctx.move(to: CGPoint(x: 298, y: 184))
        ctx.addQuadCurve(to: CGPoint(x: 370, y: 188), control: CGPoint(x: 334, y: 172))
        ctx.strokePath()

        img.unlockFocus()
        return img
    }

    private static func makeDemoNoseSprite() -> NSImage {
        let size = NSSize(width: 90, height: 96)
        let img = NSImage(size: size)
        img.lockFocus()
        guard let ctx = NSGraphicsContext.current?.cgContext else {
            img.unlockFocus()
            return img
        }
        ctx.translateBy(x: 0, y: size.height)
        ctx.scaleBy(x: 1, y: -1)

        let noseRect = CGRect(x: 18, y: 18, width: 54, height: 60)
        ctx.setFillColor(NSColor(calibratedRed: 0.88, green: 0.67, blue: 0.53, alpha: 1.0).cgColor)
        ctx.fillEllipse(in: noseRect)
        ctx.setStrokeColor(NSColor(calibratedRed: 0.55, green: 0.38, blue: 0.28, alpha: 0.85).cgColor)
        ctx.setLineWidth(4)
        ctx.strokeEllipse(in: noseRect)

        img.unlockFocus()
        return img
    }

    private static func makeDemoEyeSprite(closed: Bool) -> NSImage {
        let size = NSSize(width: 140, height: 110)
        let img = NSImage(size: size)
        img.lockFocus()
        guard let ctx = NSGraphicsContext.current?.cgContext else {
            img.unlockFocus()
            return img
        }
        ctx.translateBy(x: 0, y: size.height)
        ctx.scaleBy(x: 1, y: -1)

        let lensRect = CGRect(x: 16, y: 14, width: 108, height: 82)
        ctx.setFillColor(NSColor(calibratedRed: 0.95, green: 0.78, blue: 0.64, alpha: 1.0).cgColor)
        ctx.fillEllipse(in: lensRect)

        if closed {
            ctx.setFillColor(NSColor(calibratedRed: 0.89, green: 0.70, blue: 0.56, alpha: 1.0).cgColor)
            ctx.fillEllipse(in: lensRect.insetBy(dx: 6, dy: 8))

            ctx.setStrokeColor(NSColor(calibratedRed: 0.18, green: 0.15, blue: 0.13, alpha: 1.0).cgColor)
            ctx.setLineWidth(6)
            ctx.setLineCap(.round)
            ctx.move(to: CGPoint(x: 28, y: 55))
            ctx.addQuadCurve(to: CGPoint(x: 112, y: 55), control: CGPoint(x: 70, y: 74))
            ctx.strokePath()
        } else {
            let eyeWhite = CGRect(x: 24, y: 24, width: 92, height: 62)
            ctx.setFillColor(NSColor.white.cgColor)
            ctx.fillEllipse(in: eyeWhite)

            ctx.setFillColor(NSColor(calibratedRed: 0.16, green: 0.22, blue: 0.28, alpha: 1.0).cgColor)
            ctx.fillEllipse(in: CGRect(x: 54, y: 39, width: 32, height: 32))
            ctx.setFillColor(NSColor.white.cgColor)
            ctx.fillEllipse(in: CGRect(x: 60, y: 44, width: 9, height: 9))
        }

        ctx.setStrokeColor(NSColor(calibratedRed: 0.14, green: 0.16, blue: 0.19, alpha: 0.96).cgColor)
        ctx.setLineWidth(8)
        ctx.strokeEllipse(in: lensRect)

        img.unlockFocus()
        return img
    }

    private static func makeDemoBrowsImage() -> NSImage {
        let size = NSSize(width: 300, height: 80)
        let img = NSImage(size: size)
        img.lockFocus()
        guard let ctx = NSGraphicsContext.current?.cgContext else {
            img.unlockFocus()
            return img
        }
        ctx.translateBy(x: 0, y: size.height)
        ctx.scaleBy(x: 1, y: -1)
        ctx.setLineCap(.round)
        ctx.setLineWidth(14)
        ctx.setStrokeColor(NSColor(calibratedRed: 0.24, green: 0.22, blue: 0.20, alpha: 1.0).cgColor)
        ctx.move(to: CGPoint(x: 24, y: 48))
        ctx.addQuadCurve(to: CGPoint(x: 108, y: 42), control: CGPoint(x: 66, y: 24))
        ctx.move(to: CGPoint(x: 192, y: 42))
        ctx.addQuadCurve(to: CGPoint(x: 276, y: 48), control: CGPoint(x: 234, y: 24))
        ctx.strokePath()
        img.unlockFocus()
        return img
    }

    private static func makeDemoMouthSprite(viseme: MouthViseme) -> NSImage {
        let size = NSSize(width: 180, height: 120)
        let img = NSImage(size: size)
        img.lockFocus()
        guard let ctx = NSGraphicsContext.current?.cgContext else {
            img.unlockFocus()
            return img
        }
        ctx.translateBy(x: 0, y: size.height)
        ctx.scaleBy(x: 1, y: -1)

        let beardPatch = CGRect(x: 14, y: 12, width: 152, height: 96)
        ctx.setFillColor(NSColor(calibratedRed: 0.34, green: 0.32, blue: 0.31, alpha: 1.0).cgColor)
        ctx.fillEllipse(in: beardPatch)

        let darkMouth = NSColor(calibratedRed: 0.25, green: 0.08, blue: 0.10, alpha: 1.0).cgColor
        let tongueColor = NSColor(calibratedRed: 0.82, green: 0.32, blue: 0.36, alpha: 1.0).cgColor
        let lipStroke = NSColor(calibratedRed: 0.18, green: 0.14, blue: 0.14, alpha: 0.95).cgColor

        switch viseme {
        case .neutral:
            ctx.setStrokeColor(lipStroke)
            ctx.setLineWidth(7)
            ctx.setLineCap(.round)
            ctx.move(to: CGPoint(x: 46, y: 58))
            ctx.addQuadCurve(to: CGPoint(x: 134, y: 58), control: CGPoint(x: 90, y: 66))
            ctx.strokePath()

        case .ah, .wideOpen:
            let openRect = CGRect(x: 38, y: 26, width: 104, height: 68)
            let path = CGPath(roundedRect: openRect, cornerWidth: 32, cornerHeight: 32, transform: nil)
            ctx.saveGState()
            ctx.addPath(path)
            ctx.clip()
            ctx.setFillColor(darkMouth)
            ctx.fill(openRect)
            ctx.setFillColor(tongueColor)
            ctx.fillEllipse(in: CGRect(x: 52, y: 58, width: 76, height: 48))
            ctx.setFillColor(NSColor.white.cgColor)
            ctx.fill(CGRect(x: 42, y: 24, width: 96, height: 16))
            ctx.restoreGState()
            ctx.setStrokeColor(lipStroke)
            ctx.setLineWidth(5)
            ctx.addPath(path)
            ctx.strokePath()

        case .oh:
            let ohRect = CGRect(x: 62, y: 28, width: 56, height: 64)
            ctx.saveGState()
            ctx.addEllipse(in: ohRect)
            ctx.clip()
            ctx.setFillColor(darkMouth)
            ctx.fill(ohRect)
            ctx.setFillColor(tongueColor)
            ctx.fillEllipse(in: CGRect(x: 68, y: 62, width: 44, height: 36))
            ctx.restoreGState()
            ctx.setStrokeColor(lipStroke)
            ctx.setLineWidth(6)
            ctx.strokeEllipse(in: ohRect)

        case .smile:
            let smileRect = CGRect(x: 30, y: 34, width: 120, height: 50)
            let path = CGPath(roundedRect: smileRect, cornerWidth: 24, cornerHeight: 24, transform: nil)
            ctx.saveGState()
            ctx.addPath(path)
            ctx.clip()
            ctx.setFillColor(darkMouth)
            ctx.fill(smileRect)
            ctx.setFillColor(NSColor.white.cgColor)
            ctx.fill(CGRect(x: 32, y: 34, width: 116, height: 22))
            ctx.setFillColor(tongueColor)
            ctx.fillEllipse(in: CGRect(x: 54, y: 60, width: 72, height: 32))
            ctx.restoreGState()
            ctx.setStrokeColor(lipStroke)
            ctx.setLineWidth(5)
            ctx.addPath(path)
            ctx.strokePath()
        }

        img.unlockFocus()
        return img
    }

    private static func makeDemoTorsoWithNeckImage() -> NSImage {
        let size = NSSize(width: 512, height: 440)
        let img = NSImage(size: size)
        img.lockFocus()
        guard let ctx = NSGraphicsContext.current?.cgContext else {
            img.unlockFocus()
            return img
        }
        ctx.translateBy(x: 0, y: size.height)
        ctx.scaleBy(x: 1, y: -1)

        let neckRect = CGRect(x: 212, y: 18, width: 88, height: 115)
        let neckPath = CGPath(roundedRect: neckRect, cornerWidth: 28, cornerHeight: 28, transform: nil)
        ctx.setFillColor(NSColor(calibratedRed: 0.86, green: 0.68, blue: 0.55, alpha: 1.0).cgColor)
        ctx.setStrokeColor(NSColor(calibratedRed: 0.22, green: 0.18, blue: 0.16, alpha: 0.9).cgColor)
        ctx.setLineWidth(5)
        ctx.addPath(neckPath)
        ctx.drawPath(using: .fillStroke)

        let bodyRect = CGRect(x: 92, y: 100, width: 328, height: 312)
        let bodyPath = CGPath(roundedRect: bodyRect, cornerWidth: 92, cornerHeight: 92, transform: nil)
        ctx.setFillColor(NSColor(calibratedRed: 0.28, green: 0.24, blue: 0.36, alpha: 1.0).cgColor)
        ctx.addPath(bodyPath)
        ctx.fillPath()

        ctx.setFillColor(NSColor(calibratedRed: 0.82, green: 0.64, blue: 0.51, alpha: 1.0).cgColor)
        ctx.fillEllipse(in: CGRect(x: 204, y: 84, width: 104, height: 42))

        ctx.setStrokeColor(NSColor.white.withAlphaComponent(0.25).cgColor)
        ctx.setLineWidth(5)
        ctx.addPath(bodyPath)
        ctx.strokePath()

        img.unlockFocus()
        return img
    }

    private static func makeDemoPelvisImage() -> NSImage {
        let size = NSSize(width: 360, height: 180)
        let img = NSImage(size: size)
        img.lockFocus()
        guard let ctx = NSGraphicsContext.current?.cgContext else {
            img.unlockFocus()
            return img
        }
        ctx.translateBy(x: 0, y: size.height)
        ctx.scaleBy(x: 1, y: -1)

        let pelvisRect = CGRect(x: 36, y: 18, width: 288, height: 140)
        let path = CGPath(roundedRect: pelvisRect, cornerWidth: 58, cornerHeight: 58, transform: nil)
        ctx.setFillColor(NSColor(calibratedRed: 0.18, green: 0.25, blue: 0.34, alpha: 1.0).cgColor)
        ctx.setStrokeColor(NSColor.white.withAlphaComponent(0.22).cgColor)
        ctx.setLineWidth(4)
        ctx.addPath(path)
        ctx.drawPath(using: .fillStroke)

        ctx.setFillColor(NSColor(calibratedRed: 0.22, green: 0.16, blue: 0.12, alpha: 1.0).cgColor)
        ctx.fill(CGRect(x: 48, y: 26, width: 264, height: 22))
        ctx.setFillColor(NSColor(calibratedRed: 0.85, green: 0.72, blue: 0.30, alpha: 1.0).cgColor)
        ctx.fill(CGRect(x: 162, y: 24, width: 36, height: 26))

        img.unlockFocus()
        return img
    }

    private static func makeDemoLimbImage(topColor: NSColor, bottomColor: NSColor, width: CGFloat) -> NSImage {
        let size = NSSize(width: 140, height: 260)
        let img = NSImage(size: size)
        img.lockFocus()
        guard let ctx = NSGraphicsContext.current?.cgContext else {
            img.unlockFocus()
            return img
        }
        ctx.translateBy(x: 0, y: size.height)
        ctx.scaleBy(x: 1, y: -1)

        let x = (size.width - width) * 0.5
        let limbRect = CGRect(x: x, y: 14, width: width, height: 232)
        let path = CGPath(roundedRect: limbRect, cornerWidth: width * 0.48, cornerHeight: width * 0.48, transform: nil)

        ctx.saveGState()
        ctx.addPath(path)
        ctx.clip()
        ctx.setFillColor(topColor.cgColor)
        ctx.fill(CGRect(x: x, y: 14, width: width, height: 120))
        ctx.setFillColor(bottomColor.cgColor)
        ctx.fill(CGRect(x: x, y: 134, width: width, height: 112))
        ctx.restoreGState()

        ctx.setStrokeColor(NSColor(calibratedRed: 0.16, green: 0.14, blue: 0.12, alpha: 0.85).cgColor)
        ctx.setLineWidth(4)
        ctx.addPath(path)
        ctx.strokePath()

        img.unlockFocus()
        return img
    }

    private static func makeDemoShinWithShoeImage(isLeft: Bool) -> NSImage {
        let size = NSSize(width: 160, height: 280)
        let img = NSImage(size: size)
        img.lockFocus()
        guard let ctx = NSGraphicsContext.current?.cgContext else {
            img.unlockFocus()
            return img
        }
        ctx.translateBy(x: 0, y: size.height)
        ctx.scaleBy(x: 1, y: -1)

        let shinRect = CGRect(x: 48, y: 14, width: 64, height: 210)
        let shinPath = CGPath(roundedRect: shinRect, cornerWidth: 30, cornerHeight: 30, transform: nil)
        ctx.setFillColor(NSColor(calibratedRed: 0.18, green: 0.25, blue: 0.34, alpha: 1.0).cgColor)
        ctx.setStrokeColor(NSColor(calibratedRed: 0.12, green: 0.14, blue: 0.18, alpha: 0.9).cgColor)
        ctx.setLineWidth(4)
        ctx.addPath(shinPath)
        ctx.drawPath(using: .fillStroke)

        let shoeX: CGFloat = isLeft ? 28 : 42
        let shoeRect = CGRect(x: shoeX, y: 212, width: 90, height: 48)
        let shoePath = CGPath(roundedRect: shoeRect, cornerWidth: 22, cornerHeight: 22, transform: nil)
        ctx.setFillColor(NSColor(calibratedRed: 0.20, green: 0.68, blue: 0.62, alpha: 1.0).cgColor)
        ctx.addPath(shoePath)
        ctx.drawPath(using: .fillStroke)

        img.unlockFocus()
        return img
    }

    private static func makeDemoHandImage(isLeft: Bool) -> NSImage {
        let size = NSSize(width: 256, height: 256)
        let img = NSImage(size: size)
        img.lockFocus()
        guard let ctx = NSGraphicsContext.current?.cgContext else {
            img.unlockFocus()
            return img
        }
        // Standard top-down orientation (wrist at top, fingers pointing downward) matching Paper Puppet Sheets.
        // In the base drawing below, the thumb is on the LEFT (outer for Left hand at rest; inner when raised 180°).
        // Flip horizontally for Right hand (!isLeft) so thumbs stay mirror-symmetric on both hands.
        if !isLeft {
            ctx.translateBy(x: size.width, y: 0)
            ctx.scaleBy(x: -1, y: 1)
        }

        let skin = NSColor(calibratedRed: 0.95, green: 0.78, blue: 0.64, alpha: 1.0).cgColor
        let outline = NSColor(calibratedRed: 0.22, green: 0.18, blue: 0.16, alpha: 0.9).cgColor
        ctx.setFillColor(skin)
        ctx.setStrokeColor(outline)
        ctx.setLineWidth(5)

        // Note: NSGraphicsContext without vertical flip has y=0 at bottom -> fingers at low y point downward!
        let fingers: [CGRect] = [
            CGRect(x: 62, y: 38, width: 26, height: 95),
            CGRect(x: 96, y: 24, width: 28, height: 108),
            CGRect(x: 132, y: 32, width: 26, height: 100),
            CGRect(x: 165, y: 52, width: 24, height: 84),
            CGRect(x: 28, y: 105, width: 52, height: 28)
        ]
        for r in fingers {
            let fp = CGPath(roundedRect: r, cornerWidth: 12, cornerHeight: 12, transform: nil)
            ctx.addPath(fp)
            ctx.drawPath(using: .fillStroke)
        }

        let palm = CGPath(roundedRect: CGRect(x: 58, y: 108, width: 132, height: 112), cornerWidth: 42, cornerHeight: 42, transform: nil)
        ctx.addPath(palm)
        ctx.drawPath(using: .fillStroke)

        img.unlockFocus()
        return img
    }

    public func assignCroppedSheetPart(slot: PuppetPartSlot, image: NSImage, name: String) {
        setCustomPartImage(image, label: name, for: slot)
        // Reset pins to known anatomical defaults for this slot
        let defaults = Self.defaultPins(for: activePreset)[slot] ?? []
        pinsBySlot[slot] = defaults
        saveCurrentPresetState()
    }
}

// MARK: - Paper Puppet Sheet Auto-Slicer & Designer / AI Guide

public struct PuppetSheetIsland: Identifiable {
    public let id: Int
    /// Normalized 0..1 bounding box in top-left UV coordinates
    public let normalizedRect: CGRect
    /// Cropped transparent NSImage of this isolated body part
    public let croppedImage: NSImage
}

public enum PuppetSheetSlicer {
    public static let standardRiggingSlotSequence: [PuppetPartSlot] = [
        .head,
        .torso,
        .pelvis,
        .leftUpperArm,
        .leftForearm,
        .leftHand,
        .rightUpperArm,
        .rightForearm,
        .rightHand,
        .leftThigh,
        .leftShin,
        .leftFoot,
        .rightThigh,
        .rightShin,
        .rightFoot,
        .eyesOpen,
        .rightEyeOpen,
        .eyesClosed,
        .rightEyeClosed,
        .browsOverlay,
        .rightBrows,
        .noseOverlay,
        .mouthNeutral,
        .mouthAh,
        .mouthOh,
        .mouthSmile,
        .tail
    ]

    /// Crop a custom user-drawn rectangular island from the sheet
    public static func cropCustomIsland(
        from sourceImage: NSImage,
        normalizedRect: CGRect,
        id: Int
    ) -> PuppetSheetIsland? {
        guard let cg = sourceImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return nil }
        let imgW = CGFloat(cg.width)
        let imgH = CGFloat(cg.height)
        let pixelRect = CGRect(
            x: max(0, normalizedRect.minX * imgW),
            y: max(0, normalizedRect.minY * imgH),
            width: min(imgW, normalizedRect.width * imgW),
            height: min(imgH, normalizedRect.height * imgH)
        )
        guard pixelRect.width >= 4, pixelRect.height >= 4,
              let croppedCG = cg.cropping(to: pixelRect) else { return nil }
        let croppedNS = NSImage(cgImage: croppedCG, size: NSSize(width: pixelRect.width, height: pixelRect.height))
        return PuppetSheetIsland(
            id: id,
            normalizedRect: normalizedRect,
            croppedImage: croppedNS
        )
    }

    /// Export all detected cut-out pieces as high-res PNG files named cleanly after the character and body parts
    public static func exportIslands(
        _ islands: [PuppetSheetIsland],
        to destinationDirectory: URL,
        characterName: String = "Character",
        mappedSlotNames: [Int: String] = [:]
    ) throws -> Int {
        var count = 0
        let cleanChar = characterName.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: " ", with: "_")
        let prefix = cleanChar.isEmpty ? "Character" : cleanChar
        for island in islands {
            let baseName: String
            if let slotName = mappedSlotNames[island.id], !slotName.isEmpty {
                baseName = "\(prefix)_\(slotName)"
            } else {
                baseName = "\(prefix)_part\(island.id)"
            }
            let safeName = baseName.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: " ", with: "_")
            let fileURL = destinationDirectory.appendingPathComponent("\(safeName).png")
            if let tiff = island.croppedImage.tiffRepresentation,
               let rep = NSBitmapImageRep(data: tiff),
               let png = rep.representation(using: .png, properties: [:]) {
                try png.write(to: fileURL, options: .atomic)
                count += 1
            }
        }
        return count
    }

    public static let designerAndAIPrompt: String = """
    Disassembled 2D Character Sprite Sheet (Cut-Out Puppet & Knolling Parts Diagram)
    Create a disassembled 2D character sprite sheet laid out like a model-kit or traditional papercraft puppet on a clean, solid, high-contrast background (such as solid Chroma Green #00FF00, Magenta #FF00FF, or solid Black #000000).
    Every body part must float completely isolated and detached from one another with generous empty space.

    CRITICAL ART & LAYOUT RULES:
    1. ZERO TEXT / NO LABELS: Absolute prohibition on text, letters, words, numbers, anatomical tags, titles, captions, watermarks, scissors icons, or dashed cut-lines. The sheet must contain ONLY clean character artwork.
    2. WIDE MARGINS / NO TOUCHING: Leave at least 60 to 80 pixels of solid background space between every single piece. No body parts should touch, overlap, or sit on tangent edges so every part can be cleanly auto-sliced.
    3. ROUNDED JOINT CAPS: Every limb joint (shoulders, elbows, wrists, hips, knees, ankles) must have generous convex rounded circular caps (like wooden mannequin or brass-fastener joints) so parts rotate smoothly without revealing flat cuts or leaving open gaps.
    4. THREE-PART SEPARATED LEGS: Each leg must be 3 completely independent, vertical segments:
       - Thigh / Upper Leg (rounded hip cap down to rounded knee cap)
       - Shin / Lower Leg (rounded knee cap down to rounded ankle cap)
       - Foot / Shoe / Boot / Paw (oriented horizontally level with ground; Left foot pointing left, Right foot pointing right)
    5. DETACHED PELVIS / HIPS: The Pelvis / Waist is an independent piece separate from both the Torso and the Thighs.
    6. BLANK HEAD BASE + SEPARATE FACIAL FEATURES:
       - Head: Neutral head base with ears and hair, but with a BLANK face (no eyes and no mouth baked into the main head).
       - Left Eyebrow & Right Eyebrow: Two separate expressive eyebrow sprites.
       - Eyes: Separate Left & Right Open Eyes, and separate Left & Right Closed / Winking Eyes.
       - Nose: Separate nose sprite for 2.5D head turn parallax.
       - Mouth Visemes: 4 separate mouth variations in a neat row: Neutral Closed (M/B/P), Open Ah, Round Oh/Ooo, Wide Smile (Ee).
    7. VERTICAL LIMB ORIENTATION: Draw all arms and legs pointing straight vertically (top to bottom):
       - Torso + Neck (single piece extending up from collar)
       - Pelvis / Hips (separate piece connecting torso to thighs)
       - Left Upper Arm, Left Forearm, Left Hand (3 vertical, detached pieces)
       - Right Upper Arm, Right Forearm, Right Hand (3 vertical, detached pieces)
       - Left Thigh, Left Shin, Left Foot (3 vertical, detached pieces)
       - Right Thigh, Right Shin, Right Foot (3 vertical, detached pieces)
       - Tail / Prop (if animal, mascot, or accessory)
    Edge Quality: Clean, sharp contours, consistent directional lighting, no drop shadows or ambient glow bleeding onto the background.
    """

    /// Detects separated body-part islands on a Paper Puppet Sheet (automatically removing solid corner backgrounds if present).
    public static func detectIslands(in sourceImage: NSImage, removeSolidBackground: Bool = true, tolerance: CGFloat = 0.08) -> (processedSheet: NSImage, islands: [PuppetSheetIsland]) {
        guard let cgImage = sourceImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            return (sourceImage, [])
        }

        let width = cgImage.width
        let height = cgImage.height
        guard width > 16, height > 16 else { return (sourceImage, []) }

        let bytesPerPixel = 4
        let bytesPerRow = width * bytesPerPixel
        var pixels = [UInt8](repeating: 0, count: width * height * bytesPerPixel)

        guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(
                data: &pixels,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: bytesPerRow,
                space: colorSpace,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
              ) else {
            return (sourceImage, [])
        }

        ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

        // Sample the 4 corners to see if the sheet has an opaque solid background (e.g. from an AI image generator)
        let cornerCoords = [(2, 2), (width - 3, 2), (2, height - 3), (width - 3, height - 3)]
        var cornerR: CGFloat = 0
        var cornerG: CGFloat = 0
        var cornerB: CGFloat = 0
        var cornerA: CGFloat = 0
        for (cx, cy) in cornerCoords {
            let idx = (cy * width + cx) * 4
            cornerR += CGFloat(pixels[idx]) / 255.0
            cornerG += CGFloat(pixels[idx + 1]) / 255.0
            cornerB += CGFloat(pixels[idx + 2]) / 255.0
            cornerA += CGFloat(pixels[idx + 3]) / 255.0
        }
        cornerR /= 4.0; cornerG /= 4.0; cornerB /= 4.0; cornerA /= 4.0

        let hasOpaqueBackground = removeSolidBackground && (cornerA > 0.50)
        let distThreshold = tolerance * 1.75

        if hasOpaqueBackground {
            // Contiguous Perimeter Flood Fill:
            // Only erase pixels connected to the outside boundary of the sheet.
            // Pixels enclosed inside character body contours (pupils, dark boots, armor, shading)
            // will NEVER be reached or cleared!
            var visited = [Bool](repeating: false, count: width * height)
            var queueX = [Int]()
            var queueY = [Int]()
            queueX.reserveCapacity(width * 2 + height * 2)
            queueY.reserveCapacity(width * 2 + height * 2)

            func testAndEnqueue(_ x: Int, _ y: Int) {
                let idx = y * width + x
                if visited[idx] { return }
                visited[idx] = true
                let pIdx = idx * 4
                let a = CGFloat(pixels[pIdx + 3]) / 255.0
                if a < 0.05 {
                    queueX.append(x)
                    queueY.append(y)
                    return
                }
                let r = CGFloat(pixels[pIdx]) / 255.0
                let g = CGFloat(pixels[pIdx + 1]) / 255.0
                let b = CGFloat(pixels[pIdx + 2]) / 255.0
                let dist = sqrt((r - cornerR) * (r - cornerR) + (g - cornerG) * (g - cornerG) + (b - cornerB) * (b - cornerB))
                if dist < distThreshold {
                    queueX.append(x)
                    queueY.append(y)
                }
            }

            for x in 0..<width {
                testAndEnqueue(x, 0)
                testAndEnqueue(x, height - 1)
            }
            for y in 0..<height {
                testAndEnqueue(0, y)
                testAndEnqueue(width - 1, y)
            }

            var head = 0
            while head < queueX.count {
                let cx = queueX[head]
                let cy = queueY[head]
                head += 1

                let pIdx = (cy * width + cx) * 4
                pixels[pIdx] = 0
                pixels[pIdx + 1] = 0
                pixels[pIdx + 2] = 0
                pixels[pIdx + 3] = 0

                if cx > 0 { testAndEnqueue(cx - 1, cy) }
                if cx < width - 1 { testAndEnqueue(cx + 1, cy) }
                if cy > 0 { testAndEnqueue(cx, cy - 1) }
                if cy < height - 1 { testAndEnqueue(cx, cy + 1) }
            }
        }

        let processedCG = ctx.makeImage() ?? cgImage
        let processedSheet = NSImage(cgImage: processedCG, size: NSSize(width: width, height: height))

        // Downsample occupancy grid for fast connected-component island labeling
        let gridW = min(280, width)
        let gridH = min(280, height)
        var occupied = [Bool](repeating: false, count: gridW * gridH)

        for gy in 0..<gridH {
            let pyStart = (gy * height) / gridH
            let pyEnd = max(pyStart + 1, ((gy + 1) * height) / gridH)
            for gx in 0..<gridW {
                let pxStart = (gx * width) / gridW
                let pxEnd = max(pxStart + 1, ((gx + 1) * width) / gridW)
                var foundAlpha = false
                outerLoop: for py in stride(from: pyStart, to: pyEnd, by: max(1, (pyEnd - pyStart) / 2)) {
                    for px in stride(from: pxStart, to: pxEnd, by: max(1, (pxEnd - pxStart) / 2)) {
                        let a = pixels[(py * width + px) * 4 + 3]
                        if a > 28 {
                            foundAlpha = true
                            break outerLoop
                        }
                    }
                }
                occupied[gy * gridW + gx] = foundAlpha
            }
        }

        var visited = [Bool](repeating: false, count: gridW * gridH)
        var islands: [PuppetSheetIsland] = []
        var nextId = 1

        for gy in 0..<gridH {
            for gx in 0..<gridW {
                let startIdx = gy * gridW + gx
                guard occupied[startIdx], !visited[startIdx] else { continue }

                var queue: [(Int, Int)] = [(gx, gy)]
                visited[startIdx] = true
                var head = 0
                var minGX = gx, maxGX = gx
                var minGY = gy, maxGY = gy
                var cellCount = 0

                while head < queue.count {
                    let (cx, cy) = queue[head]
                    head += 1
                    cellCount += 1
                    if cx < minGX { minGX = cx }
                    if cx > maxGX { maxGX = cx }
                    if cy < minGY { minGY = cy }
                    if cy > maxGY { maxGY = cy }

                    for dy in -2...2 {
                        for dx in -2...2 {
                            let nx = cx + dx
                            let ny = cy + dy
                            if nx >= 0, nx < gridW, ny >= 0, ny < gridH {
                                let nIdx = ny * gridW + nx
                                if occupied[nIdx], !visited[nIdx] {
                                    visited[nIdx] = true
                                    queue.append((nx, ny))
                                }
                            }
                        }
                    }
                }

                // Filter out tiny speck noise
                guard cellCount >= 5 else { continue }

                let padX = max(2, width / 160)
                let padY = max(2, height / 160)
                let px0 = max(0, (minGX * width) / gridW - padX)
                let py0 = max(0, (minGY * height) / gridH - padY)
                let px1 = min(width, ((maxGX + 1) * width) / gridW + padX)
                let py1 = min(height, ((maxGY + 1) * height) / gridH + padY)
                let cropW = px1 - px0
                let cropH = py1 - py0
                guard cropW >= 8, cropH >= 8 else { continue }

                let cropRect = CGRect(x: px0, y: py0, width: cropW, height: cropH)
                if let subCG = processedCG.cropping(to: cropRect) {
                    let croppedNS = NSImage(cgImage: subCG, size: NSSize(width: cropW, height: cropH))
                    let normRect = CGRect(
                        x: CGFloat(px0) / CGFloat(width),
                        y: CGFloat(py0) / CGFloat(height),
                        width: CGFloat(cropW) / CGFloat(width),
                        height: CGFloat(cropH) / CGFloat(height)
                    )
                    islands.append(PuppetSheetIsland(id: nextId, normalizedRect: normRect, croppedImage: croppedNS))
                    nextId += 1
                }
            }
        }

        return (processedSheet, islands)
    }

    /// Builds a visual example of a traditional Paper Puppet Sheet using ALL active parts of the current character
    /// (including closed eyes, brows, all mouth visemes, pelvis, and 3-part legs) so every part is visible and exportable.
    public static func makeExamplePuppetSheet(from puppet: PuppetController) -> NSImage {
        let size = NSSize(width: 1360, height: 920)
        let img = NSImage(size: size)
        img.lockFocus()
        guard let ctx = NSGraphicsContext.current?.cgContext else {
            img.unlockFocus()
            return img
        }

        // Slots defined in intuitive top-down coordinates (topY measured downward from top edge of sheet)
        let slotsAndTopRects: [(PuppetPartSlot, CGRect)] = [
            // Far-left column: Left Leg (Thigh, Shin, Foot) & Tail
            (.leftThigh, CGRect(x: 40, y: 40, width: 125, height: 220)),
            (.leftShin, CGRect(x: 40, y: 290, width: 125, height: 220)),
            (.leftFoot, CGRect(x: 40, y: 540, width: 125, height: 130)),
            (.tail, CGRect(x: 40, y: 700, width: 125, height: 185)),

            // Inner-left column: Left Arm (Upper, Forearm, Hand)
            (.leftUpperArm, CGRect(x: 210, y: 40, width: 130, height: 220)),
            (.leftForearm, CGRect(x: 210, y: 290, width: 130, height: 210)),
            (.leftHand, CGRect(x: 210, y: 530, width: 120, height: 130)),

            // Center column: Head, Torso, Pelvis
            (.head, CGRect(x: 395, y: 30, width: 300, height: 300)),
            (.torso, CGRect(x: 415, y: 365, width: 260, height: 310)),
            (.pelvis, CGRect(x: 430, y: 710, width: 230, height: 175)),

            // Inner-right column: Right Arm (Upper, Forearm, Hand)
            (.rightUpperArm, CGRect(x: 740, y: 40, width: 135, height: 220)),
            (.rightForearm, CGRect(x: 740, y: 290, width: 135, height: 210)),
            (.rightHand, CGRect(x: 740, y: 530, width: 125, height: 130)),

            // Outer-right column: Right Leg (Thigh, Shin, Foot)
            (.rightThigh, CGRect(x: 915, y: 40, width: 125, height: 220)),
            (.rightShin, CGRect(x: 915, y: 290, width: 125, height: 220)),
            (.rightFoot, CGRect(x: 915, y: 540, width: 125, height: 130)),

            // Far-right expression columns: Open Eyes, Closed Eyes, Brows, Nose, Mouth Visemes
            (.eyesOpen, CGRect(x: 1090, y: 40, width: 105, height: 80)),
            (.rightEyeOpen, CGRect(x: 1225, y: 40, width: 105, height: 80)),
            (.eyesClosed, CGRect(x: 1090, y: 150, width: 105, height: 80)),
            (.rightEyeClosed, CGRect(x: 1225, y: 150, width: 105, height: 80)),
            (.browsOverlay, CGRect(x: 1090, y: 260, width: 105, height: 65)),
            (.rightBrows, CGRect(x: 1225, y: 260, width: 105, height: 65)),
            (.noseOverlay, CGRect(x: 1145, y: 355, width: 115, height: 85)),
            (.mouthNeutral, CGRect(x: 1090, y: 470, width: 105, height: 80)),
            (.mouthAh, CGRect(x: 1225, y: 470, width: 105, height: 80)),
            (.mouthOh, CGRect(x: 1090, y: 580, width: 105, height: 80)),
            (.mouthSmile, CGRect(x: 1225, y: 580, width: 105, height: 80))
        ]

        for (slot, topRect) in slotsAndTopRects {
            guard puppet.partEnabled[slot] != false,
                  let partImg = puppet.partImages[slot],
                  let cg = partImg.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
            let targetRect = CGRect(
                x: topRect.minX,
                y: size.height - topRect.maxY,
                width: topRect.width,
                height: topRect.height
            )
            let aspect = partImg.size.width / max(1, partImg.size.height)
            var drawW = targetRect.width
            var drawH = drawW / aspect
            if drawH > targetRect.height {
                drawH = targetRect.height
                drawW = drawH * aspect
            }
            let drawRect = CGRect(
                x: targetRect.midX - drawW * 0.5,
                y: targetRect.midY - drawH * 0.5,
                width: drawW,
                height: drawH
            )
            ctx.draw(cg, in: drawRect)
        }

        img.unlockFocus()
        return img
    }
}
