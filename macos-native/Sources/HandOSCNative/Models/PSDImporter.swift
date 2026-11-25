import AppKit
import Foundation

public struct PSDLayer: Identifiable {
    public let id = UUID()
    public let name: String
    public let zOrder: Int
    public let originalCanvasFrame: CGRect
    public let trimmedFrame: CGRect
    public let premulRGBA: Data
    public let image: NSImage
    public var suggestedSlot: PuppetPartSlot?
    public var isSelected: Bool = true
}

public enum PSDImportError: LocalizedError {
    case invalidSignature
    case unsupportedColorMode
    case noLayersFound
    case corruptedData

    public var errorDescription: String? {
        switch self {
        case .invalidSignature:
            return "File is not a valid Photoshop Document (signature is not 8BPS)."
        case .unsupportedColorMode:
            return "Only RGB 8-bit Photoshop documents are supported."
        case .noLayersFound:
            return "No valid pixel layers were found in this Photoshop document."
        case .corruptedData:
            return "Photoshop document data appears truncated or corrupted."
        }
    }
}

public final class PSDParser {
    public static func parse(fileURL: URL) throws -> (canvasSize: CGSize, layers: [PSDLayer]) {
        let data = try Data(contentsOf: fileURL)
        return try parse(data: data)
    }

    public static func parse(data: Data) throws -> (canvasSize: CGSize, layers: [PSDLayer]) {
        guard data.count >= 26 else { throw PSDImportError.invalidSignature }
        var offset = 0

        func readUInt16() -> UInt16 {
            guard offset + 2 <= data.count else { return 0 }
            let val = data.subdata(in: offset..<offset+2).withUnsafeBytes { $0.load(as: UInt16.self).bigEndian }
            offset += 2
            return val
        }
        func readInt16() -> Int16 {
            guard offset + 2 <= data.count else { return 0 }
            let val = data.subdata(in: offset..<offset+2).withUnsafeBytes { $0.load(as: Int16.self).bigEndian }
            offset += 2
            return val
        }
        func readUInt32() -> UInt32 {
            guard offset + 4 <= data.count else { return 0 }
            let val = data.subdata(in: offset..<offset+4).withUnsafeBytes { $0.load(as: UInt32.self).bigEndian }
            offset += 4
            return val
        }
        func readInt32() -> Int32 {
            guard offset + 4 <= data.count else { return 0 }
            let val = data.subdata(in: offset..<offset+4).withUnsafeBytes { $0.load(as: Int32.self).bigEndian }
            offset += 4
            return val
        }

        // 1. Header (26 bytes)
        let sig = String(data: data.subdata(in: 0..<4), encoding: .ascii) ?? ""
        guard sig == "8BPS" else { throw PSDImportError.invalidSignature }
        offset = 4
        let version = readUInt16()
        guard version == 1 else { throw PSDImportError.invalidSignature }
        offset += 6 // reserved
        _ = readUInt16() // channels
        let height = Int(readUInt32())
        let width = Int(readUInt32())
        let depth = Int(readUInt16())
        let colorMode = Int(readUInt16())
        guard depth == 8 && colorMode == 3 else { throw PSDImportError.unsupportedColorMode }

        // 2. Color Mode Data
        let colorModeLen = Int(readUInt32())
        offset += colorModeLen

        // 3. Image Resources
        let imgResLen = Int(readUInt32())
        offset += imgResLen

        // 4. Layer and Mask Information
        guard offset + 8 <= data.count else { throw PSDImportError.noLayersFound }
        let layerAndMaskLen = Int(readUInt32())
        guard layerAndMaskLen > 0 else { throw PSDImportError.noLayersFound }
        let layerInfoLen = Int(readUInt32())
        guard layerInfoLen > 0 else { throw PSDImportError.noLayersFound }
        let layerCountRaw = readInt16()
        let layerCount = abs(Int(layerCountRaw))
        guard layerCount > 0 else { throw PSDImportError.noLayersFound }

        struct RawLayerRecord {
            var top: Int
            var left: Int
            var bottom: Int
            var right: Int
            var channels: [(id: Int, len: Int)]
            var name: String
            var isVisible: Bool
        }

        var rawRecords: [RawLayerRecord] = []
        for _ in 0..<layerCount {
            guard offset + 16 <= data.count else { break }
            let top = Int(readInt32())
            let left = Int(readInt32())
            let bottom = Int(readInt32())
            let right = Int(readInt32())
            let numCh = Int(readUInt16())
            var chs: [(id: Int, len: Int)] = []
            for _ in 0..<numCh {
                guard offset + 6 <= data.count else { break }
                let id = Int(readInt16())
                let len = Int(readUInt32())
                chs.append((id, len))
            }
            offset += 4 // 8BIM
            offset += 4 // blend mode key
            offset += 1 // opacity
            offset += 1 // clipping
            let flags = data[offset]; offset += 1
            let isVisible = (flags & 0x02) == 0
            offset += 1 // filler
            let extraLen = Int(readUInt32())
            let extraEnd = offset + extraLen

            if offset + 4 <= extraEnd {
                let maskLen = Int(readUInt32())
                offset += maskLen
            }
            if offset + 4 <= extraEnd {
                let blendLen = Int(readUInt32())
                offset += blendLen
            }
            var layerName = "Unnamed"
            if offset < extraEnd {
                let nameLen = Int(data[offset]); offset += 1
                if offset + nameLen <= data.count {
                    let nameData = data.subdata(in: offset..<offset+nameLen)
                    layerName = String(data: nameData, encoding: .utf8) ?? String(data: nameData, encoding: .isoLatin1) ?? "Unnamed"
                }
            }

            offset = extraEnd
            rawRecords.append(RawLayerRecord(top: top, left: left, bottom: bottom, right: right, channels: chs, name: layerName, isVisible: isVisible))
        }

        func decompressPackBits(input: Data, expectedBytes: Int) -> Data {
            var output = Data()
            output.reserveCapacity(expectedBytes)
            var i = 0
            let count = input.count
            while i < count && output.count < expectedBytes {
                let b = Int(Int8(bitPattern: input[i]))
                i += 1
                if b >= 0 {
                    let n = b + 1
                    let end = min(i + n, count)
                    output.append(input[i..<end])
                    i += n
                } else if b > -128 {
                    let n = 1 - b
                    if i < count {
                        let val = input[i]
                        i += 1
                        output.append(contentsOf: repeatElement(val, count: n))
                    }
                }
            }
            return output
        }

        var extracted: [PSDLayer] = []
        let canvasSize = CGSize(width: width, height: height)

        for (zIdx, rec) in rawRecords.enumerated() {
            let w = rec.right - rec.left
            let h = rec.bottom - rec.top
            guard w > 0 && h > 0 else {
                for ch in rec.channels { offset += ch.len }
                continue
            }

            var channelData: [Int: Data] = [:]
            for ch in rec.channels {
                guard ch.len >= 2, offset + ch.len <= data.count else {
                    offset += ch.len
                    continue
                }
                let comp = readUInt16()
                let payloadLen = ch.len - 2
                let payload = data.subdata(in: offset..<offset+payloadLen)
                offset += payloadLen

                if comp == 0 {
                    channelData[ch.id] = payload
                } else if comp == 1 {
                    let scanlineHeaderSize = h * 2
                    if payload.count >= scanlineHeaderSize {
                        let rleData = payload.subdata(in: scanlineHeaderSize..<payload.count)
                        channelData[ch.id] = decompressPackBits(input: rleData, expectedBytes: w * h)
                    }
                }
            }

            guard let r = channelData[0], let g = channelData[1], let b = channelData[2],
                  r.count >= w * h, g.count >= w * h, b.count >= w * h else {
                continue
            }
            let a = channelData[-1] ?? Data(repeating: 255, count: w * h)

            // Skip completely opaque full-canvas Background layer if named Background/Tausta
            let lowerName = rec.name.lowercased()
            if lowerName == "background" || lowerName == "tausta" {
                continue
            }

            // Auto-trim transparent borders (ignore stray alpha <= 8 brush haze)
            var minX = w, maxX = -1, minY = h, maxY = -1
            for y in 0..<h {
                let rowStart = y * w
                for x in 0..<w {
                    if a[rowStart + x] > 8 {
                        if x < minX { minX = x }
                        if x > maxX { maxX = x }
                        if y < minY { minY = y }
                        if y > maxY { maxY = y }
                    }
                }
            }

            guard maxX >= minX && maxY >= minY else { continue }

            let trimW = maxX - minX + 1
            let trimH = maxY - minY + 1

            // Convert PSD Straight RGBA -> Premultiplied RGBA & zero out faint edge dust (<= 6 alpha)
            // This eliminates white/cyan brush fringes completely.
            var rgba = Data(count: trimW * trimH * 4)
            rgba.withUnsafeMutableBytes { (ptr: UnsafeMutableRawBufferPointer) in
                var destIdx = 0
                for y in minY...maxY {
                    let rowStart = y * w
                    for x in minX...maxX {
                        let srcIdx = rowStart + x
                        let rawA = (srcIdx < a.count) ? a[srcIdx] : 255
                        let cleanA: UInt8 = rawA <= 6 ? 0 : rawA
                        let af = UInt16(cleanA)
                        ptr[destIdx + 0] = UInt8((UInt16(r[srcIdx]) * af + 127) / 255)
                        ptr[destIdx + 1] = UInt8((UInt16(g[srcIdx]) * af + 127) / 255)
                        ptr[destIdx + 2] = UInt8((UInt16(b[srcIdx]) * af + 127) / 255)
                        ptr[destIdx + 3] = cleanA
                        destIdx += 4
                    }
                }
            }

            guard let nsImg = makeNSImage(premulRGBA: rgba, width: trimW, height: trimH) else { continue }
            let origFrame = CGRect(x: rec.left, y: rec.top, width: w, height: h)
            let trimmedFrame = CGRect(x: rec.left + minX, y: rec.top + minY, width: trimW, height: trimH)

            extracted.append(PSDLayer(
                name: rec.name,
                zOrder: zIdx,
                originalCanvasFrame: origFrame,
                trimmedFrame: trimmedFrame,
                premulRGBA: rgba,
                image: nsImg,
                suggestedSlot: nil,
                isSelected: true
            ))
        }

        // Determine character horizontal midline from torso or head (screen-relative left vs right)
        let bodyMidX: CGFloat = {
            if let torsoLayer = extracted.first(where: {
                let l = $0.name.lowercased()
                return l == "vartalo" || l == "torso" || l == "body" || l == "ruumis"
            }) {
                return torsoLayer.trimmedFrame.midX
            }
            if let headLayer = extracted.first(where: {
                let l = $0.name.lowercased()
                return (l == "pää" || l == "head") && !$0.name.contains("/")
            }) {
                return headLayer.trimmedFrame.midX
            }
            return canvasSize.width * 0.5
        }()

        for idx in extracted.indices {
            let layer = extracted[idx]
            let suggested = matchSlot(for: layer.name, frame: layer.trimmedFrame, bodyMidX: bodyMidX)
            extracted[idx].suggestedSlot = suggested
            extracted[idx].isSelected = (suggested != nil)
        }

        return (canvasSize, extracted)
    }

