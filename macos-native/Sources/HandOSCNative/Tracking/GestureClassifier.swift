import Foundation
import Vision

public enum GestureClassifier {
    @inline(__always)
    public static func distance(_ a: Landmark, _ b: Landmark) -> Float {
        let dx = a.x - b.x
        let dy = a.y - b.y
        let dz = a.z - b.z
        return sqrt(dx * dx + dy * dy + dz * dz)
    }

    /// Continuous pinch amount (0 = fully pinched, 1 = open), matching src/lib/gestures.ts
    public static func pinchAmount(_ lm: [Landmark]) -> Float {
        guard lm.count >= 21 else { return 0 }
        let palmSize = distance(lm[0], lm[9])
        let d = distance(lm[4], lm[8]) / max(palmSize, 1e-6)
        return max(0, min(1, d / 1.2))
    }

    public struct FingerState: Sendable, Equatable {
        public var thumbCurl: Float = 0   // 0 = straight/open, 1 = curled
        public var indexCurl: Float = 0
        public var middleCurl: Float = 0
        public var ringCurl: Float = 0
        public var pinkyCurl: Float = 0
        public var pinchAmount: Float = 1.0 // 0 = pinched touching, 1 = open
        public var averageCurl: Float = 0

        public init(
            thumbCurl: Float = 0,
            indexCurl: Float = 0,
            middleCurl: Float = 0,
            ringCurl: Float = 0,
            pinkyCurl: Float = 0,
            pinchAmount: Float = 1.0,
            averageCurl: Float = 0
        ) {
            self.thumbCurl = thumbCurl
            self.indexCurl = indexCurl
            self.middleCurl = middleCurl
            self.ringCurl = ringCurl
            self.pinkyCurl = pinkyCurl
            self.pinchAmount = pinchAmount
            self.averageCurl = averageCurl
        }
    }

    /// Evaluates per-finger curl ratio (0 = extended, 1 = curled into fist) from 21 hand landmarks
    public static func fingerState(_ lm: [Landmark]) -> FingerState {
        guard lm.count >= 21 else { return FingerState() }

        func curlRatio(mcp: Int, pip: Int, dip: Int, tip: Int) -> Float {
            let totalBoneLen = distance(lm[mcp], lm[pip]) + distance(lm[pip], lm[dip]) + distance(lm[dip], lm[tip])
            let directSpan = distance(lm[mcp], lm[tip])
            let ratio = directSpan / max(totalBoneLen, 1e-4)
            // ratio ~ 0.94-1.0 when straight, ~ 0.38-0.45 when curled
            let c = (0.92 - ratio) / 0.50
            return max(0.0, min(1.0, c))
        }

        func thumbCurlRatio() -> Float {
            let totalLen = distance(lm[1], lm[2]) + distance(lm[2], lm[3]) + distance(lm[3], lm[4])
            let directSpan = distance(lm[1], lm[4])
            let ratio = directSpan / max(totalLen, 1e-4)
            let c = (0.90 - ratio) / 0.45
            return max(0.0, min(1.0, c))
        }

        let tc = thumbCurlRatio()
        let ic = curlRatio(mcp: 5, pip: 6, dip: 7, tip: 8)
        let mc = curlRatio(mcp: 9, pip: 10, dip: 11, tip: 12)
        let rc = curlRatio(mcp: 13, pip: 14, dip: 15, tip: 16)
        let pc = curlRatio(mcp: 17, pip: 18, dip: 19, tip: 20)
        let pinch = pinchAmount(lm)
        let avg = (tc + ic + mc + rc + pc) / 5.0

        return FingerState(
            thumbCurl: tc,
            indexCurl: ic,
            middleCurl: mc,
            ringCurl: rc,
            pinkyCurl: pc,
            pinchAmount: pinch,
            averageCurl: avg
        )
    }

    /// Wrist orientation angle in radians (from wrist 0 to middle finger MCP 9)
    public static func wristAngle(_ lm: [Landmark]) -> Float {
        guard lm.count >= 10 else { return 0 }
        let dx = lm[9].x - lm[0].x
        let dy = lm[9].y - lm[0].y
        // Straight up (dx=0, dy<0) -> 0 radians
        return atan2(dx, -dy)
    }

