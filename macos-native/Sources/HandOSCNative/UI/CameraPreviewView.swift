import SwiftUI
import AVFoundation

public struct CameraPreviewView: View {
    public let session: AVCaptureSession
    public let frame: TrackedFrame
    public let mirror: Bool
    public let isRunning: Bool
    public var inputSource: TrackerInputSource = .camera
    public var mediaImage: NSImage? = nil
    public var mediaFileName: String? = nil
    public var isMediaPlaying: Bool = true
    public var calibrationCountdown: Int = 0
    public var onSelectLiveCamera: (() -> Void)? = nil
    public var onLoadVideo: (() -> Void)? = nil
    public var onLoadPhoto: (() -> Void)? = nil
    public var onTogglePlayPause: (() -> Void)? = nil

    private static let handConnections: [(Int, Int)] = [
        (0, 1), (1, 2), (2, 3), (3, 4),
        (0, 5), (5, 6), (6, 7), (7, 8),
        (5, 9), (9, 10), (10, 11), (11, 12),
        (9, 13), (13, 14), (14, 15), (15, 16),
        (13, 17), (17, 18), (18, 19), (19, 20),
        (0, 17)
    ]

    private static let poseConnections: [(Int, Int)] = [
        (11, 12), (11, 23), (12, 24), (23, 24),
        (12, 14), (14, 16),
        (11, 13), (13, 15),
        (24, 26), (26, 28),
        (23, 25), (25, 27),
        (0, 2), (2, 7), (0, 5), (5, 8)
    ]

    public init(
        session: AVCaptureSession,
        frame: TrackedFrame,
        mirror: Bool,
        isRunning: Bool,
        inputSource: TrackerInputSource = .camera,
        mediaImage: NSImage? = nil,
        mediaFileName: String? = nil,
        isMediaPlaying: Bool = true,
        calibrationCountdown: Int = 0,
        onSelectLiveCamera: (() -> Void)? = nil,
        onLoadVideo: (() -> Void)? = nil,
        onLoadPhoto: (() -> Void)? = nil,
        onTogglePlayPause: (() -> Void)? = nil
    ) {
        self.session = session
        self.frame = frame
        self.mirror = mirror
        self.isRunning = isRunning
        self.inputSource = inputSource
        self.mediaImage = mediaImage
        self.mediaFileName = mediaFileName
        self.isMediaPlaying = isMediaPlaying
        self.calibrationCountdown = calibrationCountdown
        self.onSelectLiveCamera = onSelectLiveCamera
        self.onLoadVideo = onLoadVideo
        self.onLoadPhoto = onLoadPhoto
        self.onTogglePlayPause = onTogglePlayPause
    }

