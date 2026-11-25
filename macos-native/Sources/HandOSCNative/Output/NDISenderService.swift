import Foundation
import AppKit
import SwiftUI
import CoreGraphics
import Darwin

public enum NDIBackgroundMode: String, CaseIterable, Identifiable, Codable, Sendable {
    case transparentAlpha = "alpha"
    case matchStage = "stage"
    case chromaGreen = "green"
    case solidWhite = "white"

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .transparentAlpha: return "Transparent (Alpha BGRA)"
        case .matchStage: return "Match Stage Background"
        case .chromaGreen: return "Chroma Green"
        case .solidWhite: return "Solid White"
        }
    }
}

/// Zero-dependency runtime NDI video sender (loads `/usr/local/lib/libndi.dylib` via `dlopen`)
/// streaming character-only BGRA frames with transparent alpha or optional solid/chroma background.
public final class NDISenderService: ObservableObject {
    @Published public var isEnabled: Bool = false {
        didSet {
            if isEnabled != oldValue {
                if isEnabled {
                    startSender()
                } else {
                    stopSender()
                }
            }
        }
    }
    @Published public var backgroundMode: NDIBackgroundMode = .transparentAlpha
    @Published public var sourceName: String = "Puppet Studio" {
        didSet {
            if oldValue != sourceName && isEnabled {
                restartSender()
            }
        }
    }
    @Published public private(set) var isRuntimeAvailable: Bool = false
    @Published public private(set) var statusText: String = "NDI Off"
    @Published public private(set) var framesSent: Int = 0

    public let outputWidth: Int = 1280
    public let outputHeight: Int = 720

    private let ndiQueue = DispatchQueue(label: "com.handosc.native.ndi", qos: .userInitiated)
    private var dylibHandle: UnsafeMutableRawPointer? = nil
    private var ndiSendInstance: UnsafeMutableRawPointer? = nil
    private var isSendingFrame: Bool = false
    private var lastFrameSubmitTime: TimeInterval = 0
    private var bgraBuffer: [UInt8]
    private var sendBuffer: [UInt8]

    // NDI C ABI types matching NDI v5/v6 SDK
    private struct NDIlibSendCreate {
        var p_ndi_name: UnsafePointer<CChar>?
        var p_groups: UnsafePointer<CChar>?
        var clock_video: Bool
        var clock_audio: Bool
    }

    private struct NDIlibVideoFrameV2 {
        var xres: Int32
        var yres: Int32
        var FourCC: UInt32
        var frame_rate_N: Int32
        var frame_rate_D: Int32
        var picture_aspect_ratio: Float
        var frame_format_type: Int32
        var timecode: Int64
        var p_data: UnsafeMutablePointer<UInt8>?
        var line_stride_in_bytes: Int32
        var p_metadata: UnsafePointer<CChar>?
        var timestamp: Int64
    }

    private typealias FnInitialize = @convention(c) () -> Bool
    private typealias FnSendCreate = @convention(c) (UnsafeRawPointer?) -> UnsafeMutableRawPointer?
    private typealias FnSendDestroy = @convention(c) (UnsafeMutableRawPointer?) -> Void
    private typealias FnSendVideoV2 = @convention(c) (UnsafeMutableRawPointer?, UnsafeRawPointer?) -> Void

    private var fnInitialize: FnInitialize?
    private var fnSendCreate: FnSendCreate?
    private var fnSendDestroy: FnSendDestroy?
    private var fnSendVideoV2: FnSendVideoV2?

    // NDI_LIB_FOURCC('B', 'G', 'R', 'A')
    private static let fourCCBGRA: UInt32 = 0x41524742
    private static let timecodeSynthesize: Int64 = Int64.max

    public init() {
        let byteCount = outputWidth * outputHeight * 4
        self.bgraBuffer = [UInt8](repeating: 0, count: byteCount)
        self.sendBuffer = [UInt8](repeating: 0, count: byteCount)
        loadRuntimeIfAvailable()
    }

    deinit {
        if let inst = ndiSendInstance, let destroy = fnSendDestroy {
            destroy(inst)
        }
        if let h = dylibHandle {
            dlclose(h)
        }
    }

    private func loadRuntimeIfAvailable() {
        let candidatePaths = [
            "/usr/local/lib/libndi.dylib",
            "/Library/NDI SDK for Apple/lib/macOS/libndi.dylib",
            "/opt/homebrew/lib/libndi.dylib"
        ]
        for path in candidatePaths where FileManager.default.fileExists(atPath: path) {
            if let handle = dlopen(path, RTLD_NOW) {
                if let pInit = dlsym(handle, "NDIlib_initialize"),
                   let pCreate = dlsym(handle, "NDIlib_send_create"),
                   let pDestroy = dlsym(handle, "NDIlib_send_destroy"),
                   let pSend = dlsym(handle, "NDIlib_send_send_video_v2") {
                    self.dylibHandle = handle
                    self.fnInitialize = unsafeBitCast(pInit, to: FnInitialize.self)
                    self.fnSendCreate = unsafeBitCast(pCreate, to: FnSendCreate.self)
                    self.fnSendDestroy = unsafeBitCast(pDestroy, to: FnSendDestroy.self)
                    self.fnSendVideoV2 = unsafeBitCast(pSend, to: FnSendVideoV2.self)
                    if self.fnInitialize?() == true {
                        self.isRuntimeAvailable = true
                        self.statusText = "NDI Ready"
                        return
                    }
                }
                dlclose(handle)
            }
        }
        self.isRuntimeAvailable = false
        self.statusText = "NDI Runtime not found"
    }