    /// Relative hand depth scale based on apparent size in camera frame (1.0 = normal distance, >1 = closer to camera)
    public static func handDepthScale(_ lm: [Landmark]) -> Float {
        guard lm.count >= 18 else { return 1.0 }
        let palmLen = distance(lm[0], lm[9])
        let knuckleWidth = distance(lm[5], lm[17])
        let apparent = palmLen * 0.65 + knuckleWidth * 0.35
        // Typical neutral apparent hand size at arm/desk distance is ~0.115
        let ratio = apparent / 0.115
        return max(0.50, min(2.40, ratio))
    }

    /// Rotation-invariant 3D palm orientation in [-1, 1]:
    /// +1.0 = open palm facing camera (thumb on inner side toward body),
    /// -1.0 = back of hand facing camera (thumb flipped to outer side)
    public static func palmFacingSign(_ lm: [Landmark], screenLabel: String, mirror: Bool) -> Float {
        guard lm.count >= 18 else { return 1.0 }
        func sx(_ idx: Int) -> Float { mirror ? (1.0 - lm[idx].x) : lm[idx].x }
        func sy(_ idx: Int) -> Float { lm[idx].y }

        // Vector u along the hand from wrist (0) to middle knuckle (9)
        let ux = sx(9) - sx(0)
        let uy = sy(9) - sy(0)
        // Vector v from pinky knuckle (17) toward index knuckle (5) & thumb base (2)
        let thumbIndexX = (sx(5) + sx(2)) * 0.5
        let thumbIndexY = (sy(5) + sy(2)) * 0.5
        let vx = thumbIndexX - sx(17)
        let vy = thumbIndexY - sy(17)

        let uLenSq = max(ux * ux + uy * uy, 1e-5)
        // 2D cross product (-uy * vx + ux * vy) is > 0 when thumb/index are on the RIGHT side of the finger axis
        // (as on a Left open palm in a mirrored camera) and < 0 when thumb/index are on the LEFT side.
        let thumbOnRightScore = (-uy * vx + ux * vy) / (uLenSq * 0.36)
        let signed = (screenLabel == "L") ? thumbOnRightScore : -thumbOnRightScore
        return max(-1.0, min(1.0, signed))
    }

    /// Classifies the 21 hand landmarks into MediaPipe-compatible gesture labels:
    /// "None" | "Closed_Fist" | "Open_Palm" | "Pointing_Up" | "Thumb_Down" | "Thumb_Up" | "Victory" | "ILoveYou"
    public static func classify(_ lm: [Landmark]) -> (name: String, score: Float) {
        guard lm.count >= 21 else { return ("None", 0) }
        let wrist = lm[0]
        let palmSize = max(distance(wrist, lm[9]), 1e-5)

        func isFingerExtended(mcp: Int, pip: Int, tip: Int) -> Bool {
            let tipToWrist = distance(wrist, lm[tip])
            let pipToWrist = distance(wrist, lm[pip])
            let mcpToWrist = distance(wrist, lm[mcp])
            let tipToMcp = distance(lm[mcp], lm[tip])
            let pipToMcp = distance(lm[mcp], lm[pip])
            return (tipToWrist > pipToWrist && tipToWrist > mcpToWrist * 1.15) || (tipToMcp > pipToMcp * 1.25)
        }

        func isThumbExtended() -> Bool {
            let tipToWrist = distance(wrist, lm[4])
            let mpToWrist = distance(wrist, lm[2])
            let tipToPinky = distance(lm[4], lm[17])
            return (tipToWrist > mpToWrist * 1.15) && (tipToPinky > palmSize * 0.45)
        }

        let indexExt = isFingerExtended(mcp: 5, pip: 6, tip: 8)
        let middleExt = isFingerExtended(mcp: 9, pip: 10, tip: 12)
        let ringExt = isFingerExtended(mcp: 13, pip: 14, tip: 16)
        let pinkyExt = isFingerExtended(mcp: 17, pip: 18, tip: 20)
        let thumbExt = isThumbExtended()

        let thumbDy = lm[4].y - lm[2].y

        if indexExt && middleExt && ringExt && pinkyExt && thumbExt {
            return ("Open_Palm", 0.95)
        }
        if indexExt && middleExt && ringExt && pinkyExt && !thumbExt {
            return ("Open_Palm", 0.90)
        }
        if !indexExt && !middleExt && !ringExt && !pinkyExt {
            if thumbExt {
                if thumbDy < -0.04 * palmSize {
                    return ("Thumb_Up", 0.92)
                } else if thumbDy > 0.04 * palmSize {
                    return ("Thumb_Down", 0.90)
                }
            }
            return ("Closed_Fist", 0.92)
        }
        if indexExt && !middleExt && !ringExt && pinkyExt && thumbExt {
            return ("ILoveYou", 0.92)
        }
        if indexExt && middleExt && !ringExt && !pinkyExt {
            return ("Victory", 0.92)
        }
        if indexExt && !middleExt && !ringExt && !pinkyExt {
            return ("Pointing_Up", 0.92)
        }

        return ("None", 0.0)
    }