    private static func makeNSImage(premulRGBA: Data, width: Int, height: Int) -> NSImage? {
        guard width > 0, height > 0, premulRGBA.count >= width * height * 4,
              let provider = CGDataProvider(data: premulRGBA as CFData),
              let cgImg = CGImage(
                width: width,
                height: height,
                bitsPerComponent: 8,
                bitsPerPixel: 32,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                provider: provider,
                decode: nil,
                shouldInterpolate: true,
                intent: .defaultIntent
              ) else { return nil }
        return NSImage(cgImage: cgImg, size: NSSize(width: width, height: height))
    }

    /// Intelligent multilingual layer name matcher using screen-relative geometry for left/right parts.
    /// In Puppet Studio, screen-left (`midX < bodyMidX`) maps to `.left*` and screen-right (`midX >= bodyMidX`) maps to `.right*`.
    public static func matchSlot(for layerName: String, frame: CGRect = .zero, bodyMidX: CGFloat = 0) -> PuppetPartSlot? {
        let lower = layerName.lowercased()

        if lower.contains("background") || lower.contains("tausta") || lower.contains("layer group") || lower.contains("ryhmä") {
            return nil
        }
        if lower == "kädet" || lower == "jalat" || (lower == "pää" && layerName.contains("/")) {
            return nil
        }

        // Screen-side check overrides anatomical naming ambiguity (artist "Oikea" is typically screen-left!)
        let isScreenRight: Bool = {
            if frame.width > 0 && bodyMidX > 0 {
                return frame.midX >= bodyMidX
            }
            return lower.contains("vasen") || lower.contains("vaaen") || lower.contains("right") || lower.hasSuffix("_r") || lower.hasSuffix("-r")
        }()

        // Ears / Head accessories composite into Head
        if lower.contains("korva") || lower.contains("ear") {
            return .head
        }

        // Eyebrows
        if lower.contains("kulmakarva") || lower.contains("brow") {
            return isScreenRight ? .rightBrows : .browsOverlay
        }

        // Eyes (Open vs Closed)
        if lower.contains("silmä") || lower.contains("eye") {
            let isClosed = lower.contains("kiinni") || lower.contains("close") || lower.contains("blink") || lower.contains("wink") || lower.contains("closed")
            if isClosed {
                return isScreenRight ? .rightEyeClosed : .eyesClosed
            } else {
                return isScreenRight ? .rightEyeOpen : .eyesOpen
            }
        }

        // Mouth Visemes
        if lower.contains("suu") || lower.contains("mouth") || lower.contains("viseme") {
            if lower.contains("neutraali") || lower.contains("neutral") || lower.contains("closed") || lower.contains("norm") {
                return .mouthNeutral
            } else if lower.contains("iloinen") || lower.contains("smile") || lower.contains("happy") || lower.contains("hymy") || lower.contains("ee") {
                return .mouthSmile
            } else if lower.contains("hämmästynyt") || lower.contains("surprised") || lower.contains("ah") || lower.contains("auki") || lower.contains("open") {
                return .mouthAh
            } else if lower.contains("pyöreä") || lower.contains("round") || lower.contains("oh") || lower.contains("ooo") {
                return .mouthOh
            }
            return .mouthNeutral
        }

        // Nose
        if lower.contains("nenä") || lower.contains("nose") {
            return .noseOverlay
        }

        // Head
        if lower.contains("pää") || lower.contains("head") {
            return .head
        }

        // Torso / Body
        if lower.contains("vartalo") || lower.contains("torso") || lower.contains("body") || lower.contains("chest") || lower.contains("ruumis") {
            return .torso
        }

        // Pelvis / Hips
        if lower.contains("lantio") || lower.contains("pelvis") || lower.contains("hips") || lower.contains("waist") {
            return .pelvis
        }

        // Tail
        if lower.contains("häntä") || lower.contains("tail") {
            return .tail
        }

        // Upper Arms
        if lower.contains("olkavarsi") || lower.contains("upperarm") || lower.contains("bicep") || lower.contains("upper_arm") {
            return isScreenRight ? .rightUpperArm : .leftUpperArm
        }

        // Forearms
        if lower.contains("kyynärvarsi") || lower.contains("forearm") || lower.contains("lowerarm") || lower.contains("lower_arm") {
            return isScreenRight ? .rightForearm : .leftForearm
        }

        // Back of Hands ("Kämmenselkä" / "Back of hand" / "Hand back")
        if lower.contains("kämmenselkä") || lower.contains("hand_back") || lower.contains("hand back") || lower.contains("back of hand") || lower.contains("backhand") || lower.contains("dorsal") {
            return isScreenRight ? .rightHandBack : .leftHandBack
        }

        // Hands & Palms
        if lower.contains("kämmen") || lower.contains("käsi") || lower.contains("hand") || lower.contains("palm") || lower.contains("fist") || lower.contains("claw") {
            return isScreenRight ? .rightHand : .leftHand
        }

        // Thighs / Upper Legs
        if lower.contains("reisi") || lower.contains("thigh") || lower.contains("upperleg") || lower.contains("upper_leg") {
            return isScreenRight ? .rightThigh : .leftThigh
        }

        // Shins / Lower Legs
        if lower.contains("sääri") || lower.contains("shin") || lower.contains("lowerleg") || lower.contains("lower_leg") {
            return isScreenRight ? .rightShin : .leftShin
        }

        // Feet / Shoes / Paws
        if lower.contains("jalkaterä") || lower.contains("foot") || lower.contains("shoe") || lower.contains("boot") || lower.contains("tassu") || lower.contains("paw") {
            return isScreenRight ? .rightFoot : .leftFoot
        }

        return nil
    }

