import Foundation

/// Enhanced 1€ filter with single-frame outlier spike rejection for rock-solid, low-latency tracking.
/// Reference: Casiez et al., "1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems".
public final class OneEuroFilter {
    private var y: Double? = nil
    private var dy: Double? = nil
    private var lastTimeSec: Double? = nil
    private var prevValue: Double? = nil
    private var history: (Double, Double)? = nil
    private var pendingSpike: Double? = nil

    public var minCutoff: Double
    public var beta: Double
    public var dCutoff: Double
    public var maxJumpPerFrame: Double

    public init(
        minCutoff: Double = 1.0,
        beta: Double = 0.0,
        dCutoff: Double = 1.0,
        maxJumpPerFrame: Double = 0.22
    ) {
        self.minCutoff = minCutoff
        self.beta = beta
        self.dCutoff = dCutoff
        self.maxJumpPerFrame = maxJumpPerFrame
    }

    private func alpha(cutoff: Double, dt: Double) -> Double {
        let tau = 1.0 / (2.0 * Double.pi * max(cutoff, 1e-4))
        return 1.0 / (1.0 + tau / dt)
    }

    private func lowPass(current: inout Double?, value: Double, alpha: Double) -> Double {
        if let prev = current {
            let next = alpha * value + (1.0 - alpha) * prev
            current = next
            return next
        } else {
            current = value
            return value
        }
    }

    private static func median3(_ a: Double, _ b: Double, _ c: Double) -> Double {
        if a <= b {
            if b <= c { return b }
            return max(a, c)
        } else {
            if a <= c { return a }
            return max(b, c)
        }
    }

    public func filter(value rawValue: Double, timestampSec: Double, smoothingEnabled: Bool = true) -> Double {
        guard !rawValue.isNaN && !rawValue.isInfinite else {
            return y ?? prevValue ?? 0.0
        }

        guard let lastTime = lastTimeSec, let lastAccepted = prevValue else {
            lastTimeSec = timestampSec
            prevValue = rawValue
            history = (rawValue, rawValue)
            return lowPass(current: &y, value: rawValue, alpha: 1.0)
        }

        let dt = max(min(timestampSec - lastTime, 0.25), 1e-4)
        lastTimeSec = timestampSec

        // 1-Frame Outlier / Spike Gate:
        // If Vision jumps violently in a single frame (> maxJumpPerFrame), require confirmation on the next frame
        // before letting the jump pull the landmark or puppet. This kills 1-frame Vision glitches with 0 lag!
        var cleanValue = rawValue
        let jump = abs(rawValue - lastAccepted)
        if jump > maxJumpPerFrame {
            if let spike = pendingSpike, abs(rawValue - spike) < maxJumpPerFrame * 0.85 {
                // Confirmed across 2 consecutive frames -> genuine fast movement
                pendingSpike = nil
                cleanValue = rawValue
            } else {
                // Unconfirmed single-frame spike -> hold near last accepted value
                pendingSpike = rawValue
                let step = (rawValue > lastAccepted ? 1.0 : -1.0) * (maxJumpPerFrame * 0.25)
                cleanValue = lastAccepted + step
            }
        } else {
            pendingSpike = nil
            if let (h0, h1) = history {
                // Apply light 3-point median blend when micro-jitter reverses direction sharply
                let d1 = h1 - h0
                let d2 = rawValue - h1
                if d1 * d2 < 0 && abs(d2) > 0.012 {
                    cleanValue = Self.median3(h0, h1, rawValue) * 0.65 + rawValue * 0.35
                }
            }
        }

        if let (_, h1) = history {
            history = (h1, cleanValue)
        } else {
            history = (cleanValue, cleanValue)
        }

        if !smoothingEnabled {
            prevValue = cleanValue
            y = cleanValue
            return cleanValue
        }

        let dx = (cleanValue - lastAccepted) / dt
        prevValue = cleanValue

        let edx = lowPass(current: &dy, value: dx, alpha: alpha(cutoff: dCutoff, dt: dt))
        let cutoff = minCutoff + beta * abs(edx)
        return lowPass(current: &y, value: cleanValue, alpha: alpha(cutoff: cutoff, dt: dt))
    }

    public func reset() {
        y = nil
        dy = nil
        lastTimeSec = nil
        prevValue = nil
        history = nil
        pendingSpike = nil
    }
}

public final class LandmarkSmoother {
    private var filters: [String: OneEuroFilter] = [:]
    private var enabled: Bool = true
    private var minCutoff: Double
    private var beta: Double

    public init(enabled: Bool = true, minCutoff: Double = 14.0, beta: Double = 2.4) {
        self.enabled = enabled
        self.minCutoff = minCutoff
        self.beta = beta
    }

    public func setParams(enabled: Bool, minCutoff: Double, beta: Double) {
        self.enabled = enabled
        self.minCutoff = minCutoff
        self.beta = beta
        for f in filters.values {
            f.minCutoff = minCutoff
            f.beta = beta
        }
    }

    public func filter(key: String, value: Float, timestampSec: Double, maxJump: Double = 0.22) -> Float {
        let f: OneEuroFilter
        if let existing = filters[key] {
            f = existing
        } else {
            let created = OneEuroFilter(minCutoff: minCutoff, beta: beta, maxJumpPerFrame: maxJump)
            filters[key] = created
            f = created
        }
        return Float(f.filter(value: Double(value), timestampSec: timestampSec, smoothingEnabled: enabled))
    }

    public func smooth(prefix: String, landmarks: [Landmark], timestampSec: Double, maxJump: Double = 0.18) -> [Landmark] {
        var out: [Landmark] = []
        out.reserveCapacity(landmarks.count)
        for (idx, p) in landmarks.enumerated() {
            let sx = filter(key: "\(prefix)_\(idx)_x", value: p.x, timestampSec: timestampSec, maxJump: maxJump)
            let sy = filter(key: "\(prefix)_\(idx)_y", value: p.y, timestampSec: timestampSec, maxJump: maxJump)
            let sz = filter(key: "\(prefix)_\(idx)_z", value: p.z, timestampSec: timestampSec, maxJump: maxJump)
            out.append(Landmark(x: sx, y: sy, z: sz))
        }
        return out
    }

    public func reset() {
        for f in filters.values {
            f.reset()
        }
    }
}