    // MARK: - Glasses & Beard Resilient Face Analysis

    public struct RawFaceMeasurements: Sendable {
        public var anchorX: Float
        public var anchorY: Float
        public var interOcularDist: Float
        public var roll: Float
        public var yaw: Float
        public var pitch: Float
        public var mouthOpenRatio: Float
        public var mouthWidthRatio: Float
        public var browEyeRatio: Float
        public var browEyeRatioL: Float
        public var browEyeRatioR: Float
        public var eyeAspectL: Float
        public var eyeAspectR: Float
        public var keyPoints: [String: Landmark]
    }

    /// Extracts skull-referenced (inter-ocular normalized) measurements that ignore beard/jaw noise
    public static func measureFace(
        observation faceObs: VNFaceObservation,
        landmarks face: VNFaceLandmarks2D,
        mirror: Bool
    ) -> RawFaceMeasurements {
        let bbox = faceObs.boundingBox

        func toImagePoint(_ pt: CGPoint) -> CGPoint {
            let ix = bbox.origin.x + pt.x * bbox.size.width
            let iy = bbox.origin.y + pt.y * bbox.size.height
            let mx = mirror ? (1.0 - ix) : ix
            return CGPoint(x: mx, y: 1.0 - iy) // top-left 0..1 space
        }

        func regionStats(_ r: VNFaceLandmarkRegion2D?) -> (width: Float, height: Float, center: CGPoint, top: CGPoint, bottom: CGPoint)? {
            guard let r = r, r.pointCount > 0 else { return nil }
            let pts = r.normalizedPoints.map { toImagePoint($0) }
            var minX = pts[0].x, maxX = pts[0].x
            var minY = pts[0].y, maxY = pts[0].y
            var topPt = pts[0], bottomPt = pts[0]
            var sumX: CGFloat = 0, sumY: CGFloat = 0
            for p in pts {
                if p.x < minX { minX = p.x }
                if p.x > maxX { maxX = p.x }
                if p.y < minY { minY = p.y; topPt = p }
                if p.y > maxY { maxY = p.y; bottomPt = p }
                sumX += p.x
                sumY += p.y
            }
            let c = CGPoint(x: sumX / CGFloat(pts.count), y: sumY / CGFloat(pts.count))
            return (Float(maxX - minX), Float(maxY - minY), c, topPt, bottomPt)
        }

        let lEye = regionStats(face.leftEye)
        let rEye = regionStats(face.rightEye)
        let lBrow = regionStats(face.leftEyebrow)
        let rBrow = regionStats(face.rightEyebrow)
        let nose = regionStats(face.nose)
        let innerLips = regionStats(face.innerLips)
        let outerLips = regionStats(face.outerLips)

        // Screen-left and screen-right eyes after mirroring
        let eyeA = lEye?.center ?? CGPoint(x: 0.42, y: 0.45)
        let eyeB = rEye?.center ?? CGPoint(x: 0.58, y: 0.45)
        let aIsScreenLeft = (eyeA.x <= eyeB.x)
        let screenLeftEye = aIsScreenLeft ? eyeA : eyeB
        let screenRightEye = aIsScreenLeft ? eyeB : eyeA

        let eyeMid = CGPoint(
            x: (screenLeftEye.x + screenRightEye.x) * 0.5,
            y: (screenLeftEye.y + screenRightEye.y) * 0.5
        )
        let iod = max(Float(hypot(screenRightEye.x - screenLeftEye.x, screenRightEye.y - screenLeftEye.y)), 0.03)

        // Eye-line tilt (roll) in aspect-corrected 16:9 camera space — completely unaffected by beard!
        let camAspect: CGFloat = 16.0 / 9.0
        let eyeRoll = Float(atan2(screenRightEye.y - screenLeftEye.y, (screenRightEye.x - screenLeftEye.x) * camAspect))

        // Aspect-corrected, tilt-compensated Eye Aspect Ratio (EAR) so head tilt or 16:9 coordinates never distort eye height
        func rotatedEyeAspectRatio(_ r: VNFaceLandmarkRegion2D?) -> Float {
            guard let r = r, r.pointCount >= 4 else { return 0.25 }
            let pts = r.normalizedPoints.map { pt -> CGPoint in
                let p = toImagePoint(pt)
                return CGPoint(x: p.x * camAspect, y: p.y)
            }
            let cosR = CGFloat(cos(-eyeRoll))
            let sinR = CGFloat(sin(-eyeRoll))
            var minX = CGFloat.greatestFiniteMagnitude
            var maxX = -CGFloat.greatestFiniteMagnitude
            var minY = CGFloat.greatestFiniteMagnitude
            var maxY = -CGFloat.greatestFiniteMagnitude
            for p in pts {
                let rx = p.x * cosR - p.y * sinR
                let ry = p.x * sinR + p.y * cosR
                if rx < minX { minX = rx }
                if rx > maxX { maxX = rx }
                if ry < minY { minY = ry }
                if ry > maxY { maxY = ry }
            }
            let w = Float(maxX - minX)
            let h = Float(maxY - minY)
            guard w > 1e-4 else { return 0.25 }
            return h / w
        }

        let earA = rotatedEyeAspectRatio(face.leftEye)
        let earB = rotatedEyeAspectRatio(face.rightEye)
        // Match screen-left and screen-right eyes after mirroring
        let earL = aIsScreenLeft ? earA : earB
        let earR = aIsScreenLeft ? earB : earA

        // Nose tip / center
        let noseCenter = nose?.bottom ?? nose?.center ?? CGPoint(x: eyeMid.x, y: eyeMid.y + CGFloat(iod * 0.6))

        // Yaw & Pitch from nose position relative to eye midpoint + Vision pose
        let geomYaw = Float(noseCenter.x - eyeMid.x) / iod * 2.2
        let visionYaw: Float = {
            guard let y = faceObs.yaw?.floatValue else { return geomYaw }
            return mirror ? -y : y
        }()
        let combinedYaw = visionYaw * 0.6 + geomYaw * 0.4

        let noseEyeVert = Float(noseCenter.y - eyeMid.y) / iod
        let geomPitch = (noseEyeVert - 0.58) * 2.5

        // Mouth measurements normalized by Inter-Ocular Distance (IOD)
        let mouthOpenH = innerLips?.height ?? ((outerLips?.height ?? 0) * 0.5)
        let mouthOpenRatio = mouthOpenH / iod
        let mouthWidthRatio = (outerLips?.width ?? (iod * 0.85)) / iod

        // Per-side and combined Brow-to-Eye distances normalized by IOD (tilt-compensated)
        let browA = lBrow?.center ?? CGPoint(x: eyeA.x, y: eyeA.y - CGFloat(iod * 0.34))
        let browB = rBrow?.center ?? CGPoint(x: eyeB.x, y: eyeB.y - CGFloat(iod * 0.34))
        let screenLeftBrow = (browA.x <= browB.x) ? browA : browB
        let screenRightBrow = (browA.x <= browB.x) ? browB : browA

        let browEyeDistL = Float(hypot((screenLeftEye.x - screenLeftBrow.x) * camAspect, screenLeftEye.y - screenLeftBrow.y)) / iod
        let browEyeDistR = Float(hypot((screenRightEye.x - screenRightBrow.x) * camAspect, screenRightEye.y - screenRightBrow.y)) / iod
        let browEyeRatio = (browEyeDistL + browEyeDistR) * 0.5

        let mouthCenterPt = outerLips?.center ?? CGPoint(x: noseCenter.x, y: noseCenter.y + CGFloat(iod * 0.45))
        let jawBottomPt = outerLips?.bottom ?? CGPoint(x: mouthCenterPt.x, y: mouthCenterPt.y + CGFloat(mouthOpenH * 0.6))

        let keyPoints: [String: Landmark] = [
            "leftEye": Landmark(x: Float(screenLeftEye.x), y: Float(screenLeftEye.y)),
            "rightEye": Landmark(x: Float(screenRightEye.x), y: Float(screenRightEye.y)),
            "leftBrow": Landmark(x: Float(screenLeftBrow.x), y: Float(screenLeftBrow.y)),
            "rightBrow": Landmark(x: Float(screenRightBrow.x), y: Float(screenRightBrow.y)),
            "nose": Landmark(x: Float(noseCenter.x), y: Float(noseCenter.y)),
            "mouth": Landmark(x: Float(mouthCenterPt.x), y: Float(mouthCenterPt.y)),
            "jaw": Landmark(x: Float(jawBottomPt.x), y: Float(jawBottomPt.y))
        ]

        return RawFaceMeasurements(
            anchorX: Float(eyeMid.x),
            anchorY: Float(eyeMid.y),
            interOcularDist: iod,
            roll: eyeRoll,
            yaw: combinedYaw,
            pitch: geomPitch,
            mouthOpenRatio: mouthOpenRatio,
            mouthWidthRatio: mouthWidthRatio,
            browEyeRatio: browEyeRatio,
            browEyeRatioL: browEyeDistL,
            browEyeRatioR: browEyeDistR,
            eyeAspectL: earL,
            eyeAspectR: earR,
            keyPoints: keyPoints
        )
    }