    private func startSender() {
        guard isRuntimeAvailable, let createFn = fnSendCreate else {
            DispatchQueue.main.async {
                self.isEnabled = false
                self.statusText = "Install NDI Runtime (/usr/local/lib/libndi.dylib)"
            }
            return
        }
        let name = sourceName.isEmpty ? "Puppet Studio" : sourceName
        ndiQueue.async { [weak self] in
            guard let self else { return }
            if let existing = self.ndiSendInstance, let destroy = self.fnSendDestroy {
                destroy(existing)
                self.ndiSendInstance = nil
            }
            let created: UnsafeMutableRawPointer? = name.withCString { cName in
                var cfg = NDIlibSendCreate(
                    p_ndi_name: cName,
                    p_groups: nil,
                    clock_video: false,
                    clock_audio: false
                )
                return withUnsafePointer(to: &cfg) { createFn(UnsafeRawPointer($0)) }
            }
            self.ndiSendInstance = created
            DispatchQueue.main.async {
                self.framesSent = 0
                self.statusText = (created != nil) ? "NDI Live: \(name) (Alpha)" : "NDI Create Failed"
            }
        }
    }

    private func stopSender() {
        ndiQueue.async { [weak self] in
            guard let self else { return }
            if let inst = self.ndiSendInstance, let destroy = self.fnSendDestroy {
                destroy(inst)
                self.ndiSendInstance = nil
            }
            DispatchQueue.main.async {
                self.statusText = self.isRuntimeAvailable ? "NDI Ready" : "NDI Runtime not found"
            }
        }
    }

    private func restartSender() {
        stopSender()
        startSender()
    }

    /// Renders a SwiftUI character-only view (with transparent alpha background) and sends it over NDI at up to 30 FPS.
    @MainActor
    public func submitSwiftUIFrame<Content: View>(@ViewBuilder content: () -> Content) {
        guard isEnabled, isRuntimeAvailable else { return }
        let now = CACurrentMediaTime()
        guard (now - lastFrameSubmitTime) >= (1.0 / 30.0) else { return }
        guard !isSendingFrame else { return }
        lastFrameSubmitTime = now

        let renderer = ImageRenderer(content: content().frame(width: CGFloat(outputWidth), height: CGFloat(outputHeight)))
        renderer.scale = 1.0
        renderer.isOpaque = (backgroundMode != .transparentAlpha)
        guard let cgImg = renderer.cgImage else { return }

        let w = outputWidth
        let h = outputHeight
        let bytesPerRow = w * 4
        let bitmapInfo = CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
        let isAlphaMode = (backgroundMode == .transparentAlpha)

        bgraBuffer.withUnsafeMutableBytes { ptr in
            guard let base = ptr.baseAddress,
                  let ctx = CGContext(
                    data: base,
                    width: w,
                    height: h,
                    bitsPerComponent: 8,
                    bytesPerRow: bytesPerRow,
                    space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: bitmapInfo
                  ) else { return }
            ctx.clear(CGRect(x: 0, y: 0, width: w, height: h))
            ctx.draw(cgImg, in: CGRect(x: 0, y: 0, width: w, height: h))

            // Convert premultiplied BGRA -> straight BGRA for clean alpha edges in NDI receivers
            if isAlphaMode {
                let p = base.assumingMemoryBound(to: UInt8.self)
                let count = w * h * 4
                var i = 0
                while i < count {
                    let a = Int(p[i + 3])
                    if a == 0 {
                        p[i] = 0; p[i + 1] = 0; p[i + 2] = 0
                    } else if a < 255 {
                        p[i]     = UInt8(min(255, (Int(p[i])     * 255) / a))
                        p[i + 1] = UInt8(min(255, (Int(p[i + 1]) * 255) / a))
                        p[i + 2] = UInt8(min(255, (Int(p[i + 2]) * 255) / a))
                    }
                    i += 4
                }
            }
        }

        isSendingFrame = true
        sendBuffer = bgraBuffer
        ndiQueue.async { [weak self] in
            guard let self else { return }
            defer {
                DispatchQueue.main.async {
                    self.isSendingFrame = false
                }
            }
            guard let inst = self.ndiSendInstance, let sendFn = self.fnSendVideoV2 else { return }
            self.sendBuffer.withUnsafeMutableBufferPointer { bufPtr in
                var frame = NDIlibVideoFrameV2(
                    xres: Int32(w),
                    yres: Int32(h),
                    FourCC: Self.fourCCBGRA,
                    frame_rate_N: 30000,
                    frame_rate_D: 1000,
                    picture_aspect_ratio: Float(w) / Float(h),
                    frame_format_type: 1,
                    timecode: Self.timecodeSynthesize,
                    p_data: bufPtr.baseAddress,
                    line_stride_in_bytes: Int32(bytesPerRow),
                    p_metadata: nil,
                    timestamp: 0
                )
                withUnsafePointer(to: &frame) { sendFn(inst, UnsafeRawPointer($0)) }
            }
            DispatchQueue.main.async {
                self.framesSent += 1
            }
        }
    }
}