    // MARK: - Compositing & Pixel Alignment Helpers

    private struct CompositeBuffer {
        let frame: CGRect
        let premulRGBA: Data
        let image: NSImage
    }

    /// Composites multiple PSD layers (e.g. Korva Oikea + Korva Vasen + Pää) in their original PSD z-order onto their union frame.
    private static func compositeLayers(_ layers: [PSDLayer]) -> CompositeBuffer? {
        guard !layers.isEmpty else { return nil }
        let sorted = layers.sorted { $0.zOrder < $1.zOrder }
        if sorted.count == 1 {
            let l = sorted[0]
            return CompositeBuffer(frame: l.trimmedFrame, premulRGBA: l.premulRGBA, image: l.image)
        }

        var unionRect = sorted[0].trimmedFrame
        for l in sorted.dropFirst() {
            unionRect = unionRect.union(l.trimmedFrame)
        }
        let w = Int(unionRect.width.rounded())
        let h = Int(unionRect.height.rounded())
        let ux = Int(unionRect.minX.rounded())
        let uy = Int(unionRect.minY.rounded())
        guard w > 0, h > 0 else { return nil }

        var outRGBA = Data(count: w * h * 4)
        outRGBA.withUnsafeMutableBytes { (dstPtr: UnsafeMutableRawBufferPointer) in
            for layer in sorted {
                let lw = Int(layer.trimmedFrame.width.rounded())
                let lh = Int(layer.trimmedFrame.height.rounded())
                let lx = Int(layer.trimmedFrame.minX.rounded()) - ux
                let ly = Int(layer.trimmedFrame.minY.rounded()) - uy
                layer.premulRGBA.withUnsafeBytes { (srcPtr: UnsafeRawBufferPointer) in
                    for y in 0..<lh {
                        let dy = ly + y
                        guard dy >= 0 && dy < h else { continue }
                        for x in 0..<lw {
                            let dx = lx + x
                            guard dx >= 0 && dx < w else { continue }
                            let sIdx = (y * lw + x) * 4
                            let dIdx = (dy * w + dx) * 4
                            let sa = Int(srcPtr[sIdx + 3])
                            if sa == 0 { continue }
                            if sa == 255 {
                                dstPtr[dIdx + 0] = srcPtr[sIdx + 0]
                                dstPtr[dIdx + 1] = srcPtr[sIdx + 1]
                                dstPtr[dIdx + 2] = srcPtr[sIdx + 2]
                                dstPtr[dIdx + 3] = 255
                            } else {
                                // Standard Porter-Duff Source-Over premultiplied blend
                                let invSA = 255 - sa
                                let dr = min(255, Int(srcPtr[sIdx + 0]) + (Int(dstPtr[dIdx + 0]) * invSA + 127) / 255)
                                let dg = min(255, Int(srcPtr[sIdx + 1]) + (Int(dstPtr[dIdx + 1]) * invSA + 127) / 255)
                                let db = min(255, Int(srcPtr[sIdx + 2]) + (Int(dstPtr[dIdx + 2]) * invSA + 127) / 255)
                                let da = min(255, sa + (Int(dstPtr[dIdx + 3]) * invSA + 127) / 255)
                                dstPtr[dIdx + 0] = UInt8(dr)
                                dstPtr[dIdx + 1] = UInt8(dg)
                                dstPtr[dIdx + 2] = UInt8(db)
                                dstPtr[dIdx + 3] = UInt8(da)
                            }
                        }
                    }
                }
            }
        }

        guard let img = makeNSImage(premulRGBA: outRGBA, width: w, height: h) else { return nil }
        return CompositeBuffer(frame: unionRect, premulRGBA: outRGBA, image: img)
    }

    /// Pads an image layer into a target union rect so sprite-swapped variants share identical scale & anchor coordinates.
    private static func renderAlignedToRect(_ layer: PSDLayer, targetRect: CGRect) -> CompositeBuffer? {
        let w = Int(targetRect.width.rounded())
        let h = Int(targetRect.height.rounded())
        let tx = Int(targetRect.minX.rounded())
        let ty = Int(targetRect.minY.rounded())
        let lw = Int(layer.trimmedFrame.width.rounded())
        let lh = Int(layer.trimmedFrame.height.rounded())
        let lx = Int(layer.trimmedFrame.minX.rounded()) - tx
        let ly = Int(layer.trimmedFrame.minY.rounded()) - ty
        guard w > 0, h > 0 else { return nil }

        if w == lw && h == lh && lx == 0 && ly == 0 {
            return CompositeBuffer(frame: targetRect, premulRGBA: layer.premulRGBA, image: layer.image)
        }

        var outRGBA = Data(count: w * h * 4)
        outRGBA.withUnsafeMutableBytes { (dstPtr: UnsafeMutableRawBufferPointer) in
            layer.premulRGBA.withUnsafeBytes { (srcPtr: UnsafeRawBufferPointer) in
                for y in 0..<lh {
                    let dy = ly + y
                    guard dy >= 0 && dy < h else { continue }
                    for x in 0..<lw {
                        let dx = lx + x
                        guard dx >= 0 && dx < w else { continue }
                        let sIdx = (y * lw + x) * 4
                        let dIdx = (dy * w + dx) * 4
                        dstPtr[dIdx + 0] = srcPtr[sIdx + 0]
                        dstPtr[dIdx + 1] = srcPtr[sIdx + 1]
                        dstPtr[dIdx + 2] = srcPtr[sIdx + 2]
                        dstPtr[dIdx + 3] = srcPtr[sIdx + 3]
                    }
                }
            }
        }
        guard let img = makeNSImage(premulRGBA: outRGBA, width: w, height: h) else { return nil }
        return CompositeBuffer(frame: targetRect, premulRGBA: outRGBA, image: img)
    }