    public static func evaluateFace(
        raw: RawFaceMeasurements,
        baseline: FaceCalibrationBaseline,
        mouthSensitivity: Float,
        browSensitivity: Float,
        blinkSensitivity: Float = 1.35
    ) -> (metrics: FaceMetrics, blendshapes: [(name: String, score: Float)]) {
        func clamp(_ v: Float, _ lo: Float, _ hi: Float) -> Float { max(lo, min(hi, v)) }
        func clamp01(_ v: Float) -> Float { max(0, min(1, v)) }

        let refX = baseline.isCalibrated ? baseline.centerX : 0.5
        let refY = baseline.isCalibrated ? baseline.centerY : 0.46
        let refIOD = baseline.isCalibrated ? max(baseline.faceWidth, 0.03) : 0.085
        let refRoll = baseline.isCalibrated ? baseline.rollOffset : 0.0
        let refYaw = baseline.isCalibrated ? baseline.yawOffset : 0.0
        let refPitch = baseline.isCalibrated ? baseline.pitchOffset : 0.0
        let refMouthOpen = baseline.isCalibrated ? baseline.neutralMouthRatio : 0.14
        let refMouthWidth = baseline.isCalibrated ? baseline.neutralMouthWidth : 0.88
        let refBrowL = baseline.isCalibrated ? max(0.18, baseline.neutralBrowEyeDistL) : 0.34
        let refBrowR = baseline.isCalibrated ? max(0.18, baseline.neutralBrowEyeDistR) : 0.34
        let refEARL = baseline.isCalibrated ? max(0.16, min(0.36, baseline.neutralEyeAspectL)) : 0.25
        let refEARR = baseline.isCalibrated ? max(0.16, min(0.36, baseline.neutralEyeAspectR)) : 0.25

        let headX = clamp((raw.anchorX - refX) * 3.2, -1.0, 1.0)
        let headY = clamp((raw.anchorY - refY) * 3.2, -1.0, 1.0)
        let headScale = clamp(raw.interOcularDist / refIOD, 0.5, 2.0)
        let rawRollDelta = raw.roll - refRoll
        // Small deadzone on roll (< 1.8 degrees) so neutral glasses sit at 0% tilt
        let roll = abs(rawRollDelta) < 0.032 ? 0.0 : rawRollDelta
        let yaw = clamp(raw.yaw - refYaw, -1.0, 1.0)
        let pitch = clamp(raw.pitch - refPitch, -1.0, 1.0)

        // Compensate mouthOpen for head yaw foreshortening:
        // As head turns, 2D IOD in denominator shrinks by cos(yaw), artificially inflating raw.mouthOpenRatio.
        let yawCompensation = max(0.60, cos(yaw * 1.15))
        let compensatedMouthOpenRatio = raw.mouthOpenRatio * yawCompensation
        let rawMouthDelta = compensatedMouthOpenRatio - refMouthOpen
        // Noise gate deadzone: small fluctuations below 0.035 are clamped to 0.0 so turning head doesn't trigger talking!
        let mouthOpen: Float = (rawMouthDelta < 0.035) ? 0.0 : clamp01((rawMouthDelta - 0.035) * 3.1 * mouthSensitivity)
        let mouthSmile = clamp01((raw.mouthWidthRatio - refMouthWidth) * 3.2 * mouthSensitivity)
        let mouthPucker = clamp01((refMouthWidth - raw.mouthWidthRatio) * 3.2 * mouthSensitivity)

        // ── MULTI-CUE INDEPENDENT WINK vs. BLINK DETECTOR (Glasses-Resilient + Noise Gate) ──
        let relDropEAR_L = max(0, (refEARL - raw.eyeAspectL) / refEARL)
        let relDropEAR_R = max(0, (refEARR - raw.eyeAspectR) / refEARR)

        let relDropBrow_L = max(0, (refBrowL - raw.browEyeRatioL) / refBrowL)
        let relDropBrow_R = max(0, (refBrowR - raw.browEyeRatioR) / refBrowR)

        // Combined per-side closure evidence from baseline
        let winkEvidenceL = relDropEAR_L * 0.58 + relDropBrow_L * 0.42
        let winkEvidenceR = relDropEAR_R * 0.58 + relDropBrow_R * 0.42

        // Direct left-vs-right relative difference (completely baseline-independent)
        let directDiffEAR = (raw.eyeAspectL - raw.eyeAspectR) / max(raw.eyeAspectL, raw.eyeAspectR, 0.10)
        let directDiffBrow = (raw.browEyeRatioL - raw.browEyeRatioR) / max(raw.browEyeRatioL, raw.browEyeRatioR, 0.12)

        let calibratedAsymmetry = winkEvidenceR - winkEvidenceL
        let directAsymmetry = directDiffEAR * 0.65 + directDiffBrow * 0.35
        let winkAsymmetry = calibratedAsymmetry * 0.50 + directAsymmetry * 0.50

        // Noise gate: if neither eye is closing by at least 14%, both eyes are rock-solid open (0.0)
        let maxClosure = max(relDropEAR_L, relDropEAR_R, winkEvidenceL, winkEvidenceR)
        var blinkL: Float = 0
        var blinkR: Float = 0
        var isSingleEyeWink = false

        if maxClosure >= 0.14 {
            let winkThreshold: Float = 0.11
            let isRightWink = (winkAsymmetry >= winkThreshold && winkEvidenceR >= 0.15)
            let isLeftWink = (winkAsymmetry <= -winkThreshold && winkEvidenceL >= 0.15)

            if isRightWink && !isLeftWink {
                isSingleEyeWink = true
                let closureR = max(winkEvidenceR, directAsymmetry * 1.25)
                blinkR = clamp01(((closureR - 0.11) / 0.20) * blinkSensitivity)
                blinkL = 0.0 // Strictly clamp open Left eye to 0.0
            } else if isLeftWink && !isRightWink {
                isSingleEyeWink = true
                let closureL = max(winkEvidenceL, (-directAsymmetry) * 1.25)
                blinkL = clamp01(((closureL - 0.11) / 0.20) * blinkSensitivity)
                blinkR = 0.0 // Strictly clamp open Right eye to 0.0
            } else {
                // Bilateral blink
                let symmetricClosure = min(relDropEAR_L, relDropEAR_R)
                if symmetricClosure >= 0.15 {
                    let b = clamp01(((symmetricClosure - 0.15) / 0.22) * blinkSensitivity)
                    blinkL = b
                    blinkR = b
                }
            }
        }

        // Measure brow raise / furrow from the open eye during a single-eye wink so winking doesn't false-trigger "Frown"
        let activeBrowDelta: Float = {
            if isSingleEyeWink {
                return (winkAsymmetry > 0)
                    ? (raw.browEyeRatioL - refBrowL)
                    : (raw.browEyeRatioR - refBrowR)
            }
            return ((raw.browEyeRatioL - refBrowL) + (raw.browEyeRatioR - refBrowR)) * 0.5
        }()
        let browRaise = clamp01((activeBrowDelta - 0.012) * 7.5 * browSensitivity)
        let browFurrow = isSingleEyeWink ? 0.0 : clamp01((-activeBrowDelta - 0.018) * 7.5 * browSensitivity)

        let wideL = clamp01((raw.eyeAspectL - refEARL) / 0.12)
        let wideR = clamp01((raw.eyeAspectR - refEARR) / 0.12)

        // Classify speech viseme / mouth shape from openness, width (smile), and pucker (round)
        let viseme: MouthViseme = {
            if mouthOpen > 0.62 {
                return (mouthPucker > 0.22) ? .oh : .wideOpen
            } else if mouthOpen > 0.18 {
                if mouthPucker > 0.18 && mouthSmile < 0.15 {
                    return .oh
                } else if mouthSmile > 0.32 && mouthOpen < 0.38 {
                    return .smile
                } else {
                    return .ah
                }
            } else {
                if mouthSmile > 0.26 {
                    return .smile
                } else if mouthPucker > 0.30 {
                    return .oh
                } else {
                    return .neutral
                }
            }
        }()

        // Build readable expression summary for the UI
        var activeTags: [String] = []
        if viseme != .neutral {
            activeTags.append(viseme.rawValue)
        }
        if blinkL > 0.50 && blinkR > 0.50 {
            activeTags.append("Blink")
        } else if blinkL > 0.50 {
            activeTags.append("Wink L")
        } else if blinkR > 0.50 {
            activeTags.append("Wink R")
        }
        if browRaise > 0.25 {
            activeTags.append("Brows Up")
        } else if browFurrow > 0.30 {
            activeTags.append("Frown")
        }
        if abs(roll) > 0.14 {
            activeTags.append(roll > 0 ? "Tilt R" : "Tilt L")
        }
        if abs(yaw) > 0.28 {
            activeTags.append(yaw > 0 ? "Turn R" : "Turn L")
        }

        let summary = activeTags.isEmpty ? "Neutral" : activeTags.joined(separator: " · ")

        var m = FaceMetrics()
        m.present = true
        m.rawAnchorX = raw.anchorX
        m.rawAnchorY = raw.anchorY
        m.rawIOD = raw.interOcularDist
        m.headX = headX
        m.headY = headY
        m.headScale = headScale
        m.roll = roll
        m.yaw = yaw
        m.pitch = pitch
        m.mouthOpen = mouthOpen
        m.mouthSmile = mouthSmile
        m.mouthPucker = mouthPucker
        m.browRaise = browRaise
        m.browFurrow = browFurrow
        // Note: In mirrored selfie camera mode, the eye that appears on the right side of the screen
        // is tracked by blinkR, and the eye on the left side of the screen is tracked by blinkL.
        // We ensure screen parity so winking the eye on screen-right closes the screen-right character eye.
        m.eyeBlinkL = blinkR
        m.eyeBlinkR = blinkL
        m.viseme = viseme
        m.summaryLabel = summary

        let blendshapes: [(name: String, score: Float)] = [
            ("eyeBlinkLeft", blinkR),
            ("eyeBlinkRight", blinkL),
            ("eyeWideLeft", wideL),
            ("eyeWideRight", wideR),
            ("jawOpen", mouthOpen),
            ("mouthSmileLeft", mouthSmile),
            ("mouthSmileRight", mouthSmile),
            ("mouthPucker", mouthPucker),
            ("browInnerUp", browRaise),
            ("browOuterUpLeft", browRaise),
            ("browOuterUpRight", browRaise),
            ("browDownLeft", browFurrow),
            ("browDownRight", browFurrow),
            ("headRoll", roll),
            ("headYaw", yaw),
            ("headPitch", pitch)
        ]

        return (m, blendshapes)
    }
}