    public var body: some View {
        ZStack {
            Color.black

            if inputSource == .camera {
                AVCapturePreviewRepresentable(session: session, mirror: mirror)
                    .opacity(isRunning ? 1.0 : 0.0)
            } else if let img = mediaImage {
                Image(nsImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .scaleEffect(x: mirror ? -1.0 : 1.0, y: 1.0)
                    .opacity(isRunning ? 1.0 : 0.35)
            }

            if isRunning {
                Canvas { context, size in
                    let videoAspect: CGFloat = {
                        if inputSource != .camera, let img = mediaImage, img.size.height > 1 {
                            return img.size.width / img.size.height
                        }
                        return CGFloat(max(0.35, frame.frameAspect))
                    }()
                    let viewAspect = size.width / max(1, size.height)
                    let drawRect: CGRect
                    if viewAspect > videoAspect {
                        let w = size.height * videoAspect
                        drawRect = CGRect(x: (size.width - w) / 2, y: 0, width: w, height: size.height)
                    } else {
                        let h = size.width / videoAspect
                        drawRect = CGRect(x: 0, y: (size.height - h) / 2, width: size.width, height: h)
                    }

                    let mapPoint = { (lm: Landmark) -> CGPoint in
                        let nx = mirror ? CGFloat(1.0 - lm.x) : CGFloat(lm.x)
                        let ny = CGFloat(lm.y)
                        return CGPoint(
                            x: drawRect.minX + nx * drawRect.width,
                            y: drawRect.minY + ny * drawRect.height
                        )
                    }

                    // 1. Draw Hands (skip stale ghost hands so tracking window stays clean)
                    let handLineColor = Color(red: 120 / 255, green: 255 / 255, blue: 180 / 255).opacity(0.9)
                    let handDotColor = Color(red: 255 / 255, green: 180 / 255, blue: 80 / 255).opacity(0.95)

                    for hand in frame.hands where !hand.isGhost {
                        let lms = hand.smoothedLandmarks
                        guard lms.count >= 21 else { continue }

                        var path = Path()
                        for (a, b) in Self.handConnections {
                            let la = lms[a]
                            let lb = lms[b]
                            guard hypot(la.x - lb.x, la.y - lb.y) <= 0.28 else { continue }
                            let pa = mapPoint(la)
                            let pb = mapPoint(lb)
                            path.move(to: pa)
                            path.addLine(to: pb)
                        }
                        context.stroke(path, with: .color(handLineColor), lineWidth: 2.5)

                        for lm in lms {
                            let p = mapPoint(lm)
                            let rect = CGRect(x: p.x - 4, y: p.y - 4, width: 8, height: 8)
                            context.fill(Path(ellipseIn: rect), with: .color(handDotColor))
                        }
                    }

                    // 2. Draw Pose (only live fresh joints so no ghost skeleton remains)
                    if !frame.poseLandmarks.isEmpty {
                        let poseLineColor = Color(red: 140 / 255, green: 180 / 255, blue: 255 / 255).opacity(0.85)
                        let poseDotColor = Color(red: 255 / 255, green: 120 / 255, blue: 200 / 255).opacity(0.9)
                        let hasFreshMask = frame.poseJointFresh.count == frame.poseLandmarks.count

                        var posePath = Path()
                        for (a, b) in Self.poseConnections {
                            guard a < frame.poseLandmarks.count,
                                  b < frame.poseLandmarks.count,
                                  !hasFreshMask || (frame.poseJointFresh[a] && frame.poseJointFresh[b]),
                                  let la = frame.poseLandmarks[a],
                                  let lb = frame.poseLandmarks[b],
                                  hypot(la.x - lb.x, la.y - lb.y) <= 0.58 else { continue }
                            posePath.move(to: mapPoint(la))
                            posePath.addLine(to: mapPoint(lb))
                        }
                        context.stroke(posePath, with: .color(poseLineColor), lineWidth: 2.5)

                        for (idx, lmOpt) in frame.poseLandmarks.enumerated() {
                            guard !hasFreshMask || frame.poseJointFresh[idx],
                                  let lm = lmOpt else { continue }
                            let p = mapPoint(lm)
                            let rect = CGRect(x: p.x - 4.5, y: p.y - 4.5, width: 9, height: 9)
                            context.fill(Path(ellipseIn: rect), with: .color(poseDotColor))
                        }
                    }

                    // 3. Draw Face
                    if !frame.faceLandmarks.isEmpty {
                        let faceDotColor = Color(red: 180 / 255, green: 220 / 255, blue: 255 / 255).opacity(0.88)
                        for lm in frame.faceLandmarks {
                            let p = mapPoint(lm)
                            let rect = CGRect(x: p.x - 2.0, y: p.y - 2.0, width: 4.0, height: 4.0)
                            context.fill(Path(ellipseIn: rect), with: .color(faceDotColor))
                        }
                    }
                }
                .allowsHitTesting(false)
            } else {
                VStack(spacing: 10) {
                    Image(systemName: "hand.raised.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(.secondary.opacity(0.5))
                    Text("Start camera or load a reference video / photo")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }

            if calibrationCountdown > 0 {
                ZStack {
                    Color.black.opacity(0.45)
                    VStack(spacing: 6) {
                        Text("\(calibrationCountdown)")
                            .font(.system(size: 46, weight: .black, design: .rounded))
                            .foregroundStyle(.cyan)
                        Text("Hold Neutral / A-Pose…")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 12)
                    .background(.ultraThinMaterial)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .allowsHitTesting(false)
            }

            if onLoadVideo != nil || onLoadPhoto != nil {
                VStack {
                    HStack(spacing: 4) {
                        if let onCam = onSelectLiveCamera {
                            Button(action: onCam) {
                                Image(systemName: "video.fill")
                                    .font(.system(size: 9.5, weight: .bold))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 4)
                                    .background(inputSource == .camera ? Color.cyan.opacity(0.85) : Color.black.opacity(0.55))
                                    .foregroundStyle(inputSource == .camera ? .black : .white)
                                    .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .help("Use Live Camera")
                        }

                        if let onVid = onLoadVideo {
                            Button(action: onVid) {
                                HStack(spacing: 3) {
                                    Image(systemName: "film")
                                    Text("Video")
                                }
                                .font(.system(size: 9.5, weight: .semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 4)
                                .background(inputSource == .videoFile ? Color.cyan.opacity(0.85) : Color.black.opacity(0.55))
                                .foregroundStyle(inputSource == .videoFile ? .black : .white)
                                .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .help("Load a video file (.mp4/.mov) to test & tune puppet motion hands-free")
                        }

                        if let onImg = onLoadPhoto {
                            Button(action: onImg) {
                                HStack(spacing: 3) {
                                    Image(systemName: "photo")
                                    Text("Photo")
                                }
                                .font(.system(size: 9.5, weight: .semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 4)
                                .background(inputSource == .stillImage ? Color.cyan.opacity(0.85) : Color.black.opacity(0.55))
                                .foregroundStyle(inputSource == .stillImage ? .black : .white)
                                .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .help("Load a reference pose photo (.png/.jpg) to adjust rig settings without holding poses")
                        }

                        if inputSource == .videoFile, let onPlayPause = onTogglePlayPause {
                            Button(action: onPlayPause) {
                                Image(systemName: isMediaPlaying ? "pause.fill" : "play.fill")
                                    .font(.system(size: 9.5, weight: .bold))
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 4)
                                    .background(Color.yellow.opacity(0.85))
                                    .foregroundStyle(.black)
                                    .clipShape(Capsule())
                            }
                            .buttonStyle(.plain)
                            .help(isMediaPlaying ? "Pause video on this pose frame" : "Resume video playback")
                        }

                        Spacer()
                    }
                    .padding(6)
                    Spacer()
                }
            }
        }
        .aspectRatio(16.0 / 9.0, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.white.opacity(0.1), lineWidth: 1)
        )
    }
}

private struct AVCapturePreviewRepresentable: NSViewRepresentable {
    let session: AVCaptureSession
    let mirror: Bool

    func makeNSView(context: Context) -> PreviewNSView {
        let view = PreviewNSView()
        view.setSession(session)
        view.setMirrored(mirror)
        return view
    }

    func updateNSView(_ nsView: PreviewNSView, context: Context) {
        nsView.setSession(session)
        nsView.setMirrored(mirror)
    }
}

private final class PreviewNSView: NSView {
    private let previewLayer = AVCaptureVideoPreviewLayer()
    private var isMirrored: Bool = true

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor
        previewLayer.videoGravity = .resizeAspect
        layer?.addSublayer(previewLayer)
    }

    convenience init() {
        self.init(frame: .zero)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func setSession(_ session: AVCaptureSession) {
        if previewLayer.session !== session {
            previewLayer.session = session
        }
    }

    func setMirrored(_ mirror: Bool) {
        isMirrored = mirror
        updateLayerTransform()
    }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        previewLayer.frame = bounds
        updateLayerTransform()
        CATransaction.commit()
    }

    private func updateLayerTransform() {
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if isMirrored {
            previewLayer.transform = CATransform3DMakeScale(-1, 1, 1)
        } else {
            previewLayer.transform = CATransform3DIdentity
        }
        previewLayer.frame = bounds
        CATransaction.commit()
    }
}