    /// Computes the weighted centroid of overlapping opaque pixels between two layers on the PSD canvas.
    private static func opaqueOverlapCentroid(_ a: CompositeBuffer, _ b: CompositeBuffer) -> CGPoint? {
        let inter = a.frame.intersection(b.frame)
        guard !inter.isNull && !inter.isEmpty else { return nil }

        let ax0 = Int(a.frame.minX.rounded()), ay0 = Int(a.frame.minY.rounded()), aw = Int(a.frame.width.rounded())
        let bx0 = Int(b.frame.minX.rounded()), by0 = Int(b.frame.minY.rounded()), bw = Int(b.frame.width.rounded())
        let x0 = Int(inter.minX.rounded()), x1 = Int(inter.maxX.rounded())
        let y0 = Int(inter.minY.rounded()), y1 = Int(inter.maxY.rounded())
        guard x1 > x0 && y1 > y0 else { return nil }

        var sumX = 0.0, sumY = 0.0, weightSum = 0.0
        a.premulRGBA.withUnsafeBytes { (aPtr: UnsafeRawBufferPointer) in
            b.premulRGBA.withUnsafeBytes { (bPtr: UnsafeRawBufferPointer) in
                for y in y0..<y1 {
                    let ay = y - ay0
                    let by = y - by0
                    guard ay >= 0, by >= 0 else { continue }
                    for x in x0..<x1 {
                        let ax = x - ax0
                        let bx = x - bx0
                        guard ax >= 0 && ax < aw, bx >= 0 && bx < bw else { continue }
                        let aIdx = (ay * aw + ax) * 4 + 3
                        let bIdx = (by * bw + bx) * 4 + 3
                        guard aIdx < a.premulRGBA.count, bIdx < b.premulRGBA.count else { continue }
                        let aa = aPtr[aIdx]
                        let ab = bPtr[bIdx]
                        if aa > 48 && ab > 48 {
                            let w = Double(min(aa, ab))
                            sumX += Double(x) * w
                            sumY += Double(y) * w
                            weightSum += w
                        }
                    }
                }
            }
        }
        guard weightSum > 0 else { return nil }
        return CGPoint(x: sumX / weightSum, y: sumY / weightSum)
    }

    /// Finds the farthest opaque pixel point from a given canvas origin (useful for tail tips and hand fingertips).
    private static func farthestOpaquePoint(in buf: CompositeBuffer, from origin: CGPoint) -> CGPoint {
        let w = Int(buf.frame.width.rounded())
        let h = Int(buf.frame.height.rounded())
        let ox = Int(buf.frame.minX.rounded())
        let oy = Int(buf.frame.minY.rounded())
        var bestDist = -1.0
        var bestPt = CGPoint(x: buf.frame.midX, y: buf.frame.midY)

        buf.premulRGBA.withUnsafeBytes { (ptr: UnsafeRawBufferPointer) in
            let step = max(1, min(w, h) / 64)
            for y in stride(from: 0, to: h, by: step) {
                for x in stride(from: 0, to: w, by: step) {
                    let aIdx = (y * w + x) * 4 + 3
                    guard aIdx < buf.premulRGBA.count, ptr[aIdx] > 96 else { continue }
                    let cx = Double(ox + x)
                    let cy = Double(oy + y)
                    let d = hypot(cx - Double(origin.x), cy - Double(origin.y))
                    if d > bestDist {
                        bestDist = d
                        bestPt = CGPoint(x: cx, y: cy)
                    }
                }
            }
        }
        return bestPt
    }

    private static func relUV(_ pt: CGPoint, in frame: CGRect, clampRange: ClosedRange<CGFloat> = 0.04...0.96) -> CGPoint {
        let u = max(clampRange.lowerBound, min(clampRange.upperBound, (pt.x - frame.minX) / max(1.0, frame.width)))
        let v = max(clampRange.lowerBound, min(clampRange.upperBound, (pt.y - frame.minY) / max(1.0, frame.height)))
        return CGPoint(x: u, y: v)
    }

    /// Convenience single-slot overload forwarding to multi-slot `assemblePuppet`.
    public static func assemblePuppet(
        into puppet: PuppetController,
        characterName: String,
        layers: [PSDLayer],
        slotMap: [UUID: PuppetPartSlot]
    ) {
        var multi: [UUID: Set<PuppetPartSlot>] = [:]
        for (id, slot) in slotMap {
            multi[id] = [slot]
        }
        assemblePuppet(into: puppet, characterName: characterName, layers: layers, slotsByLayer: multi)
    }

    /// Assembles the puppet directly into the controller with composited layers, aligned expression groups,
    /// multi-slot sharing (1 PSD layer -> multiple puppet slots), opaque-overlap joint pins, and 1:1 PSD scales.
    public static func assemblePuppet(
        into puppet: PuppetController,
        characterName: String,
        layers: [PSDLayer],
        slotsByLayer: [UUID: Set<PuppetPartSlot>]
    ) {
        puppet.recordUndoSnapshot()

        puppet.characterName = characterName.isEmpty ? "Imported PSD Character" : characterName
        puppet.clearAllPartGraphics(deleteDiskCache: true)
        for slot in PuppetPartSlot.allCases {
            puppet.partWidthScale[slot] = 1.0
            puppet.partHeightScale[slot] = 1.0
            puppet.partRotationOffset[slot] = 0.0
            puppet.partFlipH[slot] = false
            puppet.partFlipV[slot] = false
            puppet.partOffsetX[slot] = 0.0
            puppet.partOffsetY[slot] = 0.0
        }

        // Group layers by assigned slot(s) — one layer can populate multiple slots (e.g. Mouth Ah + Mouth Oh)
        var layersBySlot: [PuppetPartSlot: [PSDLayer]] = [:]
        for l in layers {
            if let assignedSlots = slotsByLayer[l.id] {
                for slot in assignedSlots {
                    layersBySlot[slot, default: []].append(l)
                }
            }
        }

        // 1. Build composited/aligned image buffers per slot
        var buffers: [PuppetPartSlot: CompositeBuffer] = [:]

        // Head composites all layers mapped to .head (e.g. Korva Oikea + Korva Vasen + Pää) in PSD z-order
        if let headLayers = layersBySlot[.head], let headBuf = compositeLayers(headLayers) {
            buffers[.head] = headBuf
        }

        // Align mouth viseme sprites onto a shared union canvas rect so nose/mouth stay rock-steady across visemes
        let mouthSlots: [PuppetPartSlot] = [.mouthNeutral, .mouthSmile, .mouthAh, .mouthOh]
        let mouthLayers = mouthSlots.compactMap { layersBySlot[$0]?.last }
        if !mouthLayers.isEmpty {
            var mouthUnion = mouthLayers[0].trimmedFrame
            for ml in mouthLayers.dropFirst() { mouthUnion = mouthUnion.union(ml.trimmedFrame) }
            for slot in mouthSlots {
                if let l = layersBySlot[slot]?.last, let aligned = renderAlignedToRect(l, targetRect: mouthUnion) {
                    buffers[slot] = aligned
                }
            }
        }

        // Align open/closed eye pairs onto shared union rects per side
        let leftEyeSlots: [PuppetPartSlot] = [.eyesOpen, .eyesClosed]
        let leftEyeLayers = leftEyeSlots.compactMap { layersBySlot[$0]?.last }
        if !leftEyeLayers.isEmpty {
            var unionL = leftEyeLayers[0].trimmedFrame
            for el in leftEyeLayers.dropFirst() { unionL = unionL.union(el.trimmedFrame) }
            for slot in leftEyeSlots {
                if let l = layersBySlot[slot]?.last, let aligned = renderAlignedToRect(l, targetRect: unionL) {
                    buffers[slot] = aligned
                }
            }
        }

        let rightEyeSlots: [PuppetPartSlot] = [.rightEyeOpen, .rightEyeClosed]
        let rightEyeLayers = rightEyeSlots.compactMap { layersBySlot[$0]?.last }
        if !rightEyeLayers.isEmpty {
            var unionR = rightEyeLayers[0].trimmedFrame
            for el in rightEyeLayers.dropFirst() { unionR = unionR.union(el.trimmedFrame) }
            for slot in rightEyeSlots {
                if let l = layersBySlot[slot]?.last, let aligned = renderAlignedToRect(l, targetRect: unionR) {
                    buffers[slot] = aligned
                }
            }
        }

        // Remaining single-layer slots
        for (slot, list) in layersBySlot {
            if buffers[slot] != nil { continue }
            if let last = list.last {
                buffers[slot] = CompositeBuffer(frame: last.trimmedFrame, premulRGBA: last.premulRGBA, image: last.image)
            }
        }

        // Assign final NSImages to puppet controller (and sync CustomAssets cache cleanly)
        for (slot, buf) in buffers {
            let label = (layersBySlot[slot]?.last?.name ?? slot.rawValue) + ".png"
            puppet.assignPartImageSilently(buf.image, label: label, for: slot)
        }

        // 2. Compute exact joint points on PSD canvas via opaque-pixel overlap
        let headBuf = buffers[.head]
        let torsoBuf = buffers[.torso]
        let pelvisBuf = buffers[.pelvis]
        let tailBuf = buffers[.tail]

        let neckCanvasPt: CGPoint? = {
            if let h = headBuf, let t = torsoBuf {
                return opaqueOverlapCentroid(h, t) ?? CGPoint(x: h.frame.midX, y: t.frame.minY)
            }
            return nil
        }()

        // Left & Right Arm joints
        func computeArmJoints(upper: PuppetPartSlot, fore: PuppetPartSlot, hand: PuppetPartSlot) -> (shoulder: CGPoint?, elbow: CGPoint?, wrist: CGPoint?, fingerTip: CGPoint?) {
            let uBuf = buffers[upper]
            let fBuf = buffers[fore]
            let hBuf = buffers[hand]

            let shoulderPt: CGPoint? = {
                if let t = torsoBuf, let u = uBuf {
                    return opaqueOverlapCentroid(t, u) ?? CGPoint(x: u.frame.midX, y: u.frame.minY + u.frame.height * 0.16)
                } else if let u = uBuf {
                    return CGPoint(x: u.frame.midX, y: u.frame.minY + u.frame.height * 0.16)
                }
                return nil
            }()

            let elbowPt: CGPoint? = {
                if let u = uBuf, let f = fBuf {
                    return opaqueOverlapCentroid(u, f) ?? CGPoint(x: f.frame.midX, y: f.frame.minY + f.frame.height * 0.16)
                } else if let u = uBuf {
                    return CGPoint(x: u.frame.midX, y: u.frame.maxY - u.frame.height * 0.16)
                }
                return nil
            }()

            let wristPt: CGPoint? = {
                if let f = fBuf, let h = hBuf {
                    return opaqueOverlapCentroid(f, h) ?? CGPoint(x: h.frame.midX, y: h.frame.minY + h.frame.height * 0.25)
                } else if let f = fBuf {
                    return CGPoint(x: f.frame.midX, y: f.frame.maxY - f.frame.height * 0.16)
                }
                return nil
            }()

            let tipPt: CGPoint? = {
                if let h = hBuf, let w = wristPt {
                    return farthestOpaquePoint(in: h, from: w)
                }
                return nil
            }()

            return (shoulderPt, elbowPt, wristPt, tipPt)
        }

        // Left & Right Leg joints
        func computeLegJoints(thigh: PuppetPartSlot, shin: PuppetPartSlot, foot: PuppetPartSlot) -> (hip: CGPoint?, knee: CGPoint?, ankle: CGPoint?) {
            let tBuf = buffers[thigh]
            let sBuf = buffers[shin]
            let fBuf = buffers[foot]
            let hipOwner = pelvisBuf ?? torsoBuf

            let hipPt: CGPoint? = {
                if let owner = hipOwner, let t = tBuf {
                    return opaqueOverlapCentroid(owner, t) ?? CGPoint(x: t.frame.midX, y: t.frame.minY + t.frame.height * 0.16)
                } else if let t = tBuf {
                    return CGPoint(x: t.frame.midX, y: t.frame.minY + t.frame.height * 0.16)
                }
                return nil
            }()

            let kneePt: CGPoint? = {
                if let t = tBuf, let s = sBuf {
                    return opaqueOverlapCentroid(t, s) ?? CGPoint(x: s.frame.midX, y: s.frame.minY + s.frame.height * 0.16)
                } else if let t = tBuf {
                    return CGPoint(x: t.frame.midX, y: t.frame.maxY - t.frame.height * 0.16)
                }
                return nil
            }()

            let anklePt: CGPoint? = {
                if let s = sBuf, let f = fBuf {
                    return opaqueOverlapCentroid(s, f) ?? CGPoint(x: f.frame.midX, y: f.frame.minY + f.frame.height * 0.22)
                } else if let s = sBuf {
                    return CGPoint(x: s.frame.midX, y: s.frame.maxY - s.frame.height * 0.14)
                }
                return nil
            }()

            return (hipPt, kneePt, anklePt)
        }

        let leftArmJ = computeArmJoints(upper: .leftUpperArm, fore: .leftForearm, hand: .leftHand)
        let rightArmJ = computeArmJoints(upper: .rightUpperArm, fore: .rightForearm, hand: .rightHand)
        let leftLegJ = computeLegJoints(thigh: .leftThigh, shin: .leftShin, foot: .leftFoot)
        let rightLegJ = computeLegJoints(thigh: .rightThigh, shin: .rightShin, foot: .rightFoot)

        let tailBasePt: CGPoint? = {
            if let t = torsoBuf, let tb = tailBuf {
                return opaqueOverlapCentroid(t, tb) ?? CGPoint(x: tb.frame.maxX - tb.frame.width * 0.2, y: tb.frame.minY + tb.frame.height * 0.25)
            }
            return nil
        }()

        // 3. Populate Pins
        puppet.pinsBySlot = PuppetController.defaultPins(for: .humanCharacter)

        // Head Pins
        if let hBuf = headBuf {
            let lEyeBuf = buffers[.eyesOpen] ?? buffers[.eyesClosed]
            let rEyeBuf = buffers[.rightEyeOpen] ?? buffers[.rightEyeClosed]
            let lEyeUV = lEyeBuf.map { relUV(CGPoint(x: $0.frame.midX, y: $0.frame.midY), in: hBuf.frame) } ?? CGPoint(x: 0.35, y: 0.48)
            let rEyeUV = rEyeBuf.map { relUV(CGPoint(x: $0.frame.midX, y: $0.frame.midY), in: hBuf.frame) } ?? CGPoint(x: 0.65, y: 0.48)

            let lBrowUV = buffers[.browsOverlay].map { relUV(CGPoint(x: $0.frame.midX, y: $0.frame.midY), in: hBuf.frame) } ?? CGPoint(x: lEyeUV.x, y: max(0.10, lEyeUV.y - 0.14))
            let rBrowUV = buffers[.rightBrows].map { relUV(CGPoint(x: $0.frame.midX, y: $0.frame.midY), in: hBuf.frame) } ?? CGPoint(x: rEyeUV.x, y: max(0.10, rEyeUV.y - 0.14))

            let mouthBuf = buffers[.mouthNeutral] ?? buffers[.mouthSmile] ?? buffers[.mouthAh] ?? buffers[.mouthOh]
            let mouthUV = mouthBuf.map { relUV(CGPoint(x: $0.frame.midX, y: $0.frame.midY), in: hBuf.frame) } ?? CGPoint(x: 0.50, y: 0.74)

            let noseUV = buffers[.noseOverlay].map { relUV(CGPoint(x: $0.frame.midX, y: $0.frame.midY), in: hBuf.frame) } ?? CGPoint(x: (lEyeUV.x + rEyeUV.x) * 0.5, y: (lEyeUV.y + mouthUV.y) * 0.5)
            let neckUV = neckCanvasPt.map { relUV($0, in: hBuf.frame) } ?? CGPoint(x: 0.50, y: 0.80)

            puppet.pinsBySlot[.head] = [
                PuppetControlPin(id: "neckPivot", name: "Head Base / Neck Joint", trackedSourceLabel: "Attaches to Torso Neck Mount", x: neckUV.x, y: neckUV.y),
                PuppetControlPin(id: "leftBrow", name: "Left Brow", trackedSourceLabel: "Face Left Eyebrow (Lift Warp)", x: lBrowUV.x, y: lBrowUV.y),
                PuppetControlPin(id: "rightBrow", name: "Right Brow", trackedSourceLabel: "Face Right Eyebrow (Lift Warp)", x: rBrowUV.x, y: rBrowUV.y),
                PuppetControlPin(id: "leftEye", name: "Left Eye", trackedSourceLabel: "Left Eye Sprite & Wink Anchor", x: lEyeUV.x, y: lEyeUV.y),
                PuppetControlPin(id: "rightEye", name: "Right Eye", trackedSourceLabel: "Right Eye Sprite & Wink Anchor", x: rEyeUV.x, y: rEyeUV.y),
                PuppetControlPin(id: "noseCenter", name: "Nose Tip", trackedSourceLabel: "Nose Layer & 2.5D Turn Center", x: noseUV.x, y: noseUV.y),
                PuppetControlPin(id: "mouthCenter", name: "Mouth Pin", trackedSourceLabel: "Mouth Viseme Sprite & Jaw Split Line", x: mouthUV.x, y: mouthUV.y),
                PuppetControlPin(id: "jawChin", name: "Lower Jaw / Chin", trackedSourceLabel: "Stretches Down Over Neck When Mouth Opens", x: mouthUV.x, y: min(0.96, mouthUV.y + 0.16))
            ]
        }

        // Torso Pins (including optional leftHip/rightHip when no separate pelvis layer exists)
        if let tBuf = torsoBuf {
            let neckMountUV = neckCanvasPt.map { relUV($0, in: tBuf.frame) } ?? CGPoint(x: 0.50, y: 0.12)
            let lShUV = leftArmJ.shoulder.map { relUV($0, in: tBuf.frame) } ?? CGPoint(x: 0.20, y: 0.34)
            let rShUV = rightArmJ.shoulder.map { relUV($0, in: tBuf.frame) } ?? CGPoint(x: 0.80, y: 0.34)
            let waistUV = tailBasePt.map { relUV($0, in: tBuf.frame) }
                ?? leftLegJ.hip.map { CGPoint(x: 0.50, y: relUV($0, in: tBuf.frame).y) }
                ?? CGPoint(x: 0.50, y: 0.85)

            var torsoPins = [
                PuppetControlPin(id: "neckMount", name: "Neck Top (Head Mount)", trackedSourceLabel: "Stationary Neck Top Where Head Attaches", x: neckMountUV.x, y: neckMountUV.y),
                PuppetControlPin(id: "leftShoulder", name: "Left Shoulder", trackedSourceLabel: "Pose Left Shoulder (11) / L Arm Mount", x: lShUV.x, y: lShUV.y),
                PuppetControlPin(id: "rightShoulder", name: "Right Shoulder", trackedSourceLabel: "Pose Right Shoulder (12) / R Arm Mount", x: rShUV.x, y: rShUV.y),
                PuppetControlPin(id: "waistPivot", name: "Waist / Pelvis Mount", trackedSourceLabel: "Attaches to Pelvis / Tail", x: waistUV.x, y: waistUV.y)
            ]
            if let lHip = leftLegJ.hip, pelvisBuf == nil {
                let lHipUV = relUV(lHip, in: tBuf.frame)
                torsoPins.append(PuppetControlPin(id: "leftHip", name: "Left Hip Mount", trackedSourceLabel: "L Leg Mount on Torso", x: lHipUV.x, y: lHipUV.y))
            }
            if let rHip = rightLegJ.hip, pelvisBuf == nil {
                let rHipUV = relUV(rHip, in: tBuf.frame)
                torsoPins.append(PuppetControlPin(id: "rightHip", name: "Right Hip Mount", trackedSourceLabel: "R Leg Mount on Torso", x: rHipUV.x, y: rHipUV.y))
            }
            puppet.pinsBySlot[.torso] = torsoPins
        }

        // Pelvis Pins
        if let pBuf = pelvisBuf {
            let waistJ = (tailBasePt ?? CGPoint(x: pBuf.frame.midX, y: pBuf.frame.minY + pBuf.frame.height * 0.2))
            let lHipUV = leftLegJ.hip.map { relUV($0, in: pBuf.frame) } ?? CGPoint(x: 0.30, y: 0.72)
            let rHipUV = rightLegJ.hip.map { relUV($0, in: pBuf.frame) } ?? CGPoint(x: 0.70, y: 0.72)
            let wUV = relUV(waistJ, in: pBuf.frame)
            puppet.pinsBySlot[.pelvis] = [
                PuppetControlPin(id: "waistJoint", name: "Waist Joint", trackedSourceLabel: "Supports Torso Waist Pivot", x: wUV.x, y: wUV.y),
                PuppetControlPin(id: "leftHip", name: "Left Hip", trackedSourceLabel: "Pose Left Hip (23) / L Leg Mount", x: lHipUV.x, y: lHipUV.y),
                PuppetControlPin(id: "rightHip", name: "Right Hip", trackedSourceLabel: "Pose Right Hip (24) / R Leg Mount", x: rHipUV.x, y: rHipUV.y)
            ]
        }

        // Upper Arm & Forearm Pins (supports angled A-pose limbs cleanly!)
        func assignSegmentPins(slot: PuppetPartSlot, startId: String, startName: String, startPt: CGPoint?, endId: String, endName: String, endPt: CGPoint?) {
            guard let buf = buffers[slot], let sPt = startPt, let ePt = endPt else { return }
            let sUV = relUV(sPt, in: buf.frame)
            let eUV = relUV(ePt, in: buf.frame)
            puppet.pinsBySlot[slot] = [
                PuppetControlPin(id: startId, name: startName, trackedSourceLabel: startName, x: sUV.x, y: sUV.y),
                PuppetControlPin(id: endId, name: endName, trackedSourceLabel: endName, x: eUV.x, y: eUV.y)
            ]
        }

        assignSegmentPins(slot: .leftUpperArm, startId: "shoulderJoint", startName: "Shoulder Joint", startPt: leftArmJ.shoulder, endId: "elbowJoint", endName: "Elbow Joint", endPt: leftArmJ.elbow)
        assignSegmentPins(slot: .rightUpperArm, startId: "shoulderJoint", startName: "Shoulder Joint", startPt: rightArmJ.shoulder, endId: "elbowJoint", endName: "Elbow Joint", endPt: rightArmJ.elbow)
        assignSegmentPins(slot: .leftForearm, startId: "elbowJoint", startName: "Elbow Joint", startPt: leftArmJ.elbow, endId: "wristJoint", endName: "Wrist Joint", endPt: leftArmJ.wrist)
        assignSegmentPins(slot: .rightForearm, startId: "elbowJoint", startName: "Elbow Joint", startPt: rightArmJ.elbow, endId: "wristJoint", endName: "Wrist Joint", endPt: rightArmJ.wrist)

        // Hand Pins
        func assignHandPins(slot: PuppetPartSlot, wristPt: CGPoint?, tipPt: CGPoint?, isLeftSide: Bool) {
            guard let buf = buffers[slot], let wPt = wristPt else { return }
            let wUV = relUV(wPt, in: buf.frame)
            let kPt = tipPt ?? CGPoint(x: buf.frame.midX, y: buf.frame.maxY - buf.frame.height * 0.18)
            let midPt = CGPoint(x: wPt.x + (kPt.x - wPt.x) * 0.72, y: wPt.y + (kPt.y - wPt.y) * 0.72)
            let kUV = relUV(midPt, in: buf.frame)
            let thumbUV = CGPoint(x: isLeftSide ? min(0.85, wUV.x + 0.18) : max(0.15, wUV.x - 0.18), y: (wUV.y + kUV.y) * 0.5)
            puppet.pinsBySlot[slot] = [
                PuppetControlPin(id: "wristPivot", name: "Wrist Pivot", trackedSourceLabel: "Hand Wrist (Landmark 0)", x: wUV.x, y: wUV.y),
                PuppetControlPin(id: "middleKnuckle", name: "Finger Direction", trackedSourceLabel: "Hand Middle MCP / Fingers (Landmark 9)", x: kUV.x, y: kUV.y),
                PuppetControlPin(id: "thumbPin", name: "Thumb Direction", trackedSourceLabel: "Thumb Tip / Grasp Vector (Landmark 4)", x: thumbUV.x, y: thumbUV.y)
            ]
        }
        assignHandPins(slot: .leftHand, wristPt: leftArmJ.wrist, tipPt: leftArmJ.fingerTip, isLeftSide: true)
        assignHandPins(slot: .rightHand, wristPt: rightArmJ.wrist, tipPt: rightArmJ.fingerTip, isLeftSide: false)

        // Back-of-Hand Pins (derived from Forearm ∩ HandBack overlap or primary wrist joint)
        if let lbBuf = buffers[.leftHandBack] {
            let lbWrist: CGPoint? = {
                if let f = buffers[.leftForearm], let ov = opaqueOverlapCentroid(f, lbBuf) { return ov }
                return leftArmJ.wrist ?? CGPoint(x: lbBuf.frame.midX, y: lbBuf.frame.minY + lbBuf.frame.height * 0.25)
            }()
            let lbTip = lbWrist.map { farthestOpaquePoint(in: lbBuf, from: $0) }
            assignHandPins(slot: .leftHandBack, wristPt: lbWrist, tipPt: lbTip, isLeftSide: true)
        }
        if let rbBuf = buffers[.rightHandBack] {
            let rbWrist: CGPoint? = {
                if let f = buffers[.rightForearm], let ov = opaqueOverlapCentroid(f, rbBuf) { return ov }
                return rightArmJ.wrist ?? CGPoint(x: rbBuf.frame.midX, y: rbBuf.frame.minY + rbBuf.frame.height * 0.25)
            }()
            let rbTip = rbWrist.map { farthestOpaquePoint(in: rbBuf, from: $0) }
            assignHandPins(slot: .rightHandBack, wristPt: rbWrist, tipPt: rbTip, isLeftSide: false)
        }

        // Leg Segment & Foot Pins
        assignSegmentPins(slot: .leftThigh, startId: "hipJoint", startName: "Hip Joint", startPt: leftLegJ.hip, endId: "kneeJoint", endName: "Knee Joint", endPt: leftLegJ.knee)
        assignSegmentPins(slot: .rightThigh, startId: "hipJoint", startName: "Hip Joint", startPt: rightLegJ.hip, endId: "kneeJoint", endName: "Knee Joint", endPt: rightLegJ.knee)
        assignSegmentPins(slot: .leftShin, startId: "kneeJoint", startName: "Knee Joint", startPt: leftLegJ.knee, endId: "ankleJoint", endName: "Ankle Joint", endPt: leftLegJ.ankle)
        assignSegmentPins(slot: .rightShin, startId: "kneeJoint", startName: "Knee Joint", startPt: rightLegJ.knee, endId: "ankleJoint", endName: "Ankle Joint", endPt: rightLegJ.ankle)

        func assignFootPins(slot: PuppetPartSlot, anklePt: CGPoint?, isLeftSide: Bool) {
            guard let buf = buffers[slot], let aPt = anklePt else { return }
            let aUV = relUV(aPt, in: buf.frame)
            puppet.pinsBySlot[slot] = [
                PuppetControlPin(id: "ankleJoint", name: "Ankle Joint", trackedSourceLabel: "Attaches to Shin Ankle", x: aUV.x, y: aUV.y),
                PuppetControlPin(id: "toeTip", name: "Toe Tip", trackedSourceLabel: "Toe Tip / Ground Level", x: isLeftSide ? 0.20 : 0.80, y: 0.85)
            ]
        }
        assignFootPins(slot: .leftFoot, anklePt: leftLegJ.ankle, isLeftSide: true)
        assignFootPins(slot: .rightFoot, anklePt: rightLegJ.ankle, isLeftSide: false)

        // Tail Pins
        if let tb = tailBuf {
            let basePt = tailBasePt ?? CGPoint(x: tb.frame.maxX - tb.frame.width * 0.15, y: tb.frame.minY + tb.frame.height * 0.25)
            let tipPt = farthestOpaquePoint(in: tb, from: basePt)
            let baseUV = relUV(basePt, in: tb.frame)
            let tipUV = relUV(tipPt, in: tb.frame)
            puppet.pinsBySlot[.tail] = [
                PuppetControlPin(id: "tailBase", name: "Tail Base Pivot", trackedSourceLabel: "Attaches behind Torso Waist", x: baseUV.x, y: baseUV.y),
                PuppetControlPin(id: "tailTip", name: "Tail Tip", trackedSourceLabel: "Sways with Body & 2.5D Turn", x: tipUV.x, y: tipUV.y)
            ]
        }

        // 4. Calibrate 1:1 PSD Proportions across every stage builder formula!
        let refHeadH_psd = max(100.0, headBuf?.frame.height ?? (torsoBuf.map { $0.frame.height * 0.55 } ?? 500.0))
        let refHeadW_psd = max(100.0, headBuf?.frame.width ?? refHeadH_psd)
        let refTorsoBase_psd = refHeadH_psd * 0.90

        puppet.characterScale = 0.24
        puppet.armLengthScale = 1.0
        puppet.armThicknessScale = 1.0
        puppet.legLengthScale = 1.0
        puppet.legThicknessScale = 1.0
        puppet.stagePuppetOffset = .zero

        // Auto-set hand-led reach exaggeration higher when mascot head is wide relative to short arms
        let estUpperPSD: CGFloat = {
            if let s = leftArmJ.shoulder, let e = leftArmJ.elbow { return hypot(e.x - s.x, e.y - s.y) }
            return refTorsoBase_psd * 0.45
        }()
        let estForePSD: CGFloat = {
            if let e = leftArmJ.elbow, let w = leftArmJ.wrist { return hypot(w.x - e.x, w.y - e.y) }
            return refTorsoBase_psd * 0.40
        }()
        let armToHeadRatio = (estUpperPSD + estForePSD) / max(1.0, refHeadW_psd)
        puppet.armReachExaggeration = armToHeadRatio < 0.85 ? 0.65 : 0.35

        // Torso
        if let tBuf = torsoBuf {
            puppet.partHeightScale[.torso] = Double(tBuf.frame.height / refTorsoBase_psd)
            puppet.partWidthScale[.torso] = 1.0
        }

        // Pelvis
        if let pBuf = pelvisBuf {
            let s = Double(pBuf.frame.height / (refTorsoBase_psd * 0.44))
            puppet.partHeightScale[.pelvis] = s
            puppet.partWidthScale[.pelvis] = 1.0
        }

        // Tail
        if let tb = tailBuf {
            let s = Double(tb.frame.height / (refTorsoBase_psd * 0.72))
            puppet.partHeightScale[.tail] = s
            puppet.partWidthScale[.tail] = 1.0
        }

        // Limb segment scale helper: sets BOTH width and height to boneLen / refBoneLen so 1:1 sprite aspect is preserved
        func calibrateLimbScale(slot: PuppetPartSlot, pA: CGPoint?, pB: CGPoint?, refFactor: CGFloat) {
            guard buffers[slot] != nil, let a = pA, let b = pB else { return }
            let boneLen = max(12.0, hypot(b.x - a.x, b.y - a.y))
            let scale = Double(boneLen / (refTorsoBase_psd * refFactor))
            puppet.partHeightScale[slot] = scale
            puppet.partWidthScale[slot] = scale
        }

        calibrateLimbScale(slot: .leftUpperArm, pA: leftArmJ.shoulder, pB: leftArmJ.elbow, refFactor: 0.52)
        calibrateLimbScale(slot: .rightUpperArm, pA: rightArmJ.shoulder, pB: rightArmJ.elbow, refFactor: 0.52)
        calibrateLimbScale(slot: .leftForearm, pA: leftArmJ.elbow, pB: leftArmJ.wrist, refFactor: 0.50)
        calibrateLimbScale(slot: .rightForearm, pA: rightArmJ.elbow, pB: rightArmJ.wrist, refFactor: 0.50)
        calibrateLimbScale(slot: .leftThigh, pA: leftLegJ.hip, pB: leftLegJ.knee, refFactor: 0.50)
        calibrateLimbScale(slot: .rightThigh, pA: rightLegJ.hip, pB: rightLegJ.knee, refFactor: 0.50)
        calibrateLimbScale(slot: .leftShin, pA: leftLegJ.knee, pB: leftLegJ.ankle, refFactor: 0.50)
        calibrateLimbScale(slot: .rightShin, pA: rightLegJ.knee, pB: rightLegJ.ankle, refFactor: 0.50)

        // Feet
        if let lf = buffers[.leftFoot] {
            let s = Double(lf.frame.height / (refTorsoBase_psd * 0.38))
            puppet.partHeightScale[.leftFoot] = s
            puppet.partWidthScale[.leftFoot] = s
        }
        if let rf = buffers[.rightFoot] {
            let s = Double(rf.frame.height / (refTorsoBase_psd * 0.38))
            puppet.partHeightScale[.rightFoot] = s
            puppet.partWidthScale[.rightFoot] = s
        }

        // Hands & Back-of-Hands (calibrated 1:1 to PSD height)
        if let handBuf = buffers[.leftHand] ?? buffers[.rightHand] ?? buffers[.leftHandBack] ?? buffers[.rightHandBack] {
            let refHandH = max(1.0, handBuf.frame.height)
            puppet.handScale = Double(puppet.characterScale * 0.92 * Double(refHandH / refHeadH_psd))
            for hSlot in [PuppetPartSlot.leftHand, .rightHand, .leftHandBack, .rightHandBack] {
                if let hb = buffers[hSlot] {
                    let rel = Double(hb.frame.height / refHandH)
                    puppet.partHeightScale[hSlot] = rel
                    puppet.partWidthScale[hSlot] = rel
                }
            }
        }
        if buffers[.leftHandBack] != nil || buffers[.rightHandBack] != nil {
            puppet.dynamicPalmFlip = true
        }

        // Eyes, Brows, Mouth, Nose scales relative to headW
        if let eyeBuf = buffers[.eyesOpen] ?? buffers[.rightEyeOpen] {
            puppet.eyeSpriteScale = Double((eyeBuf.frame.width / refHeadW_psd) / 0.195)
        }
        if let lBrowBuf = buffers[.browsOverlay] {
            let s = Double((lBrowBuf.frame.width / refHeadW_psd) / 0.26)
            puppet.partWidthScale[.browsOverlay] = s
            puppet.partHeightScale[.browsOverlay] = s
        }
        if let rBrowBuf = buffers[.rightBrows] {
            let s = Double((rBrowBuf.frame.width / refHeadW_psd) / 0.26)
            puppet.partWidthScale[.rightBrows] = s
            puppet.partHeightScale[.rightBrows] = s
        }
        if let mBuf = buffers[.mouthNeutral] ?? buffers[.mouthSmile] ?? buffers[.mouthAh] ?? buffers[.mouthOh] {
            puppet.mouthSpriteScale = Double((mBuf.frame.width / refHeadW_psd) / 0.29)
        }
        if let nBuf = buffers[.noseOverlay] {
            puppet.noseSpriteScale = Double((nBuf.frame.width / refHeadW_psd) / 0.145)
        }

        // 5. Layer Stack & Expression Modes
        puppet.layerStack = PuppetController.defaultLayerStack(for: .humanCharacter)

        if puppet.partImages[.mouthSmile] != nil || puppet.partImages[.mouthAh] != nil || puppet.partImages[.mouthOh] != nil {
            puppet.mouthAnimationMode = .visemeSpritesOnly
        }
        if puppet.partImages[.eyesClosed] != nil || puppet.partImages[.rightEyeClosed] != nil {
            puppet.eyeAnimationMode = .spriteSwapOnly
        }

        let hasLegs = buffers[.leftThigh] != nil || buffers[.rightThigh] != nil || buffers[.leftShin] != nil || buffers[.rightShin] != nil || buffers[.leftFoot] != nil || buffers[.rightFoot] != nil
        puppet.showFullBodyLegs = hasLegs
        if hasLegs {
            puppet.headScaleAmount = 0.0
        }
        puppet.selectedSlot = .head
        puppet.saveCurrentPresetState(immediate: true)
    }
}
