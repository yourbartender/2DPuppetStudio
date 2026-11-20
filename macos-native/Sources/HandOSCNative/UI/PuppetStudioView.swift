import SwiftUI
import AppKit
import UniformTypeIdentifiers
import QuartzCore

// MARK: - Reusable Part Replace Menu (From Paper Puppet Sheet / From Finder)

public struct PuppetPartReplaceMenu: View {
    @ObservedObject public var puppet: PuppetController
    public let slot: PuppetPartSlot
    public var title: String = "Replace…"
    public var font: Font = .system(size: 10)

    public init(puppet: PuppetController, slot: PuppetPartSlot, title: String = "Replace…", font: Font = .system(size: 10)) {
        self.puppet = puppet
        self.slot = slot
        self.title = title
        self.font = font
    }

    public var body: some View {
        Menu {
            Button {
                puppet.showSheetImporter = true
            } label: {
                Label("From Paper Puppet Sheet…", systemImage: "scissors")
            }

            Button {
                let panel = NSOpenPanel()
                panel.title = "Import Graphic for \(slot.title)"
                panel.allowedContentTypes = [.png, .jpeg, .tiff, UTType(filenameExtension: "webp")].compactMap { $0 }
                panel.allowsMultipleSelection = false
                if panel.runModal() == .OK, let url = panel.url {
                    puppet.loadImage(from: url, for: slot)
                }
            } label: {
                Label("From Finder (PNG/JPG)…", systemImage: "folder")
            }
        } label: {
            Label(title, systemImage: "photo.badge.plus")
                .font(font)
        }
        .help("Replace graphic from sprite sheet or Finder")
    }
}

// MARK: - Live 2D Puppet Stage View

public struct PuppetStageView: View {
    @ObservedObject public var puppet: PuppetController
    public let frame: TrackedFrame
    public let onCalibrate: () -> Void
    public let isCalibrated: Bool
    public var fillsWindow: Bool = false
    public var showOverlayControls: Bool = true
    public var onToggleFullStage: (() -> Void)? = nil

    @State private var zoomScale: CGFloat = 1.0
    @GestureState private var livePuppetDrag: CGSize = .zero
    @State private var isPoseFrozen: Bool = false
    @State private var frozenPoseFrame: TrackedFrame? = nil
    @State private var frozenPoseTime: TimeInterval = 0
    @State private var activeTransformSession: FreeTransformDragSession? = nil
    @State private var transformDragCursorView: CGPoint = .zero
    @State private var transformDragStatusText: String = ""

    private enum FreeTransformHandleKind: CaseIterable {
        case topLeft, top, topRight, right, bottomRight, bottom, bottomLeft, left, rotate, moveBodyPart
    }

    private struct FreeTransformDragSession {
        let slot: PuppetPartSlot
        let handle: FreeTransformHandleKind
        let startWidth: Double
        let startHeight: Double
        let startRotationDeg: Double
        let startOffset: CGSize
        let startViewTransform: CGAffineTransform
        let startInvViewTransform: CGAffineTransform
        let startBoxSize: CGSize
        let startPivotLocal: CGPoint
        let startPivotView: CGPoint
        let startDragView: CGPoint
        let startDragAngle: CGFloat
        let frozenFrame: TrackedFrame
        let frozenTime: TimeInterval
    }

    private struct PlacedStagePart {
        let slot: PuppetPartSlot
        let image: NSImage?
        let localBounds: CGRect
        let localToStage: CGAffineTransform
        let boxSize: CGSize
        let boxToStage: CGAffineTransform
        let pivotInBox: CGPoint
        let drawAction: (inout GraphicsContext) -> Void
    }

    private struct StageLayoutResult {
        let parts: [PlacedStagePart]
        let stagePins: [(point: CGPoint, color: Color)]
        let trackedHandChains: [(wristStage: CGPoint, hand: TrackedHand, visualScale: CGFloat)]
    }

    public init(
        puppet: PuppetController,
        frame: TrackedFrame,
        isCalibrated: Bool,
        onCalibrate: @escaping () -> Void,
        fillsWindow: Bool = false,
        showOverlayControls: Bool = true,
        onToggleFullStage: (() -> Void)? = nil
    ) {
        self.puppet = puppet
        self.frame = frame
        self.isCalibrated = isCalibrated
        self.onCalibrate = onCalibrate
        self.fillsWindow = fillsWindow
        self.showOverlayControls = showOverlayControls
        self.onToggleFullStage = onToggleFullStage
    }

    public var body: some View {
        VStack(spacing: fillsWindow ? 0 : 8) {
            if showOverlayControls {
                stageToolbar
            }

            GeometryReader { geo in
                TimelineView(.animation(minimumInterval: 1.0 / 60.0)) { timeline in
                    let resolved = activeFrameAndTime(now: timeline.date.timeIntervalSinceReferenceDate)
                    let layout = computeStageLayout(in: geo.size, frame: resolved.frame, time: resolved.time)

                    ZStack {
                        // Stationary Stage Background (fills window, never shifts during character drag)
                        puppet.stageBackground.color

                        // Live Puppet Stage Canvas (rendered Back-to-Front strictly by puppet.layerStack)
                        Canvas { context, size in
                            context.concatenate(viewZoomTransform(in: size))
                            for part in layout.parts {
                                part.drawAction(&context)
                            }
                            if puppet.showPinsOnStage {
                                for pinItem in layout.stagePins {
                                    drawStagePin(context: &context, at: pinItem.point, color: pinItem.color)
                                }
                                drawTrackedHandSkeletons(context: &context, chains: layout.trackedHandChains)
                            }
                        }

                        // Background Pan & Tap-to-Select Hit Layer (sits below Free Transform handles)
                        Color.clear
                            .contentShape(Rectangle())
                            .gesture(
                                DragGesture(minimumDistance: 3, coordinateSpace: .named("stageSpace"))
                                    .updating($livePuppetDrag) { value, state, _ in
                                        state = value.translation
                                    }
                                    .onEnded { value in
                                        puppet.stagePuppetOffset.width += value.translation.width / zoomScale
                                        puppet.stagePuppetOffset.height += value.translation.height / zoomScale
                                        puppet.saveCurrentPresetState()
                                    }
                            )
                            .onTapGesture(count: 2) {
                                withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                                    zoomScale = 1.0
                                    puppet.stagePuppetOffset = .zero
                                    puppet.saveCurrentPresetState()
                                }
                            }
                            .simultaneousGesture(
                                SpatialTapGesture(coordinateSpace: .named("stageSpace"))
                                    .onEnded { value in
                                        selectBodyPart(at: value.location, in: geo.size, layout: layout)
                                    }
                            )

                        // Interactive Photoshop-Style On-Stage Free Transform Box & Handles
                        if puppet.showStageTransformBox,
                           let activePart = layout.parts.first(where: { $0.slot == puppet.selectedSlot }) {
                            freeTransformOverlay(for: activePart, in: geo.size, layout: layout, resolved: resolved)
                        }
                    }
                    .coordinateSpace(name: "stageSpace")
                }
                .frame(width: geo.size.width, height: geo.size.height)
                .clipped()
            }
            .clipped()
            .clipShape(RoundedRectangle(cornerRadius: fillsWindow ? 0 : 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: fillsWindow ? 0 : 12, style: .continuous)
                    .stroke(Color.white.opacity(fillsWindow ? 0 : 0.1), lineWidth: 1)
            )
            .frame(minHeight: fillsWindow ? nil : 520, idealHeight: fillsWindow ? nil : 600, maxHeight: fillsWindow ? .infinity : 820)
        }
        .frame(maxWidth: .infinity, maxHeight: fillsWindow ? .infinity : nil)
    }

    private func activeFrameAndTime(now: TimeInterval) -> (frame: TrackedFrame, time: TimeInterval) {
        if let session = activeTransformSession {
            return (session.frozenFrame, session.frozenTime)
        }
        if isPoseFrozen, let ff = frozenPoseFrame {
            return (ff, frozenPoseTime)
        }
        return (frame, now)
    }

    private func viewZoomTransform(in size: CGSize) -> CGAffineTransform {
        guard zoomScale != 1.0 else { return .identity }
        var xf = CGAffineTransform.identity
        xf = xf.translatedBy(x: size.width * 0.5, y: size.height * 0.5)
        xf = xf.scaledBy(x: zoomScale, y: zoomScale)
        xf = xf.translatedBy(x: -size.width * 0.5, y: -size.height * 0.5)
        return xf
    }

    private func partOffsetUnit(in size: CGSize, scaleDelta: CGFloat) -> CGFloat {
        max(40.0, size.height * CGFloat(puppet.characterScale) * scaleDelta)
    }

    private func handleLocalPoint(_ handle: FreeTransformHandleKind, boxSize: CGSize) -> CGPoint {
        let w = boxSize.width
        let h = boxSize.height
        switch handle {
        case .topLeft: return CGPoint(x: 0, y: 0)
        case .top: return CGPoint(x: w * 0.5, y: 0)
        case .topRight: return CGPoint(x: w, y: 0)
        case .right: return CGPoint(x: w, y: h * 0.5)
        case .bottomRight: return CGPoint(x: w, y: h)
        case .bottom: return CGPoint(x: w * 0.5, y: h)
        case .bottomLeft: return CGPoint(x: 0, y: h)
        case .left: return CGPoint(x: 0, y: h * 0.5)
        case .rotate: return CGPoint(x: w * 0.5, y: -26)
        case .moveBodyPart: return CGPoint(x: w * 0.5, y: h * 0.5)
        }
    }

    @ViewBuilder
    private func freeTransformOverlay(
        for part: PlacedStagePart,
        in size: CGSize,
        layout: StageLayoutResult,
        resolved: (frame: TrackedFrame, time: TimeInterval)
    ) -> some View {
        let zoomXf = viewZoomTransform(in: size)
        let boxToView = part.boxToStage.concatenating(zoomXf)
        let w = part.boxSize.width
        let h = part.boxSize.height

        let tl = CGPoint(x: 0, y: 0).applying(boxToView)
        let tm = CGPoint(x: w * 0.5, y: 0).applying(boxToView)
        let tr = CGPoint(x: w, y: 0).applying(boxToView)
        let rm = CGPoint(x: w, y: h * 0.5).applying(boxToView)
        let br = CGPoint(x: w, y: h).applying(boxToView)
        let bm = CGPoint(x: w * 0.5, y: h).applying(boxToView)
        let bl = CGPoint(x: 0, y: h).applying(boxToView)
        let lm = CGPoint(x: 0, y: h * 0.5).applying(boxToView)
        let pivotView = part.pivotInBox.applying(boxToView)

        // Screen-space upward normal from Top midpoint for the Rotate stem & lollipop
        let edgeDx = tr.x - tl.x
        let edgeDy = tr.y - tl.y
        let edgeLen = max(1.0, hypot(edgeDx, edgeDy))
        // Screen normal perpendicular to Top edge (points toward -Y of box)
        let centerView = CGPoint(x: w * 0.5, y: h * 0.5).applying(boxToView)
        let candA = CGPoint(x: edgeDy / edgeLen, y: -edgeDx / edgeLen)
        let candB = CGPoint(x: -edgeDy / edgeLen, y: edgeDx / edgeLen)
        let dotA = candA.x * (tm.x - centerView.x) + candA.y * (tm.y - centerView.y)
        let upDir = (dotA >= 0) ? candA : candB
        let rotHandleView = CGPoint(x: tm.x + upDir.x * 26.0, y: tm.y + upDir.y * 26.0)

        let boxQuadPath = Path { p in
            p.move(to: tl)
            p.addLine(to: tr)
            p.addLine(to: br)
            p.addLine(to: bl)
            p.closeSubpath()
        }

        let stemPath = Path { p in
            p.move(to: tm)
            p.addLine(to: rotHandleView)
        }

        let resizeHandles: [(kind: FreeTransformHandleKind, pos: CGPoint)] = [
            (.topLeft, tl), (.top, tm), (.topRight, tr),
            (.right, rm), (.bottomRight, br), (.bottom, bm),
            (.bottomLeft, bl), (.left, lm)
        ]

        ZStack {
            // Interior move/select surface + Photoshop Context Menu
            boxQuadPath
                .fill(Color.cyan.opacity(0.025))
                .contentShape(boxQuadPath)
                .gesture(
                    DragGesture(minimumDistance: 3, coordinateSpace: .named("stageSpace"))
                        .onChanged { value in
                            handleTransformDragChanged(
                                handle: .moveBodyPart,
                                part: part,
                                boxToView: boxToView,
                                pivotView: pivotView,
                                in: size,
                                resolved: resolved,
                                value: value
                            )
                        }
                        .onEnded { _ in
                            endTransformDragSession()
                        }
                )
                .simultaneousGesture(
                    SpatialTapGesture(coordinateSpace: .named("stageSpace"))
                        .onEnded { tap in
                            selectBodyPart(at: tap.location, in: size, layout: layout)
                        }
                )
                .contextMenu {
                    transformContextMenu(for: part.slot)
                }

            // Crisp Transform Frame & Rotation Stem
            boxQuadPath
                .stroke(Color.cyan.opacity(0.95), style: StrokeStyle(lineWidth: 1.5))
                .allowsHitTesting(false)

            stemPath
                .stroke(Color.cyan.opacity(0.9), lineWidth: 1.5)
                .allowsHitTesting(false)

            // Pivot Crosshair Marker (joint center)
            ZStack {
                Circle()
                    .stroke(Color.black.opacity(0.75), lineWidth: 2.5)
                    .frame(width: 11, height: 11)
                Circle()
                    .stroke(Color.yellow, lineWidth: 1.4)
                    .frame(width: 11, height: 11)
                Path { p in
                    p.move(to: CGPoint(x: 1, y: 7))
                    p.addLine(to: CGPoint(x: 13, y: 7))
                    p.move(to: CGPoint(x: 7, y: 1))
                    p.addLine(to: CGPoint(x: 7, y: 13))
                }
                .stroke(Color.yellow, lineWidth: 1.2)
                .frame(width: 14, height: 14)
            }
            .position(pivotView)
            .allowsHitTesting(false)

            // Small Selected Part Chip anchored neatly at bottom-left of box (never blocking body)
            HStack(spacing: 4) {
                Text(part.slot.title)
                    .font(.system(size: 9.5, weight: .bold))
                if let idx = puppet.layerStack.firstIndex(of: part.slot) {
                    Text("#\(idx + 1)")
                        .font(.system(size: 8.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Color.cyan)
                }
            }
            .foregroundStyle(Color.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.black.opacity(0.78))
            .clipShape(Capsule())
            .overlay(Capsule().stroke(Color.cyan.opacity(0.7), lineWidth: 1))
            .position(x: min(size.width - 55, max(55, (bl.x + br.x) * 0.5)), y: min(size.height - 14, max(30, max(bl.y, br.y) + 14)))
            .allowsHitTesting(false)

            // 8 Interactive Corner/Edge Scale Handles
            ForEach(resizeHandles, id: \.kind) { item in
                let isDraggingThis = (activeTransformSession?.handle == item.kind)
                ZStack {
                    Color.clear
                        .frame(width: 22, height: 22)
                        .contentShape(Rectangle())
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(isDraggingThis ? Color.yellow : Color.white)
                        .frame(width: 8, height: 8)
                        .overlay(
                            RoundedRectangle(cornerRadius: 1.5)
                                .stroke(Color.black.opacity(0.85), lineWidth: 1.2)
                        )
                }
                .position(item.pos)
                .gesture(
                    DragGesture(minimumDistance: 1, coordinateSpace: .named("stageSpace"))
                        .onChanged { value in
                            handleTransformDragChanged(
                                handle: item.kind,
                                part: part,
                                boxToView: boxToView,
                                pivotView: pivotView,
                                in: size,
                                resolved: resolved,
                                value: value
                            )
                        }
                        .onEnded { _ in
                            endTransformDragSession()
                        }
                )
            }

            // Interactive Rotation Lollipop Handle (continuous smooth rotation around pivot)
            let isRotating = (activeTransformSession?.handle == .rotate)
            ZStack {
                Color.clear
                    .frame(width: 24, height: 24)
                    .contentShape(Circle())
                Circle()
                    .fill(isRotating ? Color.yellow : Color.cyan)
                    .frame(width: 12, height: 12)
                    .overlay(Circle().stroke(Color.black.opacity(0.85), lineWidth: 1.3))
                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 7, weight: .black))
                    .foregroundStyle(.black)
            }
            .position(rotHandleView)
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .named("stageSpace"))
                    .onChanged { value in
                        handleTransformDragChanged(
                            handle: .rotate,
                            part: part,
                            boxToView: boxToView,
                            pivotView: pivotView,
                            in: size,
                            resolved: resolved,
                            value: value
                        )
                    }
                    .onEnded { _ in
                        endTransformDragSession()
                    }
            )
            .help("Drag smoothly to rotate around pivot (Hold Shift to snap 15°)")

            // Subtle live HUD readout only while actively dragging a handle
            if !transformDragStatusText.isEmpty && activeTransformSession != nil {
                Text(transformDragStatusText)
                    .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                    .foregroundStyle(.black)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(Color.yellow.opacity(0.95))
                    .clipShape(RoundedRectangle(cornerRadius: 5))
                    .shadow(color: .black.opacity(0.4), radius: 4)
                    .position(
                        x: min(size.width - 60, max(60, transformDragCursorView.x + 28)),
                        y: min(size.height - 20, max(20, transformDragCursorView.y - 24))
                    )
                    .allowsHitTesting(false)
            }
        }
    }

    @ViewBuilder
    private func transformContextMenu(for slot: PuppetPartSlot) -> some View {
        Button {
            puppet.moveLayerForward(slot)
        } label: {
            Label("Bring Forward", systemImage: "arrow.up")
        }
        .disabled(!puppet.canMoveLayerForward(slot))

        Button {
            puppet.moveLayerBackward(slot)
        } label: {
            Label("Send Backward", systemImage: "arrow.down")
        }
        .disabled(!puppet.canMoveLayerBackward(slot))

        Button {
            puppet.moveLayerToFront(slot)
        } label: {
            Label("Bring to Front", systemImage: "square.3.layers.3d.top.filled")
        }
        .disabled(!puppet.canMoveLayerForward(slot))

        Button {
            puppet.moveLayerToBack(slot)
        } label: {
            Label("Send to Back", systemImage: "square.3.layers.3d.bottom.filled")
        }
        .disabled(!puppet.canMoveLayerBackward(slot))

        Divider()

        Button {
            puppet.togglePartFlipH(slot)
        } label: {
            Label(puppet.isPartFlippedH(slot) ? "Unflip Horizontal" : "Flip Horizontal", systemImage: "arrow.left.and.right.righttriangle.left.righttriangle.right")
        }

        Button {
            puppet.togglePartFlipV(slot)
        } label: {
            Label(puppet.isPartFlippedV(slot) ? "Unflip Vertical" : "Flip Vertical", systemImage: "arrow.up.and.down.righttriangle.up.righttriangle.down")
        }

        Divider()

        Button {
            puppet.followChildrenOnMove.toggle()
        } label: {
            Label("Children Follow Move", systemImage: puppet.followChildrenOnMove ? "checkmark" : "link")
        }

        Button {
            puppet.followChildrenOnRotate.toggle()
        } label: {
            Label("Children Follow Rotate", systemImage: puppet.followChildrenOnRotate ? "checkmark" : "arrow.triangle.2.circlepath")
        }

        Divider()

        Button {
            puppet.resetPartTransform(for: slot)
        } label: {
            Label("Reset Part Transform", systemImage: "arrow.counterclockwise")
        }

        Button {
            puppet.showStageTransformBox = false
        } label: {
            Label("Hide Selection Box", systemImage: "xmark")
        }
    }

    private func handleTransformDragChanged(
        handle: FreeTransformHandleKind,
        part: PlacedStagePart,
        boxToView: CGAffineTransform,
        pivotView: CGPoint,
        in size: CGSize,
        resolved: (frame: TrackedFrame, time: TimeInterval),
        value: DragGesture.Value
    ) {
        if activeTransformSession == nil {
            puppet.recordUndoSnapshot()
            let startAng = atan2(value.startLocation.y - pivotView.y, value.startLocation.x - pivotView.x)
            activeTransformSession = FreeTransformDragSession(
                slot: part.slot,
                handle: handle,
                startWidth: Double(puppet.partWidth(for: part.slot)),
                startHeight: Double(puppet.partHeight(for: part.slot)),
                startRotationDeg: puppet.partRotationDegrees(for: part.slot),
                startOffset: puppet.partOffset(for: part.slot),
                startViewTransform: boxToView,
                startInvViewTransform: boxToView.inverted(),
                startBoxSize: part.boxSize,
                startPivotLocal: part.pivotInBox,
                startPivotView: pivotView,
                startDragView: value.startLocation,
                startDragAngle: startAng,
                frozenFrame: resolved.frame,
                frozenTime: resolved.time
            )
        }

        guard let session = activeTransformSession else { return }
        transformDragCursorView = value.location
        let shiftHeld = NSEvent.modifierFlags.contains(.shift)

        switch session.handle {
        case .moveBodyPart:
            let dvX: CGFloat = value.location.x - session.startDragView.x
            let dvY: CGFloat = value.location.y - session.startDragView.y
            let dsX: CGFloat = dvX / max(0.25, zoomScale)
            let dsY: CGFloat = dvY / max(0.25, zoomScale)
            let scaleDelta = max(0.60, min(1.55, 1.0 + (CGFloat(session.frozenFrame.faceMetrics.headScale) - 1.0) * CGFloat(puppet.headScaleAmount)))
            let unit = partOffsetUnit(in: size, scaleDelta: scaleDelta)
            let nx: CGFloat = session.startOffset.width + dsX / unit
            let ny: CGFloat = session.startOffset.height + dsY / unit
            puppet.setPartOffset(CGSize(width: nx, height: ny), for: session.slot)
            transformDragStatusText = String(format: "Δ %.0f, %.0f px", dsX, dsY)

        case .rotate:
            let curAngle = atan2(value.location.y - session.startPivotView.y, value.location.x - session.startPivotView.x)
            let diff = curAngle - session.startDragAngle
            let deltaRad = atan2(sin(diff), cos(diff))
            var newDeg = session.startRotationDeg + Double(deltaRad) * 180.0 / .pi
            while newDeg > 180.0 { newDeg -= 360.0 }
            while newDeg < -180.0 { newDeg += 360.0 }
            if shiftHeld {
                newDeg = (newDeg / 15.0).rounded() * 15.0
            }
            puppet.setPartRotationDegrees(newDeg, for: session.slot)
            transformDragStatusText = String(format: "%+.1f°", newDeg)

        case .left, .right, .top, .bottom, .topLeft, .topRight, .bottomRight, .bottomLeft:
            let localPt = value.location.applying(session.startInvViewTransform)
            let startLocal = handleLocalPoint(session.handle, boxSize: session.startBoxSize)

            let affectsX: Bool = (session.handle != .top && session.handle != .bottom)
            let affectsY: Bool = (session.handle != .left && session.handle != .right)
            let isCorner: Bool = affectsX && affectsY

            let ratioX: Double = {
                guard affectsX else { return 1.0 }
                let startSpan = startLocal.x - session.startPivotLocal.x
                let curSpan = localPt.x - session.startPivotLocal.x
                if abs(startSpan) >= max(8.0, session.startBoxSize.width * 0.14) {
                    return max(0.20, min(4.0, Double(curSpan / startSpan)))
                }
                let outSign: CGFloat = (startLocal.x >= session.startBoxSize.width * 0.5) ? 1.0 : -1.0
                let delta = (localPt.x - startLocal.x) * outSign / max(12.0, session.startBoxSize.width)
                return max(0.20, min(4.0, 1.0 + Double(delta)))
            }()

            let ratioY: Double = {
                guard affectsY else { return 1.0 }
                let startSpan = startLocal.y - session.startPivotLocal.y
                let curSpan = localPt.y - session.startPivotLocal.y
                if abs(startSpan) >= max(8.0, session.startBoxSize.height * 0.14) {
                    return max(0.20, min(4.0, Double(curSpan / startSpan)))
                }
                let outSign: CGFloat = (startLocal.y >= session.startBoxSize.height * 0.5) ? 1.0 : -1.0
                let delta = (localPt.y - startLocal.y) * outSign / max(12.0, session.startBoxSize.height)
                return max(0.20, min(4.0, 1.0 + Double(delta)))
            }()

            let finalRatioX = (isCorner && shiftHeld) ? (ratioX + ratioY) * 0.5 : ratioX
            let finalRatioY = (isCorner && shiftHeld) ? (ratioX + ratioY) * 0.5 : ratioY

            if affectsX {
                let clampedW = max(0.25, min(3.00, session.startWidth * finalRatioX))
                puppet.setPartWidth(clampedW, for: session.slot)
            }
            if affectsY {
                let clampedH = max(0.25, min(3.00, session.startHeight * finalRatioY))
                puppet.setPartHeight(clampedH, for: session.slot)
            }
            let curW = puppet.partWidth(for: session.slot)
            let curH = puppet.partHeight(for: session.slot)
            transformDragStatusText = String(format: "W %.0f%% × H %.0f%%", curW * 100, curH * 100)
        }
    }

    private func endTransformDragSession() {
        activeTransformSession = nil
        transformDragStatusText = ""
        puppet.saveCurrentPresetState()
    }

    private func isOpaquePixel(in img: NSImage, uv: CGPoint) -> Bool {
        guard uv.x >= -0.02, uv.x <= 1.02, uv.y >= -0.02, uv.y <= 1.02 else { return false }
        var rect = NSRect(origin: .zero, size: img.size)
        guard let cgImg = img.cgImage(forProposedRect: &rect, context: nil, hints: nil) else {
            return true
        }
        let w = cgImg.width
        let h = cgImg.height
        guard w > 0, h > 0 else { return true }
        let u = max(0.0, min(0.9999, uv.x))
        let v = max(0.0, min(0.9999, uv.y))
        let px = Int(u * CGFloat(w))
        let py = Int(v * CGFloat(h))
        let radiusPx = max(3, min(18, Int(max(w, h) / 180)))
        let cropX = max(0, min(w - 1, px - radiusPx))
        let cropY = max(0, min(h - 1, py - radiusPx))
        let cropW = min(radiusPx * 2 + 1, w - cropX)
        let cropH = min(radiusPx * 2 + 1, h - cropY)
        guard cropW > 0, cropH > 0,
              let cropped = cgImg.cropping(to: CGRect(x: cropX, y: cropY, width: cropW, height: cropH)) else {
            return false
        }
        let bufDim = 11
        var rgba = [UInt8](repeating: 0, count: bufDim * bufDim * 4)
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(
            data: &rgba,
            width: bufDim,
            height: bufDim,
            bitsPerComponent: 8,
            bytesPerRow: bufDim * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else {
            return true
        }
        ctx.draw(cropped, in: CGRect(x: 0, y: 0, width: bufDim, height: bufDim))
        for i in 0..<(bufDim * bufDim) {
            if rgba[i * 4 + 3] > 12 {
                return true
            }
        }
        return false
    }

    private func selectBodyPart(at location: CGPoint, in size: CGSize, layout: StageLayoutResult) {
        guard activeTransformSession == nil else { return }
        let zoomXf = viewZoomTransform(in: size)

        // Pass 1: Strict Front-to-Back Z-order test checking exact PNG alpha (clicking transparent gaps passes through!)
        for part in layout.parts.reversed() {
            let viewXf = part.localToStage.concatenating(zoomXf)
            let localPt = location.applying(viewXf.inverted())
            if part.localBounds.insetBy(dx: -4, dy: -4).contains(localPt) {
                let u = localPt.x / max(1.0, part.localBounds.width)
                let v = localPt.y / max(1.0, part.localBounds.height)
                if let img = part.image {
                    if isOpaquePixel(in: img, uv: CGPoint(x: u, y: v)) {
                        selectSlot(part.slot)
                        return
                    }
                } else if part.localBounds.contains(localPt) {
                    selectSlot(part.slot)
                    return
                }
            }
        }

        // Pass 2: Fallback bounding-box hit test if all overlapping sprites had transparent margin around the click
        for part in layout.parts.reversed() {
            let viewXf = part.localToStage.concatenating(zoomXf)
            let localPt = location.applying(viewXf.inverted())
            if part.localBounds.contains(localPt) {
                selectSlot(part.slot)
                return
            }
        }

        puppet.showStageTransformBox = false
    }

    private func selectSlot(_ slot: PuppetPartSlot) {
        puppet.selectedCategory = slot.category
        puppet.selectedSlot = slot
        puppet.showStageTransformBox = true
    }

    private var stageToolbar: some View {
        VStack(spacing: 6) {
            // Row 1: Character Name, Calibrate Neutral button, Viseme badge, BG Color, Full Stage toggle
            HStack(spacing: 8) {
                HStack(spacing: 5) {
                    Image(systemName: "figure.stand")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.cyan)
                    Text(puppet.characterName.isEmpty ? "Puppet" : puppet.characterName)
                        .font(.system(size: 11, weight: .bold))
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
                .padding(.horizontal, 9)
                .padding(.vertical, 5)
                .background(Color.black.opacity(0.65))
                .clipShape(Capsule())

                Button {
                    onCalibrate()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: isCalibrated ? "checkmark.circle.fill" : "scope")
                            .font(.system(size: 11))
                        Text(isCalibrated ? "Calibrated" : "Calibrate")
                            .font(.system(size: 11, weight: .medium))
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    .padding(.horizontal, 9)
                    .padding(.vertical, 5)
                    .background(isCalibrated ? Color.teal.opacity(0.25) : Color.orange.opacity(0.85))
                    .foregroundStyle(isCalibrated ? Color.teal : Color.black)
                    .clipShape(Capsule())
                }
                .buttonStyle(.plain)
                .fixedSize()

                // Active Viseme badge
                HStack(spacing: 4) {
                    Text(frame.faceMetrics.viseme.rawValue)
                        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Color.orange)
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.black.opacity(0.50))
                .clipShape(Capsule())
                .fixedSize()

                Spacer()

                // Hierarchical Follow IK Switches (Move & Rotate chain propagation)
                Menu {
                    Toggle("Children Follow Move", isOn: $puppet.followChildrenOnMove)
                    Toggle("Children Follow Rotate", isOn: $puppet.followChildrenOnRotate)
                } label: {
                    let bothOn = puppet.followChildrenOnMove && puppet.followChildrenOnRotate
                    let anyOn = puppet.followChildrenOnMove || puppet.followChildrenOnRotate
                    let modeTag = bothOn ? "M+R" : (puppet.followChildrenOnMove ? "Move" : (puppet.followChildrenOnRotate ? "Rot" : "Solo"))
                    HStack(spacing: 4) {
                        Image(systemName: anyOn ? "link" : "link.badge.minus")
                            .font(.system(size: 10, weight: .semibold))
                        Text("IK \(modeTag)")
                            .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(anyOn ? Color.teal.opacity(0.22) : Color.black.opacity(0.65))
                    .foregroundStyle(anyOn ? Color.teal : Color.secondary)
                    .clipShape(Capsule())
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .help("Follow IK Chain: choose whether child limbs follow parent Move and/or Rotate")

                // Stage Background Menu (Dark, Solid White, Chroma Green, Chroma Blue)
                Menu {
                    ForEach(PuppetStageBackground.allCases) { bg in
                        Button {
                            puppet.stageBackground = bg
                            puppet.saveCurrentPresetState()
                        } label: {
                            HStack {
                                Text(bg.label)
                                if puppet.stageBackground == bg {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(puppet.stageBackground.color)
                            .frame(width: 10, height: 10)
                            .overlay(Circle().stroke(Color.white.opacity(0.35), lineWidth: 1))
                        Image(systemName: "chevron.down")
                            .font(.system(size: 8))
                    }
                    .padding(.horizontal, 7)
                    .padding(.vertical, 5)
                    .background(Color.black.opacity(0.65))
                    .clipShape(Capsule())
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                .help("Stage Background: Dark, Solid White, Chroma Green, Chroma Blue")

                if let onToggleFullStage {
                    Button {
                        onToggleFullStage()
                    } label: {
                        Image(systemName: fillsWindow ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right")
                            .font(.system(size: 11, weight: .bold))
                            .padding(6)
                            .background(Color.black.opacity(0.65))
                            .foregroundStyle(Color.teal)
                            .clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .help(fillsWindow ? "Exit Full Stage Preview" : "Expand Full Stage Preview")
                }
            }
            .frame(height: 28)

            // Row 2: Idle Motion slider, Zoom buttons, Full Body & Pins toggles
            HStack(spacing: 8) {
                // Idle Motion / Sway amount slider (0% = completely still)
                HStack(spacing: 5) {
                    Image(systemName: "figure.walk.motion")
                        .font(.system(size: 11))
                        .foregroundStyle(puppet.idleMotionAmount > 0.05 ? Color.teal : Color.secondary)
                    Slider(
                        value: $puppet.idleMotionAmount,
                        in: 0.0...1.0
                    )
                    .frame(width: 76)
                    .controlSize(.mini)
                    Text(String(format: "%.0f%%", puppet.idleMotionAmount * 100))
                        .font(.system(size: 9.5, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .frame(width: 30, alignment: .trailing)
                }
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(Color.black.opacity(0.40))
                .clipShape(Capsule())
                .help("Idle Motion / Sway Amount (0% = completely still)")

                // Zoom & Reset controls
                HStack(spacing: 3) {
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            zoomScale = max(0.5, zoomScale - 0.2)
                        }
                    } label: {
                        Image(systemName: "minus.magnifyingglass")
                            .font(.system(size: 10))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .help("Zoom Out")

                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                            zoomScale = 1.0
                            puppet.stagePuppetOffset = .zero
                            puppet.saveCurrentPresetState()
                        }
                    } label: {
                        Text(String(format: "%.0f%%", zoomScale * 100))
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .help("Reset Zoom & Character Position (or double-click stage)")

                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            zoomScale = min(3.0, zoomScale + 0.2)
                        }
                    } label: {
                        Image(systemName: "plus.magnifyingglass")
                            .font(.system(size: 10))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .help("Zoom In")
                }

                Spacer()

                Toggle(isOn: Binding(
                    get: { isPoseFrozen },
                    set: { newVal in
                        if newVal {
                            frozenPoseFrame = frame
                            frozenPoseTime = Date().timeIntervalSinceReferenceDate
                        } else {
                            frozenPoseFrame = nil
                        }
                        isPoseFrozen = newVal
                    }
                )) {
                    Label("Freeze", systemImage: isPoseFrozen ? "snowflake" : "pause.circle")
                        .font(.system(size: 10.5, weight: .medium))
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
                .toggleStyle(.button)
                .controlSize(.mini)
                .tint(isPoseFrozen ? .cyan : .secondary)
                .fixedSize()
                .help("Freeze live camera tracking pose while clicking or transforming parts")

                Toggle(isOn: $puppet.showFullBodyLegs) {
                    Text("Full Body")
                        .font(.system(size: 10.5, weight: .medium))
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
                .toggleStyle(.button)
                .controlSize(.mini)
                .fixedSize()

                Toggle(isOn: $puppet.showPinsOnStage) {
                    Text("Pins")
                        .font(.system(size: 10.5, weight: .medium))
                        .lineLimit(1)
                        .fixedSize(horizontal: true, vertical: false)
                }
                .toggleStyle(.button)
                .controlSize(.mini)
                .fixedSize()
            }
            .frame(height: 28)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 4)
    }

    // MARK: - Unified Placed-Part Stage Layout Engine (Rendering + Selection + Free Transform)

    private func makeAnchoredTransform(
        pivotStage: CGPoint,
        rotationRad: CGFloat,
        flipX: CGFloat,
        flipY: CGFloat,
        pivotUV: CGPoint,
        width: CGFloat,
        height: CGFloat
    ) -> (localToStage: CGAffineTransform, boxSize: CGSize, boxToStage: CGAffineTransform, pivotInBox: CGPoint) {
        var localXf = CGAffineTransform.identity
        localXf = localXf.translatedBy(x: pivotStage.x, y: pivotStage.y)
        localXf = localXf.rotated(by: rotationRad)
        localXf = localXf.scaledBy(x: flipX, y: flipY)
        localXf = localXf.translatedBy(x: -pivotUV.x * width, y: -pivotUV.y * height)

        let effW: CGFloat = max(4.0, abs(flipX) * width)
        let effH: CGFloat = max(4.0, abs(flipY) * height)
        let effU: CGFloat = (flipX < 0.0) ? (1.0 - pivotUV.x) : pivotUV.x
        let effV: CGFloat = (flipY < 0.0) ? (1.0 - pivotUV.y) : pivotUV.y
        let pivotInBox = CGPoint(x: effU * effW, y: effV * effH)

        var boxXf = CGAffineTransform.identity
        boxXf = boxXf.translatedBy(x: pivotStage.x, y: pivotStage.y)
        boxXf = boxXf.rotated(by: rotationRad)
        boxXf = boxXf.translatedBy(x: -pivotInBox.x, y: -pivotInBox.y)

        return (localXf, CGSize(width: effW, height: effH), boxXf, pivotInBox)
    }

    private func counterpartLimbSlot(for slot: PuppetPartSlot) -> PuppetPartSlot? {
        switch slot {
        case .leftUpperArm: return .rightUpperArm
        case .rightUpperArm: return .leftUpperArm
        case .leftForearm: return .rightForearm
        case .rightForearm: return .leftForearm
        case .leftThigh: return .rightThigh
        case .rightThigh: return .leftThigh
        case .leftShin: return .rightShin
        case .rightShin: return .leftShin
        case .leftFoot: return .rightFoot
        case .rightFoot: return .leftFoot
        default: return nil
        }
    }

    private func buildLimbSegmentPart(
        slot: PuppetPartSlot,
        startPinId: String,
        endPinId: String,
        from startPt: CGPoint,
        to endPt: CGPoint,
        naturalLength: CGFloat,
        thicknessScale: CGFloat,
        flipAcrossBone: Bool = false,
        localRotationRad: CGFloat = 0.0
    ) -> PlacedStagePart? {
        guard puppet.partEnabled[slot] != false else { return nil }
        let hasDirect = (puppet.partImages[slot] != nil)
        let counterpart = counterpartLimbSlot(for: slot)
        let hasFallback = (counterpart != nil && puppet.partImages[counterpart!] != nil)
        guard hasDirect || hasFallback else { return nil }

        let activeSlot = hasDirect ? slot : counterpart!
        guard let img = puppet.partImages[activeSlot] else { return nil }
        let needsMirror = !hasDirect && hasFallback

        let pStart = puppet.pin(in: activeSlot, id: startPinId)
        let pEnd = puppet.pin(in: activeSlot, id: endPinId)

        let segDx: CGFloat = endPt.x - startPt.x
        let segDy: CGFloat = endPt.y - startPt.y
        let targetDist: CGFloat = max(4.0, hypot(segDx, segDy))
        let targetAngle: CGFloat = atan2(segDy, segDx)
        let visualAngle: CGFloat = targetAngle + localRotationRad

        let imgAspect: CGFloat = img.size.width / max(1.0, img.size.height)
        let rawPinDx: CGFloat = (pEnd.x - pStart.x) * imgAspect
        let rawPinDy: CGFloat = (pEnd.y - pStart.y)
        let normPinDist: CGFloat = max(0.1, hypot(rawPinDx, rawPinDy))

        let symmetricNormPinDist: CGFloat = {
            if let cp = counterpart, let cpImg = puppet.partImages[cp], cpImg.size == img.size {
                let cpStart = puppet.pin(in: cp, id: startPinId)
                let cpEnd = puppet.pin(in: cp, id: endPinId)
                let cpDx = (cpEnd.x - cpStart.x) * imgAspect
                let cpDy = (cpEnd.y - cpStart.y)
                let cpDist = max(0.1, hypot(cpDx, cpDy))
                return (normPinDist + cpDist) * 0.5
            }
            return normPinDist
        }()

        let refLen: CGFloat = max(4.0, naturalLength)
        let imgH: CGFloat = refLen / symmetricNormPinDist
        let imgW: CGFloat = imgH * imgAspect

        let actualPinDx: CGFloat = (pEnd.x - pStart.x) * imgW
        let actualPinDy: CGFloat = (pEnd.y - pStart.y) * imgH
        let pinAngle: CGFloat = atan2(actualPinDy, actualPinDx)

        let xf = resolvedMirrorTransform(slot: slot, fallbackSlot: counterpart ?? slot, needsMirror: needsMirror)
        let partWidthMult: CGFloat = xf.width
        let flipH: CGFloat = xf.flipH ? -1.0 : 1.0
        let flipV: CGFloat = xf.flipV ? -1.0 : 1.0

        let alongBoneScale: CGFloat = (targetDist / refLen) * flipV
        let defaultAcrossSign: CGFloat = (needsMirror || flipAcrossBone) ? -1.0 : 1.0
        let acrossSign: CGFloat = defaultAcrossSign * flipH
        let acrossBoneScale: CGFloat = acrossSign * thicknessScale * partWidthMult

        var localXf = CGAffineTransform.identity
        localXf = localXf.translatedBy(x: startPt.x, y: startPt.y)
        localXf = localXf.rotated(by: visualAngle)
        localXf = localXf.scaledBy(x: alongBoneScale, y: acrossBoneScale)
        localXf = localXf.rotated(by: -pinAngle)
        localXf = localXf.translatedBy(x: -pStart.x * imgW, y: -pStart.y * imgH)

        let boxW: CGFloat = max(22.0, imgW * thicknessScale * partWidthMult * 0.80)
        let boxH: CGFloat = max(24.0, targetDist)
        let pivotInBox = CGPoint(x: boxW * 0.5, y: 0.0)
        var boxXf = CGAffineTransform.identity
        boxXf = boxXf.translatedBy(x: startPt.x, y: startPt.y)
        boxXf = boxXf.rotated(by: visualAngle - (.pi * 0.5))
        boxXf = boxXf.translatedBy(x: -boxW * 0.5, y: 0.0)

        let drawRect = CGRect(x: 0, y: 0, width: imgW, height: imgH)
        return PlacedStagePart(
            slot: slot,
            image: img,
            localBounds: drawRect,
            localToStage: localXf,
            boxSize: CGSize(width: boxW, height: boxH),
            boxToStage: boxXf,
            pivotInBox: pivotInBox
        ) { context in
            var limbCtx = context
            limbCtx.concatenate(localXf)
            limbCtx.draw(Image(nsImage: img), in: drawRect)
        }
    }

    private func buildTailPart(
        waistStage: CGPoint,
        refTorsoH: CGFloat,
        torsoW: CGFloat,
        bodyTurn: CGFloat,
        torsoRoll: CGFloat,
        offsetUnit: CGFloat,
        time: TimeInterval
    ) -> (part: PlacedStagePart, attachPoint: CGPoint)? {
        guard puppet.partEnabled[.tail] == true, let tailImg = puppet.partImages[.tail] else { return nil }
        let tailBaseUV = puppet.pin(in: .tail, id: "tailBase")
        let tailH: CGFloat = refTorsoH * 0.72 * puppet.partHeight(for: .tail)
        let tailAspect: CGFloat = tailImg.size.width / max(1.0, tailImg.size.height)
        let tailW: CGFloat = tailH * tailAspect * puppet.partWidth(for: .tail)

        let off = puppet.partOffset(for: .tail)
        let tailAttach = CGPoint(
            x: waistStage.x - bodyTurn * torsoW * 0.09 + off.width * offsetUnit,
            y: waistStage.y + off.height * offsetUnit
        )
        let idleWag: CGFloat = CGFloat(sin(time * 2.6)) * 0.07 * CGFloat(puppet.idleMotionAmount)
        let manualRotRad: CGFloat = CGFloat(puppet.partRotationDegrees(for: .tail) * .pi / 180.0)
        let wagAngle: CGFloat = idleWag - bodyTurn * 0.18 + torsoRoll * 0.5 + manualRotRad
        let flipX: CGFloat = puppet.isPartFlippedH(.tail) ? -1.0 : 1.0
        let flipY: CGFloat = puppet.isPartFlippedV(.tail) ? -1.0 : 1.0

        let xfData = makeAnchoredTransform(
            pivotStage: tailAttach,
            rotationRad: wagAngle,
            flipX: flipX,
            flipY: flipY,
            pivotUV: tailBaseUV,
            width: tailW,
            height: tailH
        )
        let drawRect = CGRect(x: 0, y: 0, width: tailW, height: tailH)
        let part = PlacedStagePart(
            slot: .tail,
            image: tailImg,
            localBounds: drawRect,
            localToStage: xfData.localToStage,
            boxSize: xfData.boxSize,
            boxToStage: xfData.boxToStage,
            pivotInBox: xfData.pivotInBox
        ) { context in
            var tCtx = context
            tCtx.concatenate(xfData.localToStage)
            tCtx.draw(Image(nsImage: tailImg), in: drawRect)
        }
        return (part, tailAttach)
    }

    private func buildPelvisPart(
        waistStage: CGPoint,
        refTorsoH: CGFloat,
        torsoPerspectiveScaleX: CGFloat,
        torsoRoll: CGFloat,
        parentChainRotRad: CGFloat = 0.0,
        offsetUnit: CGFloat
    ) -> PlacedStagePart? {
        guard puppet.showFullBodyLegs,
              puppet.partEnabled[.pelvis] == true,
              let pelvisImg = puppet.partImages[.pelvis] else { return nil }

        let pelvisRoll: CGFloat = torsoRoll * 0.5
        let manualRotRad: CGFloat = CGFloat(puppet.partRotationDegrees(for: .pelvis) * .pi / 180.0)
        let flipX: CGFloat = puppet.isPartFlippedH(.pelvis) ? -1.0 : 1.0
        let flipY: CGFloat = puppet.isPartFlippedV(.pelvis) ? -1.0 : 1.0

        let pelvisH: CGFloat = refTorsoH * 0.44 * puppet.partHeight(for: .pelvis)
        let pelvisAspect: CGFloat = pelvisImg.size.width / max(1.0, pelvisImg.size.height)
        let pelvisW: CGFloat = pelvisH * pelvisAspect * torsoPerspectiveScaleX * puppet.partWidth(for: .pelvis)
        let waistJointUV = puppet.pin(in: .pelvis, id: "waistJoint")

        let off = puppet.partOffset(for: .pelvis)
        let pivotPt = CGPoint(x: waistStage.x + off.width * offsetUnit, y: waistStage.y + off.height * offsetUnit)
        let xfData = makeAnchoredTransform(
            pivotStage: pivotPt,
            rotationRad: pelvisRoll + parentChainRotRad + manualRotRad,
            flipX: flipX,
            flipY: flipY,
            pivotUV: waistJointUV,
            width: pelvisW,
            height: pelvisH
        )
        let drawRect = CGRect(x: 0, y: 0, width: pelvisW, height: pelvisH)
        return PlacedStagePart(
            slot: .pelvis,
            image: pelvisImg,
            localBounds: drawRect,
            localToStage: xfData.localToStage,
            boxSize: xfData.boxSize,
            boxToStage: xfData.boxToStage,
            pivotInBox: xfData.pivotInBox
        ) { context in
            var pCtx = context
            pCtx.concatenate(xfData.localToStage)
            pCtx.draw(Image(nsImage: pelvisImg), in: drawRect)
        }
    }

    private func buildTorsoPart(
        baseNeckStage: CGPoint,
        neckMountUV: CGPoint,
        torsoW: CGFloat,
        torsoH: CGFloat,
        torsoRoll: CGFloat,
        offsetUnit: CGFloat
    ) -> PlacedStagePart? {
        guard puppet.partEnabled[.torso] == true, let torsoImg = puppet.partImages[.torso] else { return nil }
        let manualRotRad: CGFloat = CGFloat(puppet.partRotationDegrees(for: .torso) * .pi / 180.0)
        let flipX: CGFloat = puppet.isPartFlippedH(.torso) ? -1.0 : 1.0
        let flipY: CGFloat = puppet.isPartFlippedV(.torso) ? -1.0 : 1.0

        let off = puppet.partOffset(for: .torso)
        let pivotPt = CGPoint(x: baseNeckStage.x + off.width * offsetUnit, y: baseNeckStage.y + off.height * offsetUnit)
        let xfData = makeAnchoredTransform(
            pivotStage: pivotPt,
            rotationRad: torsoRoll + manualRotRad,
            flipX: flipX,
            flipY: flipY,
            pivotUV: neckMountUV,
            width: torsoW,
            height: torsoH
        )
        let drawRect = CGRect(x: 0, y: 0, width: torsoW, height: torsoH)
        return PlacedStagePart(
            slot: .torso,
            image: torsoImg,
            localBounds: drawRect,
            localToStage: xfData.localToStage,
            boxSize: xfData.boxSize,
            boxToStage: xfData.boxToStage,
            pivotInBox: xfData.pivotInBox
        ) { context in
            var tCtx = context
            tCtx.concatenate(xfData.localToStage)
            tCtx.draw(Image(nsImage: torsoImg), in: drawRect)
        }
    }

    private func resolvedMirrorTransform(
        slot: PuppetPartSlot,
        fallbackSlot: PuppetPartSlot,
        needsMirror: Bool
    ) -> (width: CGFloat, height: CGFloat, rotDeg: Double, flipH: Bool, flipV: Bool) {
        guard needsMirror else {
            return (
                puppet.partWidth(for: slot),
                puppet.partHeight(for: slot),
                puppet.partRotationDegrees(for: slot),
                puppet.isPartFlippedH(slot),
                puppet.isPartFlippedV(slot)
            )
        }
        let ownWidth = puppet.partWidthScale[slot]
        let ownHeight = puppet.partHeightScale[slot]
        let ownRot = puppet.partRotationOffset[slot]
        let effWidth = ownWidth != nil ? CGFloat(ownWidth!) : puppet.partWidth(for: fallbackSlot)
        let effHeight = ownHeight != nil ? CGFloat(ownHeight!) : puppet.partHeight(for: fallbackSlot)
        let effRot = ownRot != nil ? ownRot! : -puppet.partRotationDegrees(for: fallbackSlot)
        let effFlipH = (puppet.partFlipH[slot] != nil) ? puppet.isPartFlippedH(slot) : !puppet.isPartFlippedH(fallbackSlot)
        let effFlipV = (puppet.partFlipV[slot] != nil) ? puppet.isPartFlippedV(slot) : puppet.isPartFlippedV(fallbackSlot)
        return (effWidth, effHeight, effRot, effFlipH, effFlipV)
    }

    private func buildFootPart(
        slot: PuppetPartSlot,
        anklePt: CGPoint,
        kneePt: CGPoint,
        isRightSide: Bool,
        refTorsoH: CGFloat,
        legThickMult: CGFloat,
        parentManualRotDeg: Double,
        offsetUnit: CGFloat
    ) -> (part: PlacedStagePart, ankleDrawPt: CGPoint)? {
        let fallbackSlot: PuppetPartSlot = isRightSide ? .leftFoot : .rightFoot
        let hasDirect = (puppet.partEnabled[slot] != false && puppet.partImages[slot] != nil)
        let hasFallback = (puppet.partEnabled[fallbackSlot] != false && puppet.partImages[fallbackSlot] != nil)
        guard puppet.partEnabled[slot] != false, hasDirect || hasFallback else { return nil }
        let activeSlot = hasDirect ? slot : fallbackSlot
        guard let img = puppet.partImages[activeSlot] else { return nil }

        let ankleUV = puppet.pin(in: activeSlot, id: "ankleJoint")
        let imgW: CGFloat = max(1.0, img.size.width)
        let imgH: CGFloat = max(1.0, img.size.height)

        let needsMirror: Bool = !hasDirect && hasFallback
        let xf = resolvedMirrorTransform(slot: slot, fallbackSlot: fallbackSlot, needsMirror: needsMirror)

        let naturalFootH: CGFloat = refTorsoH * 0.38 * max(0.85, legThickMult)
        let baseScale: CGFloat = naturalFootH / imgH
        let baseFootW: CGFloat = imgW * baseScale * xf.width
        let baseFootH: CGFloat = imgH * baseScale * xf.height

        let shinDx: CGFloat = anklePt.x - kneePt.x
        let shinDy: CGFloat = max(1.0, anklePt.y - kneePt.y)
        let shinAngle: CGFloat = atan2(shinDx, shinDy)
        let ankleGroundTilt: CGFloat = shinAngle * 0.18
        let partRotRad: CGFloat = CGFloat(xf.rotDeg * .pi / 180.0)
        let totalRotRad: CGFloat = ankleGroundTilt + partRotRad

        let defaultSignX: CGFloat = isRightSide ? -1.0 : 1.0
        let finalFlipX: CGFloat = defaultSignX * (xf.flipH ? -1.0 : 1.0)
        let finalFlipY: CGFloat = xf.flipV ? -1.0 : 1.0

        let off = puppet.partOffset(for: slot)
        let pivotPt = CGPoint(x: anklePt.x + off.width * offsetUnit, y: anklePt.y + off.height * offsetUnit)

        let xfData = makeAnchoredTransform(
            pivotStage: pivotPt,
            rotationRad: totalRotRad,
            flipX: finalFlipX,
            flipY: finalFlipY,
            pivotUV: ankleUV,
            width: baseFootW,
            height: baseFootH
        )
        let drawRect = CGRect(x: 0, y: 0, width: baseFootW, height: baseFootH)
        let part = PlacedStagePart(
            slot: slot,
            image: img,
            localBounds: drawRect,
            localToStage: xfData.localToStage,
            boxSize: xfData.boxSize,
            boxToStage: xfData.boxToStage,
            pivotInBox: xfData.pivotInBox
        ) { context in
            var fCtx = context
            fCtx.concatenate(xfData.localToStage)
            fCtx.draw(Image(nsImage: img), in: drawRect)
        }
        return (part, pivotPt)
    }

    private func buildHeadPart(
        baseNeckStage: CGPoint,
        headH: CGFloat,
        fm: FaceMetrics,
        headTurn: CGFloat,
        headNod: CGFloat,
        rollAngle: CGFloat,
        offsetUnit: CGFloat,
        time: TimeInterval
    ) -> PlacedStagePart? {
        guard puppet.partEnabled[.head] == true, let headImg = puppet.partImages[.head] else { return nil }

        let neckUV = puppet.pin(in: .head, id: "neckPivot")
        let lBrowUV = puppet.pin(in: .head, id: "leftBrow")
        let rBrowUV = puppet.pin(in: .head, id: "rightBrow")
        let lEyeUV = puppet.pin(in: .head, id: "leftEye")
        let rEyeUV = puppet.pin(in: .head, id: "rightEye")
        let noseUV = puppet.pin(in: .head, id: "noseCenter")
        let mouthUV = puppet.pin(in: .head, id: "mouthCenter")
        let jawUV = puppet.pin(in: .head, id: "jawChin")

        let headAspect: CGFloat = headImg.size.width / max(1.0, headImg.size.height)
        let headPerspectiveScaleX: CGFloat = max(0.85, 1.0 - abs(headTurn) * 0.065)
        let headPartWidth: CGFloat = puppet.partWidth(for: .head)
        let headPartRotRad: CGFloat = CGFloat(puppet.partRotationDegrees(for: .head) * .pi / 180.0)
        let flipX: CGFloat = puppet.isPartFlippedH(.head) ? -1.0 : 1.0
        let flipY: CGFloat = puppet.isPartFlippedV(.head) ? -1.0 : 1.0
        let headW: CGFloat = headH * headAspect * headPerspectiveScaleX * headPartWidth
        let headTurnBaseShiftX: CGFloat = headTurn * (headW * 0.035)

        let off = puppet.partOffset(for: .head)
        let pivotPt = CGPoint(
            x: baseNeckStage.x + headTurnBaseShiftX + off.width * offsetUnit,
            y: baseNeckStage.y + off.height * offsetUnit
        )

        let xfData = makeAnchoredTransform(
            pivotStage: pivotPt,
            rotationRad: rollAngle + headPartRotRad,
            flipX: flipX,
            flipY: flipY,
            pivotUV: neckUV,
            width: headW,
            height: headH
        )
        let headBox = CGRect(x: 0, y: 0, width: headW, height: headH)

        let browY: CGFloat = (lBrowUV.y + rBrowUV.y) * 0.5
        let mouthY: CGFloat = mouthUV.y
        let jawY: CGFloat = max(mouthY + 0.05, jawUV.y)
        let effectiveJawWarp: CGFloat = (puppet.mouthAnimationMode == .visemeSpritesOnly || !puppet.jawWarpEnabled) ? 0.0 : CGFloat(puppet.jawWarpAmount)
        let jawOpenPx: CGFloat = CGFloat(fm.mouthOpen) * effectiveJawWarp * (headH * 0.13)
        let smileWidthFactor: CGFloat = 1.0 + (CGFloat(fm.mouthSmile) - CGFloat(fm.mouthPucker) * 0.6) * 0.07 * effectiveJawWarp
        let browLiftPx: CGFloat = (CGFloat(fm.browRaise) - CGFloat(fm.browFurrow) * 0.6) * CGFloat(puppet.browWarpAmount) * (headH * 0.055)
        let featureTurnShiftX: CGFloat = headTurn * (headW * 0.068)
        let featureNodShiftY: CGFloat = headNod * (headH * 0.042)

        func verticalDeformAt(v: CGFloat) -> (dy: CGFloat, wScale: CGFloat) {
            var dy: CGFloat = 0.0
            let browSigma: CGFloat = 0.09
            let browDist: CGFloat = (v - browY) / browSigma
            let browWeight: CGFloat = exp(-(browDist * browDist))
            dy -= browLiftPx * browWeight

            var wScale: CGFloat = 1.0
            if v > mouthY {
                let jawProgress: CGFloat = min(1.0, (v - mouthY) / max(0.05, jawY - mouthY))
                let smooth: CGFloat = jawProgress * jawProgress * (3.0 - 2.0 * jawProgress)
                dy += jawOpenPx * smooth
                let mouthDist: CGFloat = (v - mouthY) / 0.08
                let mouthBand: CGFloat = exp(-(mouthDist * mouthDist))
                wScale = 1.0 + (smileWidthFactor - 1.0) * mouthBand
            }
            return (dy, wScale)
        }

        func featurePosition(uv: CGPoint, depthMultiplier: CGFloat) -> CGPoint {
            let vd = verticalDeformAt(v: uv.y)
            return CGPoint(
                x: uv.x * headW + featureTurnShiftX * depthMultiplier,
                y: uv.y * headH + vd.dy + featureNodShiftY * depthMultiplier
            )
        }

        return PlacedStagePart(
            slot: .head,
            image: headImg,
            localBounds: headBox,
            localToStage: xfData.localToStage,
            boxSize: xfData.boxSize,
            boxToStage: xfData.boxToStage,
            pivotInBox: xfData.pivotInBox
        ) { context in
            var headCtx = context
            headCtx.concatenate(xfData.localToStage)

            let strips = 24
            let resolvedHead = headCtx.resolve(Image(nsImage: headImg))
            for i in 0..<strips {
                let v0: CGFloat = CGFloat(i) / CGFloat(strips)
                let v1: CGFloat = CGFloat(i + 1) / CGFloat(strips)
                let d0 = verticalDeformAt(v: v0)
                let d1 = verticalDeformAt(v: v1)

                let dstY0: CGFloat = v0 * headH + d0.dy
                let dstY1: CGFloat = v1 * headH + d1.dy
                let stripDstH: CGFloat = max(0.5, dstY1 - dstY0 + 0.6)

                let avgWScale: CGFloat = (d0.wScale + d1.wScale) * 0.5
                let scaledW: CGFloat = headW * avgWScale
                let dstX: CGFloat = (headW - scaledW) * 0.5

                var stripCtx = headCtx
                stripCtx.clip(to: Path(CGRect(x: dstX, y: dstY0, width: scaledW, height: stripDstH)))

                let totalScaleY: CGFloat = (dstY1 - dstY0) / max(0.5, (v1 - v0) * headH)
                let imgTopY: CGFloat = dstY0 - (v0 * headH) * totalScaleY
                let fullDrawRect = CGRect(x: dstX, y: imgTopY, width: scaledW, height: headH * totalScaleY)
                stripCtx.draw(resolvedHead, in: fullDrawRect)
            }

            // Independent Left & Right Eyes (Wink & Blink + 2.5D Parallax)
            let autoBlinkPulse: Float = {
                guard puppet.autoBlinkEnabled else { return 0 }
                let cycle = fmod(time, 3.8)
                if cycle < 0.14 {
                    let phase = Float(cycle / 0.14) * .pi
                    return sin(phase)
                }
                return 0
            }()

            let blinkL = max(fm.eyeBlinkL, autoBlinkPulse)
            let blinkR = max(fm.eyeBlinkR, autoBlinkPulse)
            let threshold = Float(puppet.blinkThreshold)
            let eyeItems: [(uv: CGPoint, blink: Float, isRightEye: Bool)] = [
                (lEyeUV, blinkL, false),
                (rEyeUV, blinkR, true)
            ]

            for eyeItem in eyeItems {
                let eyePt = featurePosition(uv: eyeItem.uv, depthMultiplier: 1.0)
                let isClosed = eyeItem.blink >= threshold
                let sideSign: CGFloat = eyeItem.isRightEye ? 1.0 : -1.0
                let eyeTurnPerspective: CGFloat = max(0.76, min(1.12, 1.0 - sideSign * headTurn * 0.12))

                switch puppet.eyeAnimationMode {
                case .hybridSpriteAndTween, .spriteSwapOnly:
                    let eyeSlot: PuppetPartSlot = {
                        if eyeItem.isRightEye {
                            return isClosed ? .rightEyeClosed : .rightEyeOpen
                        } else {
                            return isClosed ? .eyesClosed : .eyesOpen
                        }
                    }()
                    let fallbackSlot: PuppetPartSlot = isClosed ? .eyesClosed : .eyesOpen

                    let chosenSprite: NSImage? = {
                        if let custom = puppet.partImages[eyeSlot] { return custom }
                        if let fallbackCustom = puppet.partImages[fallbackSlot] { return fallbackCustom }
                        return nil
                    }()

                    let openSlot: PuppetPartSlot = eyeItem.isRightEye ? .rightEyeOpen : .eyesOpen
                    let openFallbackSprite: NSImage? = puppet.partImages[openSlot]
                        ?? puppet.partImages[.eyesOpen]
                    let usingSquashedOpenFallback = (isClosed && chosenSprite == nil && puppet.partEnabled[openSlot] != false && openFallbackSprite != nil)
                    let activeSprite: NSImage? = chosenSprite ?? (usingSquashedOpenFallback ? openFallbackSprite : nil)

                    let mirrorLeftToRight: Bool = {
                        guard eyeItem.isRightEye else { return false }
                        if chosenSprite != nil {
                            return (puppet.partImages[eyeSlot] == nil && puppet.partImages[fallbackSlot] != nil)
                        } else if usingSquashedOpenFallback {
                            return (puppet.partImages[.rightEyeOpen] == nil && puppet.partImages[.eyesOpen] != nil)
                        }
                        return false
                    }()

                    let slotEnabled = (puppet.partEnabled[eyeSlot] != false) || (usingSquashedOpenFallback && puppet.partEnabled[openSlot] != false)
                    if slotEnabled, let eyeSprite = activeSprite {
                        let baseFactor: CGFloat = 0.195
                        let widthSlot: PuppetPartSlot = usingSquashedOpenFallback ? openSlot : eyeSlot
                        let mirrorSourceSlot: PuppetPartSlot = usingSquashedOpenFallback ? .eyesOpen : fallbackSlot
                        let eXf = resolvedMirrorTransform(slot: widthSlot, fallbackSlot: mirrorSourceSlot, needsMirror: mirrorLeftToRight)

                        let imgAspect: CGFloat = eyeSprite.size.height / max(1.0, eyeSprite.size.width)
                        let unwarpedW: CGFloat = headW * baseFactor * CGFloat(puppet.eyeSpriteScale) * eXf.width
                        let unwarpedH: CGFloat = headW * baseFactor * CGFloat(puppet.eyeSpriteScale) * imgAspect * eXf.height
                        let baseEyeW: CGFloat = unwarpedW * eyeTurnPerspective
                        let baseEyeH: CGFloat = unwarpedH
                        let squashY: CGFloat = {
                            if usingSquashedOpenFallback { return 0.14 }
                            guard puppet.eyeAnimationMode == .hybridSpriteAndTween else { return 1.0 }
                            if isClosed { return 1.0 }
                            let t = CGFloat(min(1.0, eyeItem.blink / max(0.1, threshold)))
                            return max(0.35, 1.0 - t * 0.55)
                        }()

                        var eyeCtx = headCtx
                        eyeCtx.translateBy(x: eyePt.x, y: eyePt.y)
                        eyeCtx.rotate(by: .degrees(eXf.rotDeg))
                        let finalFlipX: CGFloat = (mirrorLeftToRight ? -1.0 : 1.0) * (eXf.flipH ? -1.0 : 1.0)
                        let finalFlipY: CGFloat = eXf.flipV ? -1.0 : 1.0
                        eyeCtx.scaleBy(x: finalFlipX, y: finalFlipY)
                        let drawH = baseEyeH * squashY
                        eyeCtx.draw(Image(nsImage: eyeSprite), in: CGRect(x: -baseEyeW * 0.5, y: -drawH * 0.5, width: baseEyeW, height: drawH))
                        if usingSquashedOpenFallback {
                            var lidLine = Path()
                            lidLine.move(to: CGPoint(x: -baseEyeW * 0.42, y: 0))
                            lidLine.addQuadCurve(
                                to: CGPoint(x: baseEyeW * 0.42, y: 0),
                                control: CGPoint(x: 0, y: max(2.5, baseEyeH * 0.14))
                            )
                            eyeCtx.stroke(lidLine, with: .color(.black.opacity(0.88)), lineWidth: max(2.0, headW * 0.012))
                        }
                    }

                case .autoSquashSingleImage:
                    if eyeItem.blink > 0.15 {
                        let lidW: CGFloat = headW * 0.15 * CGFloat(puppet.eyeSpriteScale) * eyeTurnPerspective
                        let lidH: CGFloat = headH * 0.09 * CGFloat(min(1.0, eyeItem.blink)) * CGFloat(puppet.eyeSpriteScale)
                        let lidRect = CGRect(x: eyePt.x - lidW * 0.5, y: eyePt.y - lidH * 0.5, width: lidW, height: lidH)
                        headCtx.fill(Path(ellipseIn: lidRect), with: .color(Color(red: 0.88, green: 0.72, blue: 0.60)))
                        var lash = Path()
                        lash.move(to: CGPoint(x: lidRect.minX + 4, y: eyePt.y))
                        lash.addQuadCurve(to: CGPoint(x: lidRect.maxX - 4, y: eyePt.y), control: CGPoint(x: eyePt.x, y: eyePt.y + lidH * 0.35))
                        headCtx.stroke(lash, with: .color(.black.opacity(0.85)), lineWidth: 3.0)
                    }
                }
            }

            // Brows Layer
            let lBrowImg = puppet.partImages[.browsOverlay]
            let rBrowImg = puppet.partImages[.rightBrows] ?? lBrowImg
            if let img = lBrowImg, puppet.partEnabled[.browsOverlay] != false {
                let isWideBar = (img.size.width / max(1.0, img.size.height)) > 2.2
                if isWideBar && puppet.partImages[.rightBrows] == nil {
                    let browMidUV = CGPoint(x: (lBrowUV.x + rBrowUV.x) * 0.5, y: browY)
                    let browPt = featurePosition(uv: browMidUV, depthMultiplier: 1.05)
                    let bw: CGFloat = headW * 0.52 * puppet.partWidth(for: .browsOverlay)
                    let bh: CGFloat = headW * 0.52 * (img.size.height / max(1.0, img.size.width)) * puppet.partHeight(for: .browsOverlay)
                    var bCtx = headCtx
                    bCtx.translateBy(x: browPt.x, y: browPt.y)
                    bCtx.rotate(by: .degrees(puppet.partRotationDegrees(for: .browsOverlay)))
                    bCtx.draw(Image(nsImage: img), in: CGRect(x: -bw * 0.5, y: -bh * 0.5, width: bw, height: bh))
                } else {
                    let browPt = featurePosition(uv: lBrowUV, depthMultiplier: 1.05)
                    let bw: CGFloat = headW * 0.26 * puppet.partWidth(for: .browsOverlay)
                    let bh: CGFloat = headW * 0.26 * (img.size.height / max(1.0, img.size.width)) * puppet.partHeight(for: .browsOverlay)
                    var bCtx = headCtx
                    bCtx.translateBy(x: browPt.x, y: browPt.y)
                    bCtx.rotate(by: .degrees(puppet.partRotationDegrees(for: .browsOverlay)))
                    bCtx.scaleBy(
                        x: puppet.isPartFlippedH(.browsOverlay) ? -1.0 : 1.0,
                        y: puppet.isPartFlippedV(.browsOverlay) ? -1.0 : 1.0
                    )
                    bCtx.draw(Image(nsImage: img), in: CGRect(x: -bw * 0.5, y: -bh * 0.5, width: bw, height: bh))

                    if let rImg = rBrowImg, puppet.partEnabled[.rightBrows] != false {
                        let mirrorR = (puppet.partImages[.rightBrows] == nil)
                        let bXf = resolvedMirrorTransform(slot: .rightBrows, fallbackSlot: .browsOverlay, needsMirror: mirrorR)
                        let rBrowPt = featurePosition(uv: rBrowUV, depthMultiplier: 1.05)
                        let rbw: CGFloat = headW * 0.26 * bXf.width
                        let rbh: CGFloat = headW * 0.26 * (rImg.size.height / max(1.0, rImg.size.width)) * bXf.height
                        var rbCtx = headCtx
                        rbCtx.translateBy(x: rBrowPt.x, y: rBrowPt.y)
                        rbCtx.rotate(by: .degrees(bXf.rotDeg))
                        let rFlipX: CGFloat = (mirrorR ? -1.0 : 1.0) * (bXf.flipH ? -1.0 : 1.0)
                        let rFlipY: CGFloat = bXf.flipV ? -1.0 : 1.0
                        rbCtx.scaleBy(x: rFlipX, y: rFlipY)
                        rbCtx.draw(Image(nsImage: rImg), in: CGRect(x: -rbw * 0.5, y: -rbh * 0.5, width: rbw, height: rbh))
                    }
                }
            }

            // Mouth Viseme Layer
            if puppet.mouthAnimationMode != .singleImageJawWarp {
                let activeMouthSlot: PuppetPartSlot = {
                    switch fm.viseme {
                    case .neutral: return .mouthNeutral
                    case .ah, .wideOpen: return .mouthAh
                    case .oh: return .mouthOh
                    case .smile: return .mouthSmile
                    }
                }()
                if puppet.partEnabled[activeMouthSlot] == true,
                   let mouthImg = puppet.partImages[activeMouthSlot] {
                    let mouthPt = featurePosition(uv: mouthUV, depthMultiplier: 1.15)
                    let baseScaleFactor: CGFloat = 0.29
                    let baseMW: CGFloat = headW * baseScaleFactor * CGFloat(puppet.mouthSpriteScale)
                    let baseMH: CGFloat = baseMW * (mouthImg.size.height / max(1.0, mouthImg.size.width))
                    let tweenScaleX: CGFloat = (puppet.mouthAnimationMode == .hybridVisemesAndWarp) ? (1.0 + CGFloat(fm.mouthSmile) * 0.18 - CGFloat(fm.mouthPucker) * 0.16) : 1.0
                    let tweenScaleY: CGFloat = (puppet.mouthAnimationMode == .hybridVisemesAndWarp && fm.viseme != .neutral) ? (0.85 + CGFloat(fm.mouthOpen) * 0.45) : 1.0
                    let mw: CGFloat = baseMW * tweenScaleX
                    let mh: CGFloat = baseMH * tweenScaleY
                    headCtx.draw(Image(nsImage: mouthImg), in: CGRect(x: mouthPt.x - mw * 0.5, y: mouthPt.y - mh * 0.45, width: mw, height: mh))
                }
            }

            // Nose Layer
            if puppet.partEnabled[.noseOverlay] == true, let noseImg = puppet.partImages[.noseOverlay] {
                let nosePt = featurePosition(uv: noseUV, depthMultiplier: 1.45)
                let baseNoseFactor: CGFloat = 0.145
                let nw: CGFloat = headW * baseNoseFactor * CGFloat(puppet.noseSpriteScale)
                let nh: CGFloat = nw * (noseImg.size.height / max(1.0, noseImg.size.width))
                headCtx.draw(Image(nsImage: noseImg), in: CGRect(x: nosePt.x - nw * 0.5, y: nosePt.y - nh * 0.5, width: nw, height: nh))
            }

            if puppet.showPinsOnStage, let headPins = puppet.pinsBySlot[.head] {
                for pin in headPins {
                    let depth: CGFloat = (pin.id == "noseCenter") ? 1.45 : ((pin.id == "neckPivot") ? 0.0 : 1.0)
                    let pt = featurePosition(uv: pin.point, depthMultiplier: depth)
                    let pinRect = CGRect(x: pt.x - 4.5, y: pt.y - 4.5, width: 9, height: 9)
                    headCtx.fill(Path(ellipseIn: pinRect), with: .color(.teal))
                    headCtx.stroke(Path(ellipseIn: pinRect), with: .color(.black), lineWidth: 1.5)
                }
            }
        }
    }

    private func buildLegJointTarget(
        hipStage: CGPoint,
        thighLen: CGFloat,
        shinLen: CGFloat,
        bodyTurn: CGFloat,
        moveY: CGFloat,
        stageHeight: CGFloat,
        isRightSide: Bool,
        posePt: (Int) -> CGPoint?
    ) -> (rawKnee: CGPoint, rawAnkle: CGPoint) {
        let sideSign: CGFloat = isRightSide ? 1.0 : -1.0
        let crouch: CGFloat = max(0.0, moveY / max(1.0, stageHeight * 0.15))
        let defaultKnee = CGPoint(
            x: hipStage.x + sideSign * thighLen * (0.06 + crouch * 0.12) + sideSign * bodyTurn * 6.0,
            y: hipStage.y + thighLen * (0.98 - crouch * 0.10)
        )
        let ankleDxFactor: CGFloat = sideSign * 0.02
        let ankleDyFactor: CGFloat = 0.96
        let defaultAnkle = CGPoint(
            x: defaultKnee.x + thighLen * ankleDxFactor,
            y: defaultKnee.y + shinLen * ankleDyFactor
        )

        let hipIdx = isRightSide ? 24 : 23
        let kneeIdx = isRightSide ? 26 : 25
        let ankleIdx = isRightSide ? 28 : 27
        guard let pHip = posePt(hipIdx), let pKnee = posePt(kneeIdx) else {
            return (defaultKnee, defaultAnkle)
        }
        let a1: CGFloat = atan2(pKnee.y - pHip.y, pKnee.x - pHip.x)
        guard a1 > 0.55 && a1 < 2.6 else {
            return (defaultKnee, defaultAnkle)
        }
        let knee = CGPoint(x: hipStage.x + cos(a1) * thighLen, y: hipStage.y + sin(a1) * thighLen)
        if let pAnkle = posePt(ankleIdx) {
            let a2: CGFloat = atan2(pAnkle.y - pKnee.y, pAnkle.x - pKnee.x)
            if a2 > 0.55 && a2 < 2.6 {
                let ankle = CGPoint(x: knee.x + cos(a2) * shinLen, y: knee.y + sin(a2) * shinLen)
                return (knee, ankle)
            }
        }
        return (knee, CGPoint(x: knee.x + sideSign * thighLen * 0.04, y: knee.y + shinLen))
    }

    private func computeStageLayout(in size: CGSize, frame activeFrame: TrackedFrame, time: TimeInterval) -> StageLayoutResult {
        let fm = activeFrame.faceMetrics

        let charScale: CGFloat = CGFloat(puppet.characterScale)
        let moveX: CGFloat = CGFloat(fm.headX) * CGFloat(puppet.headMoveAmount) * (size.width * 0.16)
        let moveY: CGFloat = CGFloat(fm.headY) * CGFloat(puppet.headMoveAmount) * (size.height * 0.14)
        let rawScaleDelta: CGFloat = 1.0 + (CGFloat(fm.headScale) - 1.0) * CGFloat(puppet.headScaleAmount)
        let clampedScale: CGFloat = max(0.60, min(1.55, rawScaleDelta))
        let offsetUnit: CGFloat = partOffsetUnit(in: size, scaleDelta: clampedScale)

        let rollAngle: CGFloat = CGFloat(fm.roll) * CGFloat(puppet.headTiltAmount)
        let headTurn: CGFloat = CGFloat(fm.yaw) * CGFloat(puppet.headTurnParallax)
        let headNod: CGFloat = CGFloat(fm.pitch) * CGFloat(puppet.headTurnParallax)
        let bodyTurn: CGFloat = headTurn * CGFloat(puppet.bodyTurnAmount)

        let pose = activeFrame.poseLandmarks
        func posePt(_ idx: Int) -> CGPoint? {
            guard idx < pose.count, let lm = pose[idx] else { return nil }
            return CGPoint(x: (1.0 - CGFloat(lm.x)) * size.width, y: CGFloat(lm.y) * size.height)
        }

        let torsoRoll: CGFloat = {
            let baseRoll: CGFloat = rollAngle * 0.22 + bodyTurn * 0.08
            if let ls = posePt(11), let rs = posePt(12) {
                let dx: CGFloat = rs.x - ls.x
                let dy: CGFloat = rs.y - ls.y
                if dx > size.width * 0.12 && abs(dy) < dx * 0.45 {
                    let poseTilt: CGFloat = max(-0.18, min(0.18, atan2(dy, dx)))
                    return baseRoll * 0.72 + poseTilt * 0.28
                }
            }
            return baseRoll
        }()

        let baseCenterY: CGFloat = puppet.showFullBodyLegs ? 0.36 : 0.62
        let liveMoveX: CGFloat = livePuppetDrag.width / max(0.25, zoomScale)
        let liveMoveY: CGFloat = livePuppetDrag.height / max(0.25, zoomScale)
        let baseNeckStage = CGPoint(
            x: size.width * 0.50 + puppet.stagePuppetOffset.width + liveMoveX + moveX + bodyTurn * (size.width * 0.025),
            y: size.height * baseCenterY + puppet.stagePuppetOffset.height + liveMoveY + moveY
        )

        let refHeadH: CGFloat = size.height * charScale * 0.92 * clampedScale
        let headH: CGFloat = refHeadH * puppet.partHeight(for: .head)
        _ = headH

        let torsoImg = puppet.partImages[.torso]
        let torsoAspect: CGFloat = (torsoImg?.size.width ?? 512.0) / max(1.0, torsoImg?.size.height ?? 440.0)
        let torsoHeightFactor: CGFloat = 0.90
        let refTorsoH: CGFloat = refHeadH * torsoHeightFactor
        let torsoH: CGFloat = refTorsoH * puppet.partHeight(for: .torso)
        let torsoPerspectiveScaleX: CGFloat = max(0.84, 1.0 - abs(bodyTurn) * 0.06)
        let torsoW: CGFloat = torsoH * torsoAspect * torsoPerspectiveScaleX * puppet.partWidth(for: .torso)

        let followMove: Bool = puppet.followChildrenOnMove
        let followRotate: Bool = puppet.followChildrenOnRotate
        func rotateStageVec(_ v: CGPoint, by angle: CGFloat) -> CGPoint {
            let c: CGFloat = cos(angle)
            let s: CGFloat = sin(angle)
            return CGPoint(x: v.x * c - v.y * s, y: v.x * s + v.y * c)
        }

        let neckMountUV = puppet.pin(in: .torso, id: "neckMount")
        let lShoulderUV = puppet.pin(in: .torso, id: "leftShoulder")
        let rShoulderUV = puppet.pin(in: .torso, id: "rightShoulder")
        let waistUV = puppet.pin(in: .torso, id: "waistPivot")

        let torsoRawOff = puppet.partOffset(for: .torso)
        let torsoChainMove = followMove
            ? CGSize(width: torsoRawOff.width * offsetUnit, height: torsoRawOff.height * offsetUnit)
            : .zero
        let torsoManualRotRad: CGFloat = CGFloat(puppet.partRotationDegrees(for: .torso) * .pi / 180.0)
        let torsoChainRotRad: CGFloat = followRotate ? torsoManualRotRad : 0.0
        let chainNeckStage = CGPoint(x: baseNeckStage.x + torsoChainMove.width, y: baseNeckStage.y + torsoChainMove.height)
        let chainTorsoRoll: CGFloat = torsoRoll + torsoChainRotRad

        func torsoUVToStage(_ uv: CGPoint, depthFactor: CGFloat = 0.0) -> CGPoint {
            let turnOffsetX: CGFloat = bodyTurn * torsoW * 0.055 * depthFactor
            let localX: CGFloat = (uv.x - neckMountUV.x) * torsoW + turnOffsetX
            let localY: CGFloat = (uv.y - neckMountUV.y) * torsoH
            let cosA: CGFloat = cos(chainTorsoRoll)
            let sinA: CGFloat = sin(chainTorsoRoll)
            return CGPoint(
                x: chainNeckStage.x + localX * cosA - localY * sinA,
                y: chainNeckStage.y + localX * sinA + localY * cosA
            )
        }

        let leftShoulderStage = torsoUVToStage(lShoulderUV, depthFactor: 0.8)
        let rightShoulderStage = torsoUVToStage(rShoulderUV, depthFactor: 0.8)
        let waistStage = torsoUVToStage(waistUV, depthFactor: -0.3)

        let legLenMult: CGFloat = CGFloat(puppet.legLengthScale)
        let legThickMult: CGFloat = CGFloat(puppet.legThicknessScale)
        let armLenMult: CGFloat = CGFloat(puppet.armLengthScale)
        let armThickMult: CGFloat = CGFloat(puppet.armThicknessScale)

        var partsBySlot: [PuppetPartSlot: PlacedStagePart] = [:]
        var stagePins: [(point: CGPoint, color: Color)] = []
        var handChains: [(wristStage: CGPoint, hand: TrackedHand, visualScale: CGFloat)] = []

        if let torsoPart = buildTorsoPart(
            baseNeckStage: baseNeckStage,
            neckMountUV: neckMountUV,
            torsoW: torsoW,
            torsoH: torsoH,
            torsoRoll: torsoRoll,
            offsetUnit: offsetUnit
        ) {
            partsBySlot[.torso] = torsoPart
            stagePins.append((chainNeckStage, .yellow))
            stagePins.append((leftShoulderStage, .orange))
            stagePins.append((rightShoulderStage, .orange))
            stagePins.append((waistStage, .orange))
        }

        if let headPart = buildHeadPart(
            baseNeckStage: chainNeckStage,
            headH: headH,
            fm: fm,
            headTurn: headTurn,
            headNod: headNod,
            rollAngle: rollAngle + torsoChainRotRad,
            offsetUnit: offsetUnit,
            time: time
        ) {
            partsBySlot[.head] = headPart
        }

        if let tailRes = buildTailPart(
            waistStage: waistStage,
            refTorsoH: refTorsoH,
            torsoW: torsoW,
            bodyTurn: bodyTurn,
            torsoRoll: chainTorsoRoll,
            offsetUnit: offsetUnit,
            time: time
        ) {
            partsBySlot[.tail] = tailRes.part
            stagePins.append((tailRes.attachPoint, .mint))
        }

        if let pelvisPart = buildPelvisPart(
            waistStage: waistStage,
            refTorsoH: refTorsoH,
            torsoPerspectiveScaleX: torsoPerspectiveScaleX,
            torsoRoll: torsoRoll,
            parentChainRotRad: torsoChainRotRad,
            offsetUnit: offsetUnit
        ) {
            partsBySlot[.pelvis] = pelvisPart
        }

        // Legs + Feet
        if puppet.showFullBodyLegs {
            let pelvisRoll: CGFloat = torsoRoll * 0.5
            let pelvisRawOff = puppet.partOffset(for: .pelvis)
            let pelvisChainMove: CGSize = (puppet.partEnabled[.pelvis] == true && followMove)
                ? CGSize(width: pelvisRawOff.width * offsetUnit, height: pelvisRawOff.height * offsetUnit)
                : .zero
            let pelvisManualRotRad: CGFloat = (puppet.partEnabled[.pelvis] == true)
                ? CGFloat(puppet.partRotationDegrees(for: .pelvis) * .pi / 180.0)
                : 0.0
            let pelvisChainRotRad: CGFloat = followRotate ? pelvisManualRotRad : 0.0
            let parentLegRotRad: CGFloat = torsoChainRotRad + pelvisChainRotRad

            let refPelvisH: CGFloat = refTorsoH * 0.44 * puppet.partHeight(for: .pelvis)
            let pelvisImg = puppet.partImages[.pelvis]
            let pelvisAspect: CGFloat = (pelvisImg?.size.width ?? 360.0) / max(1.0, pelvisImg?.size.height ?? 180.0)
            let pelvisW: CGFloat = refPelvisH * pelvisAspect * torsoPerspectiveScaleX * puppet.partWidth(for: .pelvis)
            let waistJointUV = puppet.pin(in: .pelvis, id: "waistJoint")
            let lHipUV = puppet.pin(in: .pelvis, id: "leftHip")
            let rHipUV = puppet.pin(in: .pelvis, id: "rightHip")

            func pelvisUVToStage(_ uv: CGPoint) -> CGPoint {
                if puppet.partEnabled[.pelvis] != true {
                    let hipY: CGFloat = 0.88
                    let hipX: CGFloat = (uv.x < 0.5) ? 0.34 : 0.66
                    return torsoUVToStage(CGPoint(x: hipX, y: hipY), depthFactor: 0.4)
                }
                let lx: CGFloat = (uv.x - waistJointUV.x) * pelvisW
                let ly: CGFloat = (uv.y - waistJointUV.y) * refPelvisH
                let effRoll: CGFloat = pelvisRoll + parentLegRotRad
                let c: CGFloat = cos(effRoll)
                let s: CGFloat = sin(effRoll)
                return CGPoint(
                    x: waistStage.x + pelvisChainMove.width + lx * c - ly * s,
                    y: waistStage.y + pelvisChainMove.height + lx * s + ly * c
                )
            }

            let leftHipStage = pelvisUVToStage(lHipUV)
            let rightHipStage = pelvisUVToStage(rHipUV)
            stagePins.append((leftHipStage, .cyan))
            stagePins.append((rightHipStage, .cyan))

            let baseThighLen: CGFloat = refTorsoH * 0.50
            let baseShinLen: CGFloat = refTorsoH * 0.50

            let legSides: [(isRight: Bool, hipStage: CGPoint, thighSlot: PuppetPartSlot, shinSlot: PuppetPartSlot, footSlot: PuppetPartSlot)] = [
                (true, rightHipStage, .rightThigh, .rightShin, .rightFoot),
                (false, leftHipStage, .leftThigh, .leftShin, .leftFoot)
            ]

            for side in legSides {
                let hasShin: Bool = (puppet.partEnabled[side.shinSlot] != false && (puppet.partImages[side.shinSlot] != nil || puppet.partImages[.leftShin] != nil))
                let baseLen: CGFloat = baseThighLen
                let thighLen: CGFloat = baseLen * legLenMult * puppet.partHeight(for: side.thighSlot)
                let shinLen: CGFloat = baseShinLen * legLenMult * puppet.partHeight(for: side.shinSlot)

                let legTarget = buildLegJointTarget(
                    hipStage: side.hipStage,
                    thighLen: thighLen,
                    shinLen: shinLen,
                    bodyTurn: bodyTurn,
                    moveY: moveY,
                    stageHeight: size.height,
                    isRightSide: side.isRight,
                    posePt: posePt
                )

                let rawThighVec = CGPoint(x: legTarget.rawKnee.x - side.hipStage.x, y: legTarget.rawKnee.y - side.hipStage.y)
                let rawShinVec = CGPoint(x: legTarget.rawAnkle.x - legTarget.rawKnee.x, y: legTarget.rawAnkle.y - legTarget.rawKnee.y)

                let thighRotDeg: Double = puppet.partRotationDegrees(for: side.thighSlot)
                let thighRotRad: CGFloat = CGFloat(thighRotDeg * .pi / 180.0)
                let thighChainRotRad: CGFloat = followRotate ? thighRotRad : 0.0
                let thighLocalRotRad: CGFloat = followRotate ? 0.0 : thighRotRad
                let thighRawOff = puppet.partOffset(for: side.thighSlot)
                let thighOffStage = CGSize(width: thighRawOff.width * offsetUnit, height: thighRawOff.height * offsetUnit)

                let thighVecRot = rotateStageVec(rawThighVec, by: parentLegRotRad + thighChainRotRad)
                let thighStart = CGPoint(x: side.hipStage.x + thighOffStage.width, y: side.hipStage.y + thighOffStage.height)
                let thighEnd = CGPoint(x: thighStart.x + thighVecRot.x, y: thighStart.y + thighVecRot.y)
                let kneeForChild = followMove ? thighEnd : CGPoint(x: side.hipStage.x + thighVecRot.x, y: side.hipStage.y + thighVecRot.y)

                let shinRotDeg: Double = puppet.partRotationDegrees(for: side.shinSlot)
                let shinRotRad: CGFloat = CGFloat(shinRotDeg * .pi / 180.0)
                let shinChainRotRad: CGFloat = followRotate ? shinRotRad : 0.0
                let shinLocalRotRad: CGFloat = followRotate ? 0.0 : shinRotRad
                let shinRawOff = puppet.partOffset(for: side.shinSlot)
                let shinOffStage = CGSize(width: shinRawOff.width * offsetUnit, height: shinRawOff.height * offsetUnit)

                let shinVecRot = rotateStageVec(rawShinVec, by: parentLegRotRad + thighChainRotRad + shinChainRotRad)
                let shinStart = CGPoint(x: kneeForChild.x + shinOffStage.width, y: kneeForChild.y + shinOffStage.height)
                let shinEnd = CGPoint(x: shinStart.x + shinVecRot.x, y: shinStart.y + shinVecRot.y)
                let ankleForChild = followMove ? shinEnd : CGPoint(x: kneeForChild.x + shinVecRot.x, y: kneeForChild.y + shinVecRot.y)

                if let thighPart = buildLimbSegmentPart(
                    slot: side.thighSlot,
                    startPinId: "hipJoint",
                    endPinId: "kneeJoint",
                    from: thighStart,
                    to: thighEnd,
                    naturalLength: baseLen,
                    thicknessScale: legThickMult,
                    localRotationRad: thighLocalRotRad
                ) {
                    partsBySlot[side.thighSlot] = thighPart
                }

                if hasShin {
                    stagePins.append((shinStart, .cyan))
                    stagePins.append((shinEnd, .cyan))
                    if let shinPart = buildLimbSegmentPart(
                        slot: side.shinSlot,
                        startPinId: "kneeJoint",
                        endPinId: "ankleJoint",
                        from: shinStart,
                        to: shinEnd,
                        naturalLength: baseShinLen,
                        thicknessScale: legThickMult,
                        localRotationRad: shinLocalRotRad
                    ) {
                        partsBySlot[side.shinSlot] = shinPart
                    }
                }

                let ankleForFoot = hasShin ? ankleForChild : kneeForChild
                let kneeForFoot = hasShin ? shinStart : thighStart
                let footParentRotDeg: Double = followRotate
                    ? (Double((parentLegRotRad + thighChainRotRad + (hasShin ? shinChainRotRad : 0.0)) * 180.0 / .pi))
                    : 0.0
                if let footRes = buildFootPart(
                    slot: side.footSlot,
                    anklePt: ankleForFoot,
                    kneePt: kneeForFoot,
                    isRightSide: side.isRight,
                    refTorsoH: refTorsoH,
                    legThickMult: legThickMult,
                    parentManualRotDeg: footParentRotDeg,
                    offsetUnit: offsetUnit
                ) {
                    partsBySlot[side.footSlot] = footRes.part
                    stagePins.append((footRes.ankleDrawPt, .mint))
                }
            }
        }

        // Arms & Hands
        let baseUpperArmLen: CGFloat = refTorsoH * 0.52
        let baseForearmLen: CGFloat = refTorsoH * 0.50
        let realHeadX: CGFloat = CGFloat(fm.present ? fm.rawAnchorX : 0.50)
        let realHeadY: CGFloat = CGFloat(fm.present ? fm.rawAnchorY : 0.48)
        let realHeadCameraH: CGFloat = max(0.14, min(0.45, CGFloat(fm.present ? fm.rawIOD : 0.085) * 2.8))
        let camShoulderSpan: CGFloat = {
            if let ls = posePt(11), let rs = posePt(12) {
                return max(40.0, hypot(rs.x - ls.x, rs.y - ls.y))
            }
            return max(40.0, size.width * 0.22)
        }()

        let armSides: [(isLeft: Bool, shoulderStage: CGPoint, upperSlot: PuppetPartSlot, foreSlot: PuppetPartSlot, handSlot: PuppetPartSlot, poseShoulderIdx: Int, poseElbowIdx: Int, poseWristIdx: Int)] = [
            (true, leftShoulderStage, .leftUpperArm, .leftForearm, .leftHand, 11, 13, 15),
            (false, rightShoulderStage, .rightUpperArm, .rightForearm, .rightHand, 12, 14, 16)
        ]

        for side in armSides {
            let label = side.isLeft ? "L" : "R"
            let trackedHand = activeFrame.hands.first(where: { $0.label == label && $0.smoothedLandmarks.count >= 21 })
            let pShoulder = posePt(side.poseShoulderIdx)
            let pElbow = posePt(side.poseElbowIdx)
            let pPoseWrist = posePt(side.poseWristIdx)
            let hasForearm = (puppet.partEnabled[side.foreSlot] != false && (puppet.partImages[side.foreSlot] != nil || puppet.partImages[.leftForearm] != nil))

            let upperArmLen: CGFloat = baseUpperArmLen * armLenMult * puppet.partHeight(for: side.upperSlot)
            let forearmLen: CGFloat = baseForearmLen * armLenMult * puppet.partHeight(for: side.foreSlot)
            let baseOnePieceLen: CGFloat = refTorsoH * 0.94
            let onePieceLen: CGFloat = baseOnePieceLen * armLenMult * puppet.partHeight(for: side.upperSlot)

            let (rawElbow, rawWrist, rawHandAngle, handDepthScale, palmSign): (CGPoint, CGPoint, CGFloat, CGFloat, CGFloat) = {
                if let hand = trackedHand {
                    let wristX: CGFloat = 1.0 - CGFloat(hand.smoothedLandmarks[0].x)
                    let wristY: CGFloat = CGFloat(hand.smoothedLandmarks[0].y)
                    let palmX: CGFloat = 1.0 - CGFloat(hand.smoothedLandmarks[9].x)
                    let palmY: CGFloat = CGFloat(hand.smoothedLandmarks[9].y)
                    let handScreenX: CGFloat = wristX * 0.72 + palmX * 0.28
                    let handScreenY: CGFloat = wristY * 0.78 + palmY * 0.22

                    // Anatomical ground-truth shoulder-relative reach:
                    let outSign: CGFloat = side.isLeft ? -1.0 : 1.0
                    let camShoulderStagePt: CGPoint = {
                        if let ps = pShoulder { return ps }
                        let estimatedCamX = (realHeadX + outSign * realHeadCameraH * 0.88)
                        let estimatedCamY = (realHeadY + realHeadCameraH * 1.05)
                        return CGPoint(x: estimatedCamX * size.width, y: estimatedCamY * size.height)
                    }()
                    let handStagePt = CGPoint(x: handScreenX * size.width, y: handScreenY * size.height)
                    let dCamX = (handStagePt.x - camShoulderStagePt.x) / max(1.0, realHeadCameraH * size.height)
                    let dCamY = (handStagePt.y - camShoulderStagePt.y) / max(1.0, realHeadCameraH * size.height)

                    let totalArmSpan: CGFloat = upperArmLen + (hasForearm ? forearmLen : 0.0)
                    let reachUnit: CGFloat = (totalArmSpan / 2.05) * max(0.85, armLenMult)
                    let rawTargetWrist = CGPoint(
                        x: side.shoulderStage.x + dCamX * reachUnit,
                        y: side.shoulderStage.y + dCamY * reachUnit
                    )
                    let depthScale: CGFloat = max(0.88, min(1.18, CGFloat(hand.scale)))
                    if hasForearm {
                        let elbow = solveTwoBoneIKElbow(
                            shoulder: side.shoulderStage,
                            targetWrist: rawTargetWrist,
                            len1: upperArmLen,
                            len2: forearmLen,
                            isLeftArm: side.isLeft,
                            poseShoulder: pShoulder,
                            poseElbow: pElbow
                        )
                        let fDx: CGFloat = rawTargetWrist.x - elbow.x
                        let fDy: CGFloat = rawTargetWrist.y - elbow.y
                        let fDist: CGFloat = max(1.0, hypot(fDx, fDy))
                        let wrist = CGPoint(
                            x: elbow.x + (fDx / fDist) * forearmLen,
                            y: elbow.y + (fDy / fDist) * forearmLen
                        )
                        return (elbow, wrist, CGFloat(hand.wristAngle), depthScale, CGFloat(hand.palmFacingSign))
                    } else {
                        let sDx: CGFloat = rawTargetWrist.x - side.shoulderStage.x
                        let sDy: CGFloat = rawTargetWrist.y - side.shoulderStage.y
                        let sDist: CGFloat = max(1.0, hypot(sDx, sDy))
                        let clampedLen: CGFloat = max(onePieceLen * 0.78, min(onePieceLen * 1.02, sDist))
                        let wrist = CGPoint(
                            x: side.shoulderStage.x + (sDx / sDist) * clampedLen,
                            y: side.shoulderStage.y + (sDy / sDist) * clampedLen
                        )
                        return (side.shoulderStage, wrist, CGFloat(hand.wristAngle), depthScale, CGFloat(hand.palmFacingSign))
                    }
                } else if let pS = pShoulder, let pE = pElbow, let pW = pPoseWrist,
                          hypot(pE.x - pS.x, pE.y - pS.y) > 12.0,
                          hypot(pW.x - pE.x, pW.y - pE.y) > 10.0 {
                    let uDx: CGFloat = pE.x - pS.x
                    let uDy: CGFloat = pE.y - pS.y
                    let upperAngle: CGFloat = atan2(uDy, uDx)
                    let uForeshorten: CGFloat = max(0.65, min(1.08, hypot(uDx, uDy) / (camShoulderSpan * 0.80)))
                    let fDx: CGFloat = pW.x - pE.x
                    let fDy: CGFloat = pW.y - pE.y
                    let foreAngle: CGFloat = atan2(fDy, fDx)
                    let fForeshorten: CGFloat = max(0.65, min(1.08, hypot(fDx, fDy) / (camShoulderSpan * 0.76)))
                    let resolvedHandAngle: CGFloat = foreAngle + .pi * 0.5
                    if hasForearm {
                        let elbow = CGPoint(
                            x: side.shoulderStage.x + cos(upperAngle) * upperArmLen * uForeshorten,
                            y: side.shoulderStage.y + sin(upperAngle) * upperArmLen * uForeshorten
                        )
                        let wrist = CGPoint(
                            x: elbow.x + cos(foreAngle) * forearmLen * fForeshorten,
                            y: elbow.y + sin(foreAngle) * forearmLen * fForeshorten
                        )
                        return (elbow, wrist, resolvedHandAngle, 1.0, 1.0)
                    } else {
                        let totalAngle: CGFloat = atan2(pW.y - pS.y, pW.x - pS.x)
                        let wrist = CGPoint(
                            x: side.shoulderStage.x + cos(totalAngle) * onePieceLen,
                            y: side.shoulderStage.y + sin(totalAngle) * onePieceLen
                        )
                        return (side.shoulderStage, wrist, resolvedHandAngle, 1.0, 1.0)
                    }
                } else {
                    let sway: CGFloat = CGFloat(sin(time * 2.1 + (side.isLeft ? 0.0 : 1.2))) * 0.04 * CGFloat(puppet.idleMotionAmount)
                    let outSign: CGFloat = side.isLeft ? -1.0 : 1.0
                    let elbow = CGPoint(
                        x: side.shoulderStage.x + outSign * upperArmLen * (0.24 + sway),
                        y: side.shoulderStage.y + upperArmLen * 0.94
                    )
                    let wrist: CGPoint = {
                        if !hasForearm {
                            return CGPoint(
                                x: side.shoulderStage.x + outSign * onePieceLen * (0.16 + sway * 0.5),
                                y: side.shoulderStage.y + onePieceLen * 0.96
                            )
                        }
                        return CGPoint(
                            x: elbow.x + outSign * forearmLen * 0.08,
                            y: elbow.y + forearmLen * 0.90
                        )
                    }()
                    let restDx: CGFloat = wrist.x - (hasForearm ? elbow.x : side.shoulderStage.x)
                    let restDy: CGFloat = wrist.y - (hasForearm ? elbow.y : side.shoulderStage.y)
                    let restHandAngle: CGFloat = atan2(restDy, restDx) + .pi * 0.5
                    return (elbow, wrist, restHandAngle, 1.0, 1.0)
                }
            }()

            let upperRotRad: CGFloat = CGFloat(puppet.partRotationDegrees(for: side.upperSlot) * .pi / 180.0)
            let foreRotRad: CGFloat = CGFloat(puppet.partRotationDegrees(for: side.foreSlot) * .pi / 180.0)
            let upperChainRotRad: CGFloat = followRotate ? upperRotRad : 0.0
            let upperLocalRotRad: CGFloat = followRotate ? 0.0 : upperRotRad
            let foreChainRotRad: CGFloat = followRotate ? foreRotRad : 0.0
            let foreLocalRotRad: CGFloat = followRotate ? 0.0 : foreRotRad

            let upperRawOff = puppet.partOffset(for: side.upperSlot)
            let upperOffStage = CGSize(width: upperRawOff.width * offsetUnit, height: upperRawOff.height * offsetUnit)
            let foreRawOff = puppet.partOffset(for: side.foreSlot)
            let foreOffStage = CGSize(width: foreRawOff.width * offsetUnit, height: foreRawOff.height * offsetUnit)

            let upperStart: CGPoint
            let upperEnd: CGPoint
            let foreStart: CGPoint
            let foreEnd: CGPoint
            let wristStage: CGPoint

            if hasForearm {
                let rawUpperVec = CGPoint(x: rawElbow.x - side.shoulderStage.x, y: rawElbow.y - side.shoulderStage.y)
                let upperVecRot = rotateStageVec(rawUpperVec, by: torsoChainRotRad + upperChainRotRad)
                upperStart = CGPoint(x: side.shoulderStage.x + upperOffStage.width, y: side.shoulderStage.y + upperOffStage.height)
                upperEnd = CGPoint(x: upperStart.x + upperVecRot.x, y: upperStart.y + upperVecRot.y)

                let elbowChildAnchor = followMove
                    ? upperEnd
                    : CGPoint(x: side.shoulderStage.x + upperVecRot.x, y: side.shoulderStage.y + upperVecRot.y)

                let rawForeVec = CGPoint(x: rawWrist.x - rawElbow.x, y: rawWrist.y - rawElbow.y)
                let foreVecRot = rotateStageVec(rawForeVec, by: torsoChainRotRad + upperChainRotRad + foreChainRotRad)
                foreStart = CGPoint(x: elbowChildAnchor.x + foreOffStage.width, y: elbowChildAnchor.y + foreOffStage.height)
                foreEnd = CGPoint(x: foreStart.x + foreVecRot.x, y: foreStart.y + foreVecRot.y)

                wristStage = followMove
                    ? foreEnd
                    : CGPoint(x: elbowChildAnchor.x + foreVecRot.x, y: elbowChildAnchor.y + foreVecRot.y)
                stagePins.append((foreStart, .orange))
            } else {
                let rawArmVec = CGPoint(x: rawWrist.x - side.shoulderStage.x, y: rawWrist.y - side.shoulderStage.y)
                let armVecRot = rotateStageVec(rawArmVec, by: torsoChainRotRad + upperChainRotRad)
                upperStart = CGPoint(x: side.shoulderStage.x + upperOffStage.width, y: side.shoulderStage.y + upperOffStage.height)
                upperEnd = CGPoint(x: upperStart.x + armVecRot.x, y: upperStart.y + armVecRot.y)
                foreStart = side.shoulderStage
                foreEnd = upperEnd
                wristStage = followMove
                    ? upperEnd
                    : CGPoint(x: side.shoulderStage.x + armVecRot.x, y: side.shoulderStage.y + armVecRot.y)
            }
            stagePins.append((wristStage, .orange))

            let palmFlipDirection: CGFloat = puppet.dynamicPalmFlip ? ((palmSign >= 0.0) ? 1.0 : -1.0) : 1.0
            let palmPerspective: CGFloat = max(0.68, min(1.0, abs(palmSign) * 1.2))
            let signedPalmFlipX: CGFloat = palmFlipDirection * palmPerspective

            if hasForearm {
                if let upperPart = buildLimbSegmentPart(
                    slot: side.upperSlot,
                    startPinId: "shoulderJoint",
                    endPinId: "elbowJoint",
                    from: upperStart,
                    to: upperEnd,
                    naturalLength: baseUpperArmLen,
                    thicknessScale: armThickMult,
                    localRotationRad: upperLocalRotRad
                ) {
                    partsBySlot[side.upperSlot] = upperPart
                }
                if let forePart = buildLimbSegmentPart(
                    slot: side.foreSlot,
                    startPinId: "elbowJoint",
                    endPinId: "wristJoint",
                    from: foreStart,
                    to: foreEnd,
                    naturalLength: baseForearmLen,
                    thicknessScale: armThickMult,
                    localRotationRad: foreLocalRotRad
                ) {
                    partsBySlot[side.foreSlot] = forePart
                }
            } else {
                if let onePart = buildLimbSegmentPart(
                    slot: side.upperSlot,
                    startPinId: "shoulderJoint",
                    endPinId: "elbowJoint",
                    from: upperStart,
                    to: upperEnd,
                    naturalLength: baseOnePieceLen,
                    thicknessScale: armThickMult * (1.0 + (handDepthScale - 1.0) * 0.35),
                    flipAcrossBone: palmSign < 0.0,
                    localRotationRad: upperLocalRotRad
                ) {
                    partsBySlot[side.upperSlot] = onePart
                }
            }

            let hasHandDirect = (puppet.partImages[side.handSlot] != nil)
            let handFallbackSlot: PuppetPartSlot = side.isLeft ? .rightHand : .leftHand
            let hasHandFallback = (puppet.partImages[handFallbackSlot] != nil)
            let hasAnyHand = (puppet.partEnabled[side.handSlot] != false) && (hasHandDirect || hasHandFallback)

            if hasAnyHand {
                let activeHandSlot = hasHandDirect ? side.handSlot : handFallbackSlot
                if let handImg = puppet.partImages[activeHandSlot] {
                    let needsHandMirror = !hasHandDirect && hasHandFallback
                    let wristUV = puppet.pin(in: activeHandSlot, id: "wristPivot")
                    let knuckleUV = puppet.pin(in: activeHandSlot, id: "middleKnuckle")
                    let handAspect: CGFloat = handImg.size.width / max(1.0, handImg.size.height)
                    let baseHandH: CGFloat = size.height * CGFloat(puppet.handScale) * clampedScale * handDepthScale
                    let baseHandW: CGFloat = baseHandH * handAspect
                    let pinDx: CGFloat = (knuckleUV.x - wristUV.x) * baseHandW
                    let pinDy: CGFloat = (knuckleUV.y - wristUV.y) * baseHandH
                    let intrinsicHandAngle: CGFloat = (hypot(pinDx, pinDy) > 1.0) ? atan2(pinDx, -pinDy) : 0.0

                    let handXf = resolvedMirrorTransform(slot: side.handSlot, fallbackSlot: handFallbackSlot, needsMirror: needsHandMirror)
                    let finalHandW: CGFloat = baseHandW * handXf.width
                    let finalHandH: CGFloat = baseHandH * handXf.height
                    let partRotRad: CGFloat = CGFloat(handXf.rotDeg * .pi / 180.0)
                    let flipH: CGFloat = handXf.flipH ? -1.0 : 1.0
                    let flipV: CGFloat = handXf.flipV ? -1.0 : 1.0
                    let avgCurl: CGFloat = {
                        guard let hand = trackedHand, !hand.fingerCurls.isEmpty else { return 0.0 }
                        return CGFloat(hand.fingerCurls.reduce(0, +) / Float(hand.fingerCurls.count))
                    }()
                    let curlSquashY: CGFloat = 1.0 - (avgCurl * 0.16)

                    // Effective hand orientation:
                    // If thumb is extended independently (e.g. thumbs up or pointing gesture), blend towards thumb vector
                    let effectiveHandAngle: CGFloat = {
                        guard let hand = trackedHand else { return rawHandAngle }
                        let thumbCurl = hand.fingerCurls.first ?? 0.0
                        let indexCurl = hand.fingerCurls.count > 1 ? hand.fingerCurls[1] : 0.0
                        if thumbCurl < 0.35 && indexCurl > 0.65 {
                            return CGFloat(hand.thumbAngle)
                        }
                        return rawHandAngle
                    }()

                    let hOff = puppet.partOffset(for: side.handSlot)
                    let handPivotPt = CGPoint(x: wristStage.x + hOff.width * offsetUnit, y: wristStage.y + hOff.height * offsetUnit)
                    let totalHandRot: CGFloat = effectiveHandAngle + partRotRad - intrinsicHandAngle
                    let defaultHandSignX: CGFloat = needsHandMirror ? -1.0 : 1.0
                    let finalFlipX: CGFloat = defaultHandSignX * signedPalmFlipX * flipH

                    let xfData = makeAnchoredTransform(
                        pivotStage: handPivotPt,
                        rotationRad: totalHandRot,
                        flipX: finalFlipX,
                        flipY: flipV * curlSquashY,
                        pivotUV: wristUV,
                        width: finalHandW,
                        height: finalHandH
                    )
                    let drawRect = CGRect(x: 0, y: 0, width: finalHandW, height: finalHandH)
                    partsBySlot[side.handSlot] = PlacedStagePart(
                        slot: side.handSlot,
                        image: handImg,
                        localBounds: drawRect,
                        localToStage: xfData.localToStage,
                        boxSize: xfData.boxSize,
                        boxToStage: xfData.boxToStage,
                        pivotInBox: xfData.pivotInBox
                    ) { context in
                        var handCtx = context
                        handCtx.concatenate(xfData.localToStage)
                        handCtx.draw(Image(nsImage: handImg), in: drawRect)
                    }

                    if let hand = trackedHand {
                        let visScale: CGFloat = size.height * CGFloat(puppet.handScale) * clampedScale * handDepthScale * 1.8
                        handChains.append((handPivotPt, hand, visScale))
                    }
                }
            }
        }

        // Strict Back-to-Front Layer Ordering from puppet.layerStack
        var orderedParts: [PlacedStagePart] = []
        for slot in puppet.layerStack.reversed() {
            if let part = partsBySlot[slot] {
                orderedParts.append(part)
            }
        }
        return StageLayoutResult(parts: orderedParts, stagePins: stagePins, trackedHandChains: handChains)
    }

    private func drawTrackedHandSkeletons(
        context: inout GraphicsContext,
        chains: [(wristStage: CGPoint, hand: TrackedHand, visualScale: CGFloat)]
    ) {
        let fingerChains: [[Int]] = [
            [0, 1, 2, 3, 4],
            [0, 5, 6, 7, 8],
            [0, 9, 10, 11, 12],
            [0, 13, 14, 15, 16],
            [0, 17, 18, 19, 20]
        ]
        for entry in chains {
            guard entry.hand.smoothedLandmarks.count >= 21 else { continue }
            let baseLm0 = entry.hand.smoothedLandmarks[0]
            for chain in fingerChains {
                for i in 0..<(chain.count - 1) {
                    let lmA = entry.hand.smoothedLandmarks[chain[i]]
                    let lmB = entry.hand.smoothedLandmarks[chain[i + 1]]
                    let ptA = CGPoint(
                        x: entry.wristStage.x + CGFloat(lmA.x - baseLm0.x) * entry.visualScale,
                        y: entry.wristStage.y + CGFloat(lmA.y - baseLm0.y) * entry.visualScale
                    )
                    let ptB = CGPoint(
                        x: entry.wristStage.x + CGFloat(lmB.x - baseLm0.x) * entry.visualScale,
                        y: entry.wristStage.y + CGFloat(lmB.y - baseLm0.y) * entry.visualScale
                    )
                    var linePath = Path()
                    linePath.move(to: ptA)
                    linePath.addLine(to: ptB)
                    context.stroke(linePath, with: .color(.orange.opacity(0.85)), lineWidth: 1.5)
                    drawStagePin(context: &context, at: ptB, color: .yellow)
                }
            }
        }
    }

    // MARK: - 2-Bone Inverse Kinematics & Limb Drawing Helpers

    private func solveTwoBoneIKElbow(
        shoulder: CGPoint,
        targetWrist: CGPoint,
        len1: CGFloat,
        len2: CGFloat,
        isLeftArm: Bool,
        poseShoulder: CGPoint? = nil,
        poseElbow: CGPoint? = nil
    ) -> CGPoint {
        let dx = targetWrist.x - shoulder.x
        let dy = targetWrist.y - shoulder.y
        let rawDist = max(1.0, hypot(dx, dy))
        // Human Anatomy Constraints limit maximum arm extension so elbows retain natural bend without dog-legging
        let constraintLimit = 0.99 - CGFloat(puppet.humanAnatomyConstraints) * 0.04
        let maxReach = (len1 + len2) * constraintLimit
        let minReach = abs(len1 - len2) + 4.0
        let d = max(minReach, min(maxReach, rawDist))

        let baseAngle: CGFloat = atan2(dy, dx)
        let num: CGFloat = len1 * len1 + d * d - len2 * len2
        let den: CGFloat = max(0.0001, 2.0 * len1 * d)
        let cosA: CGFloat = num / den
        let clampedCos: CGFloat = max(-1.0, min(1.0, cosA))
        let bendAngle: CGFloat = CGFloat(acos(Double(clampedCos)))

        // Evaluate both circle-intersection elbow candidates (+bendAngle vs -bendAngle)
        let anglePlus = baseAngle + bendAngle
        let angleMinus = baseAngle - bendAngle
        let ptPlus = CGPoint(x: shoulder.x + cos(anglePlus) * len1, y: shoulder.y + sin(anglePlus) * len1)
        let ptMinus = CGPoint(x: shoulder.x + cos(angleMinus) * len1, y: shoulder.y + sin(angleMinus) * len1)

        // If Apple Vision body pose tracks the user's real shoulder and elbow, choose the IK solution
        // that matches the user's actual physical elbow direction (e.g. raised high, bent outward, or down)!
        if let pS = poseShoulder, let pE = poseElbow, hypot(pE.x - pS.x, pE.y - pS.y) > 12.0 {
            let trackDirX = pE.x - pS.x
            let trackDirY = pE.y - pS.y
            let dotPlus = (ptPlus.x - shoulder.x) * trackDirX + (ptPlus.y - shoulder.y) * trackDirY
            let dotMinus = (ptMinus.x - shoulder.x) * trackDirX + (ptMinus.y - shoulder.y) * trackDirY
            return (dotPlus >= dotMinus) ? ptPlus : ptMinus
        }

        // Default: choose whichever elbow points naturally outward and away from the body / head
        let outSign: CGFloat = isLeftArm ? -1.0 : 1.0
        let isRaised = dy < 0
        let scorePlus = outSign * (ptPlus.x - shoulder.x) - (isRaised ? (ptPlus.y - shoulder.y) * 0.45 : 0.0)
        let scoreMinus = outSign * (ptMinus.x - shoulder.x) - (isRaised ? (ptMinus.y - shoulder.y) * 0.45 : 0.0)
        return (scorePlus >= scoreMinus) ? ptPlus : ptMinus
    }

    private func drawStagePin(context: inout GraphicsContext, at pt: CGPoint, color: Color) {
        let r = CGRect(x: pt.x - 4.5, y: pt.y - 4.5, width: 9, height: 9)
        context.fill(Path(ellipseIn: r), with: .color(color))
        context.stroke(Path(ellipseIn: r), with: .color(.black), lineWidth: 1.5)
    }
}

// MARK: - Full 2D Puppet Studio View (Instructions + Undo/Redo + Pin Rigging Editor + Live Stage)

public struct PuppetStudioView: View {
    @ObservedObject public var puppet: PuppetController
    @ObservedObject public var tracker: HolisticTracker
    public var onOpenFullStage: (() -> Void)? = nil
    @State private var sidebarTab: Int = 0 // 0: Rigging Pins, 1: Sprites & Depth, 2: Proportions

    public init(puppet: PuppetController, tracker: HolisticTracker, onOpenFullStage: (() -> Void)? = nil) {
        self.puppet = puppet
        self.tracker = tracker
        self.onOpenFullStage = onOpenFullStage
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            studioTopActionRow

            if puppet.showGuideBanner {
                guideBanner
            }

            HStack(alignment: .top, spacing: 16) {
                // Main Hero: Live Puppet Stage + Camera Mini-Feed
                VStack(alignment: .leading, spacing: 12) {
                    PuppetStageView(
                        puppet: puppet,
                        frame: tracker.latestFrame,
                        isCalibrated: tracker.calibrationBaseline.isCalibrated,
                        onCalibrate: { tracker.calibrateNeutralFace() },
                        onToggleFullStage: onOpenFullStage
                    )

                    HStack(spacing: 12) {
                        CameraPreviewView(
                            session: tracker.captureSession,
                            frame: tracker.latestFrame,
                            mirror: tracker.settings.mirror,
                            isRunning: tracker.isRunning
                        )
                        .frame(width: 240)

                        liveExpressionMonitorCard
                    }
                }
                .frame(maxWidth: .infinity)

                // Right Sidebar: Clean 2-Tab Inspector (Rigging & Sprites / Proportions & Motion)
                VStack(alignment: .leading, spacing: 10) {
                    Picker("", selection: $sidebarTab) {
                        Text("Rigging & Sprites").tag(0)
                        Text("Proportions & Motion").tag(1)
                    }
                    .pickerStyle(.segmented)

                    if sidebarTab == 0 {
                        ScrollView(.vertical, showsIndicators: true) {
                            VStack(spacing: 12) {
                                categoryAndPartSelectorBar
                                PuppetPinEditorCanvas(puppet: puppet, slot: puppet.selectedSlot)
                                partInspectorCard
                            }
                        }
                    } else {
                        ScrollView(.vertical, showsIndicators: true) {
                            VStack(spacing: 12) {
                                deformationSlidersCard
                            }
                        }
                    }
                }
                .frame(width: 380)
            }
        }
        .sheet(isPresented: $puppet.showSheetImporter) {
            PuppetSheetImporterModal(puppet: puppet)
        }
    }

    // MARK: - Studio Top Toolbar (Preset Switcher + Undo / Redo + Reset)

    private var studioTopActionRow: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                Image(systemName: "theatermasks.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.cyan)
                TextField("Character Name", text: $puppet.characterName)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12, weight: .semibold))
                    .frame(width: 135)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 4)
                    .background(Color.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }

            Divider()
                .frame(height: 18)
                .overlay(Color.white.opacity(0.12))

            // Undo & Redo Buttons with standard Cmd+Z / Cmd+Shift+Z shortcuts
            Button {
                puppet.undo()
            } label: {
                Label("Undo", systemImage: "arrow.uturn.backward")
                    .font(.system(size: 11.5, weight: .medium))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(!puppet.canUndo)
            .keyboardShortcut("z", modifiers: .command)
            .help("Undo last pin move or graphic change (⌘Z)")

            Button {
                puppet.redo()
            } label: {
                Label("Redo", systemImage: "arrow.uturn.forward")
                    .font(.system(size: 11.5, weight: .medium))
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .disabled(!puppet.canRedo)
            .keyboardShortcut("z", modifiers: [.command, .shift])
            .help("Redo (⇧⌘Z)")

            // Save Character Package Button (Pops up dialog to name & save character)
            Button {
                puppet.exportCharacterPackage()
            } label: {
                Label("Save Character…", systemImage: "externaldrive.fill.badge.checkmark")
                    .font(.system(size: 11.5, weight: .semibold))
            }
            .buttonStyle(.borderedProminent)
            .tint(.cyan)
            .controlSize(.small)
            .help("Save character package with all custom sprites & rig coordinates (⌘S)")

            // Save / Export / Load Character Menu
            Menu {
                Button {
                    puppet.exportCharacterPackage()
                } label: {
                    Label("Save Character Package… (⌘S)", systemImage: "externaldrive.fill.badge.checkmark")
                }

                Button {
                    puppet.exportRigOnly()
                } label: {
                    Label("Export Rig Only (Coordinates Only)… (⌥⌘S)", systemImage: "slider.horizontal.3")
                }

                Button {
                    puppet.importRigFromFile()
                } label: {
                    Label("Load Character / Rig (.puppet.json)… (⌘O)", systemImage: "square.and.arrow.down")
                }
                .keyboardShortcut("o", modifiers: .command)

                Divider()

                Button(role: .destructive) {
                    puppet.resetPinsToDefault()
                } label: {
                    Label("Reset Pins to Defaults", systemImage: "arrow.counterclockwise")
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.icloud.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.green)
                    Text(puppet.lastSavedStatus)
                        .font(.system(size: 11, weight: .semibold))
                }
            }
            .menuStyle(.borderedButton)
            .controlSize(.small)
            .fixedSize()
            .help("Click to export/import full character packages or rig coordinates.")

            Button {
                puppet.showSheetImporter = true
            } label: {
                Label("Paper Puppet Sheet", systemImage: "scissors")
                    .font(.system(size: 11.5, weight: .semibold))
            }
            .buttonStyle(.borderedProminent)
            .tint(.teal)
            .controlSize(.small)
            .help("Import a single cut-out sheet image where each body part is clickable, or copy instructions for a designer / AI generator")

            // Live Smoothing Slider
            HStack(spacing: 5) {
                Image(systemName: "waveform.path")
                    .font(.system(size: 10.5))
                    .foregroundStyle(Color.teal)
                Text("Smoothing")
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .fixedSize()
                Slider(value: $tracker.settings.smoothing, in: 0.0...0.90)
                    .frame(width: 70)
                    .controlSize(.mini)
                Text(String(format: "%.0f%%", tracker.settings.smoothing * 100))
                    .font(.system(size: 9.5, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .fixedSize()
            }

            Spacer()

            Button {
                puppet.showGuideBanner.toggle()
            } label: {
                Label(puppet.showGuideBanner ? "Hide Guide" : "Show Guide", systemImage: "questionmark.circle")
                    .font(.system(size: 11.5))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    // MARK: - In-App Step-by-Step Guide Banner

    private var guideBanner: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles.rectangle.stack.fill")
                        .foregroundStyle(Color.teal)
                    Text("How to Rig & Animate Your 2D Character")
                        .font(.system(size: 13, weight: .bold))
                }
                Spacer()
                Text("Tip: Double-click any pin in the Rigging Editor to reset it to its default position · Use ⌘Z / ⇧⌘Z to Undo/Redo")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.teal)
            }

            HStack(alignment: .top, spacing: 10) {
                GuideStepBox(
                    number: "1",
                    title: "Load Paper Sheet or Drop PNGs",
                    text: "Import a front-facing Paper Puppet Sheet to cut out parts automatically, or drag your own transparent PNGs into any part slot."
                )
                GuideStepBox(
                    number: "2",
                    title: "Place Control Pins",
                    text: "Drag pins onto joints & facial features. Double-click any pin to snap it back to its default position. Full Undo (⌘Z) & Redo (⇧⌘Z) are supported."
                )
                GuideStepBox(
                    number: "3",
                    title: "Nose, Eyes & 2.5D Turn",
                    text: "The Nose layer shifts furthest during 2.5D head turns, Eyes wink independently (Left/Right), and the Torso, Shoulders & Tail follow your 2.5D rotation."
                )
                GuideStepBox(
                    number: "4",
                    title: "Natural Hands & Depth",
                    text: "Hands match your real height relative to your head, grow larger when closer to the camera, and flip horizontally when you turn your palm vs. back-of-hand!"
                )
            }
        }
        .padding(14)
        .background(Color.teal.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.teal.opacity(0.3), lineWidth: 1)
        )
    }

    private var categoryAndPartSelectorBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                ForEach(PuppetPartCategory.allCases) { cat in
                    let isCat = (puppet.selectedCategory == cat)
                    Button {
                        puppet.selectedCategory = cat
                        if let firstSlot = PuppetPartSlot.allCases.first(where: { $0.category == cat }) {
                            puppet.selectedSlot = firstSlot
                            puppet.showStageTransformBox = puppet.isStageLayerSlot(firstSlot)
                        }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: cat.icon)
                                .font(.system(size: 11))
                            Text(cat.rawValue)
                                .font(.system(size: 11.5, weight: isCat ? .bold : .medium))
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity)
                        .background(isCat ? Color.teal : Color.white.opacity(0.06))
                        .foregroundStyle(isCat ? Color.black : Color.secondary)
                        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    ForEach(PuppetPartSlot.allCases.filter { $0.category == puppet.selectedCategory }) { slot in
                        let isSelected = (puppet.selectedSlot == slot)
                        let isEnabled = (puppet.partEnabled[slot] ?? false)
                        Button {
                            puppet.selectedSlot = slot
                            puppet.showStageTransformBox = puppet.isStageLayerSlot(slot)
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: slot.systemIcon)
                                    .font(.system(size: 11))
                                Text(slot.title)
                                    .font(.system(size: 11.5, weight: isSelected ? .semibold : .regular))
                                Circle()
                                    .fill(isEnabled ? Color.teal : Color.gray.opacity(0.4))
                                    .frame(width: 6, height: 6)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(isSelected ? Color.teal.opacity(0.22) : Color.white.opacity(0.05))
                            .foregroundStyle(isSelected ? Color.teal : Color.primary)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .stroke(isSelected ? Color.teal.opacity(0.6) : Color.white.opacity(0.08), lineWidth: 1)
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var animationStyleCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "wand.and.stars")
                    .foregroundStyle(Color.teal)
                Text("Eyes & Mouth Animation Mode")
                    .font(.system(size: 12.5, weight: .semibold))
                Spacer()
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("EYES (INDEPENDENT LEFT/RIGHT WINK & BLINK)")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                Picker("", selection: $puppet.eyeAnimationMode) {
                    ForEach(EyeAnimationMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .labelsHidden()
            }

            HStack {
                Toggle("Periodic Auto-Blink (Every ~3.8s)", isOn: $puppet.autoBlinkEnabled)
                    .font(.system(size: 11))
                    .toggleStyle(.switch)
                    .controlSize(.small)
                Spacer()
            }

            PuppetSliderRow(label: "WINK / BLINK THRESHOLD", value: $puppet.blinkThreshold, range: 0.20...0.80)

            Divider().overlay(Color.white.opacity(0.08))

            VStack(alignment: .leading, spacing: 4) {
                Text("MOUTH & SPEECH VISEMES (AH / OH / EE / M)")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                Picker("", selection: $puppet.mouthAnimationMode) {
                    ForEach(MouthAnimationMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .labelsHidden()
            }
        }
        .padding(13)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private var liveExpressionMonitorCard: some View {
        let fm = tracker.latestFrame.faceMetrics
        return VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("LIVE FACE, WINK & VISEME METERS")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(fm.viseme.rawValue)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(Color.orange)
            }

            ExpressionBarRow(label: "Mouth / Jaw Open", value: Double(fm.mouthOpen), color: .orange)
            ExpressionBarRow(label: "Smile / Width (Ee)", value: Double(fm.mouthSmile), color: .green)
            ExpressionBarRow(label: "Left Eye Wink", value: Double(fm.eyeBlinkL), color: .yellow)
            ExpressionBarRow(label: "Right Eye Wink", value: Double(fm.eyeBlinkR), color: .yellow)
            ExpressionBarRow(label: "Eyebrows Raise", value: Double(fm.browRaise), color: .cyan)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private var partInspectorCard: some View {
        let slot = puppet.selectedSlot
        let pins = puppet.pinsBySlot[slot] ?? []
        let hasImage = puppet.partImages[slot] != nil

        return VStack(alignment: .leading, spacing: 10) {
            partHeaderSection(slot: slot)
            partDepthSection(slot: slot)
            partSpriteRow(slot: slot, hasImage: hasImage)
            partTransformSection(slot: slot)
            partPinsSection(slot: slot, pins: pins)
        }
        .padding(13)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private func partHeaderSection(slot: PuppetPartSlot) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Image(systemName: slot.systemIcon)
                    .foregroundStyle(Color.teal)
                Text(slot.title)
                    .font(.system(size: 12.5, weight: .semibold))
                Spacer()
                Toggle("", isOn: Binding(
                    get: { puppet.partEnabled[slot] ?? true },
                    set: { newVal in
                        puppet.recordUndoSnapshot()
                        puppet.partEnabled[slot] = newVal
                        puppet.saveCurrentPresetState()
                    }
                ))
                .labelsHidden()
                .toggleStyle(.switch)
                .controlSize(.small)
            }

            Text(slot.subtitle)
                .font(.system(size: 10.5))
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func partDepthSection(slot: PuppetPartSlot) -> some View {
        let visibleStack = puppet.layerStack.filter { s in
            (puppet.partEnabled[s] == true && puppet.partImages[s] != nil) || s == slot
        }

        if puppet.isStageLayerSlot(slot) {
            let visibleIdx = visibleStack.firstIndex(of: slot) ?? 0
            let canFwd = visibleIdx > 0
            let canBack = visibleIdx < max(0, visibleStack.count - 1)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text("LAYER ORDER (FRONT → BACK)")
                        .font(.system(size: 9.5, weight: .bold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("#\(visibleIdx + 1) of \(visibleStack.count)")
                        .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.teal)
                }

                // Quick reorder buttons for the selected part
                HStack(spacing: 5) {
                    Button {
                        puppet.moveLayerToFront(slot)
                    } label: {
                        Label("Front", systemImage: "square.3.layers.3d.top.filled")
                            .font(.system(size: 10))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .disabled(!canFwd)
                    .help("Bring to very front")

                    Button {
                        if visibleIdx > 0 {
                            let targetSlot = visibleStack[visibleIdx - 1]
                            let targetFullIdx = puppet.frontToBackIndex(for: targetSlot)
                            puppet.moveLayer(slot, toIndex: targetFullIdx)
                        }
                    } label: {
                        Label("Forward", systemImage: "arrow.up")
                            .font(.system(size: 10, weight: .semibold))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .disabled(!canFwd)
                    .help("Move 1 layer forward (closer)")

                    Button {
                        if visibleIdx + 1 < visibleStack.count {
                            let targetSlot = visibleStack[visibleIdx + 1]
                            let targetFullIdx = puppet.frontToBackIndex(for: targetSlot)
                            puppet.moveLayer(slot, toIndex: targetFullIdx)
                        }
                    } label: {
                        Label("Back", systemImage: "arrow.down")
                            .font(.system(size: 10, weight: .semibold))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .disabled(!canBack)
                    .help("Move 1 layer backward (behind)")

                    Button {
                        puppet.moveLayerToBack(slot)
                    } label: {
                        Label("Bottom", systemImage: "square.3.layers.3d.bottom.filled")
                            .font(.system(size: 10))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .disabled(!canBack)
                    .help("Send to very back")
                }

                // Compact Front -> Back layer stack list (e.g. Thigh > Shin > Foot)
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(Array(visibleStack.enumerated()), id: \.element) { idx, layerSlot in
                            let isCurrent = (layerSlot == slot)
                            HStack(spacing: 6) {
                                Text("\(idx + 1)")
                                    .font(.system(size: 9, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                    .frame(width: 16, alignment: .trailing)

                                Image(systemName: layerSlot.systemIcon)
                                    .font(.system(size: 10))
                                    .foregroundStyle(isCurrent ? Color.teal : Color.secondary)

                                Text(layerSlot.title)
                                    .font(.system(size: 10.5, weight: isCurrent ? .bold : .regular))
                                    .foregroundStyle(isCurrent ? Color.white : Color.secondary)
                                    .lineLimit(1)

                                Spacer()

                                Button {
                                    if idx > 0 {
                                        let targetFullIdx = puppet.frontToBackIndex(for: visibleStack[idx - 1])
                                        puppet.moveLayer(layerSlot, toIndex: targetFullIdx)
                                    }
                                } label: {
                                    Image(systemName: "chevron.up")
                                        .font(.system(size: 9, weight: .bold))
                                        .frame(width: 18, height: 16)
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(idx > 0 ? Color.primary.opacity(0.85) : Color.secondary.opacity(0.25))
                                .disabled(idx == 0)

                                Button {
                                    if idx + 1 < visibleStack.count {
                                        let targetFullIdx = puppet.frontToBackIndex(for: visibleStack[idx + 1])
                                        puppet.moveLayer(layerSlot, toIndex: targetFullIdx)
                                    }
                                } label: {
                                    Image(systemName: "chevron.down")
                                        .font(.system(size: 9, weight: .bold))
                                        .frame(width: 18, height: 16)
                                }
                                .buttonStyle(.plain)
                                .foregroundStyle(idx + 1 < visibleStack.count ? Color.primary.opacity(0.85) : Color.secondary.opacity(0.25))
                                .disabled(idx + 1 >= visibleStack.count)
                            }
                            .padding(.horizontal, 6)
                            .padding(.vertical, 3)
                            .background(isCurrent ? Color.teal.opacity(0.22) : Color.white.opacity(0.02))
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                            .contentShape(Rectangle())
                            .onTapGesture {
                                puppet.selectedCategory = layerSlot.category
                                puppet.selectedSlot = layerSlot
                                puppet.showStageTransformBox = true
                            }
                        }
                    }
                }
                .frame(height: min(145, max(54, CGFloat(visibleStack.count) * 24 + 4)))
                .padding(4)
                .background(Color.black.opacity(0.25))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            Divider().overlay(Color.white.opacity(0.08))
        }
    }

    private func partSpriteRow(slot: PuppetPartSlot, hasImage: Bool) -> some View {
        HStack(spacing: 8) {
            if let img = puppet.partImages[slot] {
                Image(nsImage: img)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 36, height: 36)
                    .background(Color.black.opacity(0.4))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(puppet.partFileNames[slot] ?? "Default Graphic")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .lineLimit(1)
                Text(hasImage ? "Active Sprite Graphic" : "Using built-in demo graphic")
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
            }
            Spacer()

            PuppetPartReplaceMenu(puppet: puppet, slot: slot)
                .menuStyle(.borderedButton)
                .controlSize(.mini)
                .tint(.teal)

            if hasImage {
                Button(role: .destructive) {
                    puppet.removePartImage(slot: slot)
                } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 10))
                }
                .buttonStyle(.bordered)
                .controlSize(.mini)
                .tint(.red)
                .help("Clear this sprite graphic")
            }
        }
        .padding(6)
        .background(Color.white.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func partTransformSection(slot: PuppetPartSlot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("PART SCALE, ROTATION & OFFSET")
                .font(.system(size: 9.5, weight: .bold))
                .foregroundStyle(.secondary)

            HStack {
                Text("Width")
                    .font(.system(size: 10.5))
                    .frame(width: 48, alignment: .leading)
                Slider(
                    value: Binding(
                        get: { puppet.partWidthScale[slot] ?? 1.0 },
                        set: { puppet.setPartWidth($0, for: slot) }
                    ),
                    in: 0.25...3.00
                )
                .controlSize(.mini)
                ScrubbableFloatBadge(
                    value: Binding(
                        get: { puppet.partWidthScale[slot] ?? 1.0 },
                        set: { puppet.setPartWidth($0, for: slot) }
                    ),
                    range: 0.25...3.00,
                    stepPerPt: 0.006,
                    suffix: "x",
                    decimals: 2,
                    onBeginEdit: { puppet.recordUndoSnapshot() }
                )
                Button {
                    puppet.recordUndoSnapshot()
                    puppet.setPartWidth(1.0, for: slot)
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 9))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Reset width to 1.0x")
            }

            HStack {
                Text("Height")
                    .font(.system(size: 10.5))
                    .frame(width: 48, alignment: .leading)
                Slider(
                    value: Binding(
                        get: { puppet.partHeightScale[slot] ?? 1.0 },
                        set: { puppet.setPartHeight($0, for: slot) }
                    ),
                    in: 0.25...3.00
                )
                .controlSize(.mini)
                ScrubbableFloatBadge(
                    value: Binding(
                        get: { puppet.partHeightScale[slot] ?? 1.0 },
                        set: { puppet.setPartHeight($0, for: slot) }
                    ),
                    range: 0.25...3.00,
                    stepPerPt: 0.006,
                    suffix: "x",
                    decimals: 2,
                    onBeginEdit: { puppet.recordUndoSnapshot() }
                )
                Button {
                    puppet.recordUndoSnapshot()
                    puppet.setPartHeight(1.0, for: slot)
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 9))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Reset height to 1.0x")
            }

            HStack {
                Text("Rotate")
                    .font(.system(size: 10.5))
                    .frame(width: 48, alignment: .leading)
                Slider(
                    value: Binding(
                        get: { puppet.partRotationOffset[slot] ?? 0.0 },
                        set: { puppet.setPartRotationDegrees($0, for: slot) }
                    ),
                    in: -180.0...180.0
                )
                .controlSize(.mini)
                ScrubbableFloatBadge(
                    value: Binding(
                        get: { puppet.partRotationOffset[slot] ?? 0.0 },
                        set: { puppet.setPartRotationDegrees($0, for: slot) }
                    ),
                    range: -180.0...180.0,
                    stepPerPt: 0.35,
                    suffix: "°",
                    decimals: 1,
                    signed: true,
                    onBeginEdit: { puppet.recordUndoSnapshot() }
                )
                Button {
                    puppet.recordUndoSnapshot()
                    puppet.setPartRotationDegrees(0.0, for: slot)
                } label: {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 9))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
                .help("Reset rotation to 0°")
            }

            HStack(spacing: 8) {
                Button {
                    puppet.togglePartFlipH(slot)
                } label: {
                    Label("Flip H", systemImage: "arrow.left.and.right.righttriangle.left.righttriangle.right")
                        .font(.system(size: 10, weight: puppet.isPartFlippedH(slot) ? .bold : .regular))
                }
                .buttonStyle(.bordered)
                .tint(puppet.isPartFlippedH(slot) ? .teal : .gray)
                .controlSize(.mini)

                Button {
                    puppet.togglePartFlipV(slot)
                } label: {
                    Label("Flip V", systemImage: "arrow.up.and.down.righttriangle.up.righttriangle.down")
                        .font(.system(size: 10, weight: puppet.isPartFlippedV(slot) ? .bold : .regular))
                }
                .buttonStyle(.bordered)
                .tint(puppet.isPartFlippedV(slot) ? .teal : .gray)
                .controlSize(.mini)

                Spacer()

                Button("Reset Transform") {
                    puppet.resetPartTransform(for: slot)
                }
                .font(.system(size: 9.5))
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }

            // Follow IK Switches: control whether attached child limbs follow Move / Rotate
            HStack(spacing: 6) {
                Text("Follow Chain")
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundStyle(.secondary)

                Spacer()

                Toggle(isOn: $puppet.followChildrenOnMove) {
                    Label("Move IK", systemImage: puppet.followChildrenOnMove ? "link" : "link.badge.minus")
                        .font(.system(size: 9.5, weight: puppet.followChildrenOnMove ? .semibold : .regular))
                }
                .toggleStyle(.button)
                .controlSize(.mini)
                .tint(puppet.followChildrenOnMove ? .teal : .gray)
                .help("When ON, moving Torso, Pelvis, Upper Arm, Forearm, Thigh, or Shin moves attached child limbs together")

                Toggle(isOn: $puppet.followChildrenOnRotate) {
                    Label("Rotate IK", systemImage: "arrow.triangle.2.circlepath")
                        .font(.system(size: 9.5, weight: puppet.followChildrenOnRotate ? .semibold : .regular))
                }
                .toggleStyle(.button)
                .controlSize(.mini)
                .tint(puppet.followChildrenOnRotate ? .teal : .gray)
                .help("When ON, rotating a parent part swings attached child limbs; turn OFF to rotate only this part locally")
            }

            if slot == .head {
                Divider().overlay(Color.white.opacity(0.08))
                Toggle(isOn: $puppet.jawWarpEnabled) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Jaw Stretch Warp (Speech)")
                            .font(.system(size: 10.5, weight: .semibold))
                        Text("Uncheck for rigid robot, skull, or mask heads")
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                    }
                }
                .toggleStyle(.checkbox)
            }
        }
    }

    private func partPinsSection(slot: PuppetPartSlot, pins: [PuppetControlPin]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Divider().overlay(Color.white.opacity(0.08))

            DisclosureGroup {
                VStack(spacing: 4) {
                    ForEach(pins) { pin in
                        let isSelected = (puppet.selectedPinId == pin.id)
                        HStack(spacing: 6) {
                            Circle()
                                .fill(isSelected ? Color.yellow : Color.teal)
                                .frame(width: isSelected ? 8 : 6, height: isSelected ? 8 : 6)
                            Text(pin.name)
                                .font(.system(size: 10.5, weight: isSelected ? .bold : .medium))
                                .foregroundStyle(isSelected ? Color.yellow : Color.primary)
                            Spacer()
                            Text(String(format: "(%.2f, %.2f)", pin.x, pin.y))
                                .font(.system(size: 9.5, design: .monospaced))
                                .foregroundStyle(.secondary)
                            Button {
                                puppet.resetSinglePinToDefault(slot: slot, id: pin.id)
                            } label: {
                                Image(systemName: "arrow.counterclockwise")
                                    .font(.system(size: 9))
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.vertical, 2)
                        .padding(.horizontal, 4)
                        .background(isSelected ? Color.yellow.opacity(0.12) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                        .contentShape(Rectangle())
                        .onTapGesture {
                            puppet.selectedPinId = pin.id
                        }
                    }
                }
                .padding(.top, 4)
            } label: {
                HStack {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 11))
                        .foregroundStyle(Color.teal)
                    Text("Pins (\(pins.count)) — Drag on Canvas")
                        .font(.system(size: 11, weight: .semibold))
                    Spacer()
                    Button {
                        puppet.resetPinsToDefault(for: slot)
                    } label: {
                        Text("Reset Pins")
                            .font(.system(size: 10, weight: .medium))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                }
            }
        }
    }

    private func openPNGFilePicker(for slot: PuppetPartSlot) {
        let panel = NSOpenPanel()
        panel.title = "Import Graphic for \(slot.title)"
        panel.allowedContentTypes = [.png, .jpeg, .tiff, UTType(filenameExtension: "webp")].compactMap { $0 }
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            puppet.loadImage(from: url, for: slot)
        }
    }

    private var deformationSlidersCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "slider.horizontal.3")
                    .foregroundStyle(Color.teal)
                Text("Puppet Proportions & 2.5D Motion")
                    .font(.system(size: 12.5, weight: .semibold))
                Spacer()
            }

            PuppetSliderRow(label: "CHARACTER SCALE", value: $puppet.characterScale, range: 0.20...0.65)
            PuppetSliderRow(label: "HAND SCALE (ZOOM)", value: $puppet.handScale, range: 0.08...0.45)
            PuppetSliderRow(label: "ARM LENGTH (EXTEND / SHORTEN)", value: $puppet.armLengthScale, range: 0.40...1.80)
            PuppetSliderRow(label: "ARM WIDTH (SLIM / WIDE)", value: $puppet.armThicknessScale, range: 0.30...1.60)
            PuppetSliderRow(label: "LEG LENGTH (EXTEND / SHORTEN)", value: $puppet.legLengthScale, range: 0.40...1.80)
            PuppetSliderRow(label: "LEG WIDTH (SLIM / WIDE)", value: $puppet.legThicknessScale, range: 0.30...1.60)
            PuppetSliderRow(label: "EYE SPRITE SCALE", value: $puppet.eyeSpriteScale, range: 0.50...1.80)
            PuppetSliderRow(label: "NOSE SPRITE SCALE", value: $puppet.noseSpriteScale, range: 0.50...1.80)
            PuppetSliderRow(label: "MOUTH SPRITE SCALE", value: $puppet.mouthSpriteScale, range: 0.50...1.80)
            PuppetSliderRow(label: "HEAD POSITION FOLLOW", value: $puppet.headMoveAmount, range: 0...2.5)
            PuppetSliderRow(label: "HEAD TILT (ROLL)", value: $puppet.headTiltAmount, range: 0...2.0)
            PuppetSliderRow(label: "2.5D HEAD TURN PARALLAX", value: $puppet.headTurnParallax, range: 0...2.5)
            PuppetSliderRow(label: "2.5D BODY & TAIL TURN", value: $puppet.bodyTurnAmount, range: 0...2.0)
            PuppetSliderRow(label: "JAW OPEN STRETCH", value: $puppet.jawWarpAmount, range: 0...2.5)
            PuppetSliderRow(label: "EYEBROW / EAR LIFT", value: $puppet.browWarpAmount, range: 0...2.5)
            PuppetSliderRow(label: "HUMAN ANATOMY CONSTRAINTS", value: $puppet.humanAnatomyConstraints, range: 0.0...1.0)

            Toggle("Dynamic Palm Flip (Auto-Detect)", isOn: $puppet.dynamicPalmFlip)
                .font(.system(size: 11))
                .toggleStyle(.checkbox)
                .help("When checked, palm orientation flips dynamically from camera 3D palm normal. When unchecked, orientation stays strictly locked to your Flip H button.")

            VStack(alignment: .leading, spacing: 4) {
                Text("STAGE BACKGROUND")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                Picker("", selection: $puppet.stageBackground) {
                    ForEach(PuppetStageBackground.allCases) { bg in
                        Text(bg.label).tag(bg)
                    }
                }
                .labelsHidden()
            }
        }
        .padding(13)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct ScrubbableFloatBadge: View {
    @Binding var value: Double
    let range: ClosedRange<Double>
    let stepPerPt: Double
    let suffix: String
    let decimals: Int
    var signed: Bool = false
    var onBeginEdit: () -> Void = {}

    @State private var isEditingText: Bool = false
    @State private var draftText: String = ""
    @State private var dragStartValue: Double? = nil
    @FocusState private var fieldFocused: Bool

    var body: some View {
        Group {
            if isEditingText {
                TextField("", text: $draftText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 10, design: .monospaced))
                    .multilineTextAlignment(.trailing)
                    .frame(width: 48)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(Color.black.opacity(0.45))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .overlay(RoundedRectangle(cornerRadius: 4).stroke(Color.teal, lineWidth: 1))
                    .focused($fieldFocused)
                    .onSubmit { commitDraft() }
                    .onExitCommand { isEditingText = false }
                    .onChange(of: fieldFocused) { _, focused in
                        if !focused && isEditingText { commitDraft() }
                    }
            } else {
                Text(formattedText)
                    .font(.system(size: 10, design: .monospaced))
                    .frame(width: 48, alignment: .trailing)
                    .padding(.horizontal, 3)
                    .padding(.vertical, 2)
                    .background(Color.white.opacity(0.05))
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .contentShape(Rectangle())
                    .onTapGesture {
                        draftText = String(format: "%.\(decimals)f", value)
                        isEditingText = true
                        DispatchQueue.main.async { fieldFocused = true }
                    }
                    .gesture(
                        DragGesture(minimumDistance: 2)
                            .onChanged { drag in
                                if dragStartValue == nil {
                                    onBeginEdit()
                                    dragStartValue = value
                                }
                                let base = dragStartValue ?? value
                                let next = base + Double(drag.translation.width) * stepPerPt
                                value = min(range.upperBound, max(range.lowerBound, next))
                            }
                            .onEnded { _ in
                                dragStartValue = nil
                            }
                    )
                    .help("Drag left/right to scrub, or click to type exact value")
            }
        }
    }

    private var formattedText: String {
        if signed {
            return String(format: "%+.\(decimals)f%@", value, suffix)
        } else {
            return String(format: "%.\(decimals)f%@", value, suffix)
        }
    }

    private func commitDraft() {
        let cleaned = draftText
            .replacingOccurrences(of: suffix, with: "")
            .replacingOccurrences(of: ",", with: ".")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let parsed = Double(cleaned) {
            onBeginEdit()
            value = min(range.upperBound, max(range.lowerBound, parsed))
        }
        isEditingText = false
    }
}

// MARK: - Interactive Pin Placement Canvas (Drag & Drop PNG + Double-Click Pin Reset + Undo Support)

public struct PuppetPinEditorCanvas: View {
    @ObservedObject public var puppet: PuppetController
    public let slot: PuppetPartSlot
    @State private var activePinId: String? = nil
    @State private var selectedPinId: String? = nil
    @State private var didRecordDragUndo: Bool = false
    @State private var didRecordNudgeUndo: Bool = false
    @State private var isDropTargeted: Bool = false
    @State private var editorZoom: CGFloat = 1.0
    @State private var editorPan: CGSize = .zero
    @GestureState private var editorPanDrag: CGSize = .zero
    @State private var showPinTags: Bool = true
    @State private var keyMonitor: Any? = nil

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            canvasHeader

            GeometryReader { geo in
                editorCanvasContent(size: geo.size)
            }
            .frame(minHeight: 380)

            pinSelectionStatusBar
        }
        .padding(12)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
        .onChange(of: slot) {
            editorZoom = 1.0
            editorPan = .zero
            didRecordNudgeUndo = false
            let pins = puppet.pinsBySlot[slot] ?? []
            if let curId = selectedPinId ?? puppet.selectedPinId, pins.contains(where: { $0.id == curId }) {
                selectedPinId = curId
            } else {
                selectedPinId = pins.first?.id
            }
        }
        .onChange(of: selectedPinId) {
            didRecordNudgeUndo = false
        }
        .onChange(of: puppet.selectedPinId) {
            didRecordNudgeUndo = false
            if let pid = puppet.selectedPinId, (puppet.pinsBySlot[slot] ?? []).contains(where: { $0.id == pid }) {
                selectedPinId = pid
            }
        }
        .onAppear {
            if selectedPinId == nil {
                selectedPinId = puppet.selectedPinId ?? puppet.pinsBySlot[slot]?.first?.id
            }
            keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
                guard (NSApp.keyWindow?.sheets.isEmpty ?? true), NSApp.modalWindow == nil else {
                    return event
                }
                if NSApp.keyWindow?.firstResponder is NSTextView {
                    return event
                }
                let code = event.keyCode
                let dx: CGFloat
                let dy: CGFloat
                switch code {
                case 123: dx = -1; dy = 0 // Left
                case 124: dx = 1; dy = 0  // Right
                case 125: dx = 0; dy = 1  // Down
                case 126: dx = 0; dy = -1 // Up
                default:
                    return event
                }
                guard let pins = puppet.pinsBySlot[slot], !pins.isEmpty else { return event }
                let targetId = selectedPinId ?? puppet.selectedPinId
                guard let pin = pins.first(where: { $0.id == targetId }) else { return event }

                let mods = event.modifierFlags
                let step: CGFloat = mods.contains(.shift) ? 0.012 : (mods.contains(.option) ? 0.0008 : 0.0025)
                if !didRecordNudgeUndo {
                    puppet.recordUndoSnapshot()
                    didRecordNudgeUndo = true
                }
                selectedPinId = pin.id
                puppet.selectedPinId = pin.id
                puppet.updatePin(slot: slot, id: pin.id, to: CGPoint(x: pin.x + dx * step, y: pin.y + dy * step))
                return nil
            }
        }
        .onDisappear {
            if let monitor = keyMonitor {
                NSEvent.removeMonitor(monitor)
                keyMonitor = nil
            }
        }
    }

    private var canvasHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Rigging Editor: \(slot.title)")
                        .font(.system(size: 12.5, weight: .semibold))
                    Text("Click a pin to select (yellow), drag pins or nudge with Arrow keys, double-click to reset")
                        .font(.system(size: 10.5))
                        .foregroundStyle(.secondary)
                }
                Spacer()

                PuppetPartReplaceMenu(puppet: puppet, slot: slot, title: "Replace…", font: .system(size: 11, weight: .semibold))
                    .menuStyle(.borderedButton)
                    .tint(.teal)
                    .controlSize(.small)
                    .fixedSize()

                if puppet.partImages[slot] != nil {
                    Button(role: .destructive) {
                        puppet.removePartImage(slot: slot)
                    } label: {
                        Image(systemName: "trash")
                            .font(.system(size: 11))
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)
                    .controlSize(.small)
                    .help("Clear this part sprite")
                }
            }

            HStack(spacing: 6) {
                HStack(spacing: 3) {
                    Button {
                        withAnimation(.easeInOut(duration: 0.12)) {
                            editorZoom = max(1.0, editorZoom - 0.5)
                            if editorZoom <= 1.01 { editorPan = .zero }
                        }
                    } label: {
                        Image(systemName: "minus.magnifyingglass")
                            .font(.system(size: 10))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .disabled(editorZoom <= 1.01)
                    .help("Zoom Out Rigging View")

                    Button {
                        withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) {
                            editorZoom = 1.0
                            editorPan = .zero
                        }
                    } label: {
                        Text(String(format: "%.0f%%", editorZoom * 100))
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .help("Reset Rigging Zoom & Pan to 100%")

                    Button {
                        withAnimation(.easeInOut(duration: 0.12)) {
                            editorZoom = min(4.5, editorZoom + 0.5)
                        }
                    } label: {
                        Image(systemName: "plus.magnifyingglass")
                            .font(.system(size: 10))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .help("Zoom In Rigging View (up to 450% for eyes/nose/mouth)")
                }

                Toggle(isOn: $showPinTags) {
                    Label(showPinTags ? "Tags On" : "Tags Hidden", systemImage: showPinTags ? "tag.fill" : "tag.slash")
                        .font(.system(size: 10, weight: showPinTags ? .regular : .semibold))
                }
                .toggleStyle(.button)
                .tint(showPinTags ? .secondary : .yellow)
                .controlSize(.mini)
                .help("Temporarily hide/show floating pin name tags so dense pins (eyes, nose, mouth) stay clear")

                Spacer()

                if editorZoom > 1.05 {
                    Text("Drag canvas to pan")
                        .font(.system(size: 9.5))
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func effectiveDrawRect(imageSize: CGSize, in size: CGSize) -> CGRect {
        let baseRect = computeAspectFitRect(imageSize: imageSize, in: size)
        let zoomedW = baseRect.width * editorZoom
        let zoomedH = baseRect.height * editorZoom
        let cx = size.width * 0.5 + editorPan.width + editorPanDrag.width
        let cy = size.height * 0.5 + editorPan.height + editorPanDrag.height
        return CGRect(x: cx - zoomedW * 0.5, y: cy - zoomedH * 0.5, width: zoomedW, height: zoomedH)
    }

    @ViewBuilder
    private func editorCanvasContent(size: CGSize) -> some View {
        let img = puppet.partImages[slot]
        let drawRect = effectiveDrawRect(imageSize: img?.size ?? CGSize(width: 1, height: 1), in: size)
        let pins = puppet.pinsBySlot[slot] ?? []

        ZStack {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color(red: 0.06, green: 0.07, blue: 0.09))
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 2)
                        .updating($editorPanDrag) { val, state, _ in
                            if editorZoom > 1.01 {
                                state = val.translation
                            }
                        }
                        .onEnded { val in
                            if editorZoom > 1.01 {
                                let maxPanX = max(40.0, size.width * (editorZoom - 0.5) * 0.55)
                                let maxPanY = max(40.0, size.height * (editorZoom - 0.5) * 0.55)
                                editorPan = CGSize(
                                    width: max(-maxPanX, min(maxPanX, editorPan.width + val.translation.width)),
                                    height: max(-maxPanY, min(maxPanY, editorPan.height + val.translation.height))
                                )
                            }
                        }
                )
                .onTapGesture(count: 2) {
                    withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) {
                        editorZoom = 1.0
                        editorPan = .zero
                    }
                }

            if let nsImg = img {
                Image(nsImage: nsImg)
                    .resizable()
                    .frame(width: drawRect.width, height: drawRect.height)
                    .position(x: drawRect.midX, y: drawRect.midY)
                    .allowsHitTesting(false)

                rigGuideOverlay(drawRect: drawRect, pins: pins)

                // Direct On-Canvas Width & Rotation handles (shown when unzoomed so they stay clean on canvas)
                if editorZoom <= 1.05 {
                    widthHandleView(drawRect: drawRect)
                    rotationHandleView(drawRect: drawRect)
                }

                ForEach(pins) { pin in
                    pinHandleView(pin: pin, drawRect: drawRect)
                }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "photo.badge.plus")
                        .font(.system(size: 32))
                        .foregroundStyle(.secondary)
                    Text("Drop a transparent PNG here for \(slot.title)")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .allowsHitTesting(false)
            }
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(isDropTargeted ? Color.teal : Color.white.opacity(0.1), lineWidth: isDropTargeted ? 2.5 : 1)
        )
        .onDrop(of: [.fileURL], isTargeted: $isDropTargeted) { providers in
            guard let first = providers.first else { return false }
            _ = first.loadObject(ofClass: URL.self) { url, _ in
                if let url {
                    puppet.loadImage(from: url, for: slot)
                }
            }
            return true
        }
    }

    @ViewBuilder
    private var pinSelectionStatusBar: some View {
        let pins = puppet.pinsBySlot[slot] ?? []
        let targetId = selectedPinId ?? puppet.selectedPinId
        let activePin = pins.first(where: { $0.id == targetId }) ?? pins.first
        if !pins.isEmpty {
            HStack(spacing: 6) {
                Button {
                    cycleSelectedPin(delta: -1, in: pins)
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 9, weight: .bold))
                }
                .buttonStyle(.bordered)
                .controlSize(.mini)
                .help("Select previous pin")

                if let pin = activePin {
                    Text(String(format: "%@ (%.0f%%, %.0f%%)", pin.name, pin.x * 100, pin.y * 100))
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.yellow)
                        .lineLimit(1)
                }

                Button {
                    cycleSelectedPin(delta: 1, in: pins)
                } label: {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                }
                .buttonStyle(.bordered)
                .controlSize(.mini)
                .help("Select next pin")

                Spacer()

                Text("Arrows nudge • ⇧ 5× • ⌥ fine")
                    .font(.system(size: 9.5))
                    .foregroundStyle(.secondary)

                if let pin = activePin {
                    Button("Reset Pin") {
                        puppet.resetSinglePinToDefault(slot: slot, id: pin.id)
                    }
                    .font(.system(size: 9.5))
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                }
            }
        }
    }

    private func cycleSelectedPin(delta: Int, in pins: [PuppetControlPin]) {
        guard !pins.isEmpty else { return }
        let curId = selectedPinId ?? puppet.selectedPinId
        let idx = pins.firstIndex(where: { $0.id == curId }) ?? 0
        let next = pins[(idx + delta + pins.count) % pins.count]
        selectedPinId = next.id
        puppet.selectedPinId = next.id
    }

    private func widthHandleView(drawRect: CGRect) -> some View {
        let hx = drawRect.maxX + 4
        let hy = drawRect.midY
        return HStack(spacing: 2) {
            Image(systemName: "arrow.left.and.right")
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(.black)
        }
        .padding(5)
        .background(Color.yellow)
        .clipShape(Circle())
        .shadow(color: .black.opacity(0.5), radius: 4)
        .position(x: hx, y: hy)
        .gesture(
            DragGesture()
                .onChanged { value in
                    let baseW = max(10, drawRect.width)
                    let deltaScale = (value.translation.width / baseW) * 1.5
                    let current = puppet.partWidth(for: slot)
                    puppet.setPartWidth(max(0.3, min(2.5, current + deltaScale)), for: slot)
                }
        )
        .help("Drag horizontally to scale part width directly")
    }

    private func rotationHandleView(drawRect: CGRect) -> some View {
        let rx = drawRect.midX
        let ry = drawRect.minY - 16
        return HStack(spacing: 3) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(.black)
            Text(String(format: "%+.0f°", puppet.partRotationDegrees(for: slot)))
                .font(.system(size: 8.5, weight: .bold, design: .monospaced))
                .foregroundStyle(.black)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(Color.yellow)
        .clipShape(Capsule())
        .shadow(color: .black.opacity(0.5), radius: 4)
        .position(x: rx, y: ry)
        .onTapGesture(count: 2) {
            puppet.setPartRotationDegrees(0.0, for: slot)
        }
        .gesture(
            DragGesture()
                .onChanged { value in
                    let angle = atan2(value.location.y - drawRect.midY, value.location.x - drawRect.midX) * 180.0 / .pi + 90.0
                    puppet.setPartRotationDegrees(angle, for: slot)
                }
        )
        .help("Drag around center to rotate directly, double-click to reset to 0°")
    }

    private func rigGuideOverlay(drawRect: CGRect, pins: [PuppetControlPin]) -> some View {
        Canvas { ctx, _ in
            func pt(_ id: String) -> CGPoint? {
                guard let p = pins.first(where: { $0.id == id }) else { return nil }
                return CGPoint(
                    x: drawRect.minX + p.x * drawRect.width,
                    y: drawRect.minY + p.y * drawRect.height
                )
            }
            var guide = Path()
            if let lb = pt("leftBrow"), let rb = pt("rightBrow") {
                guide.move(to: lb); guide.addLine(to: rb)
            }
            if let le = pt("leftEye"), let re = pt("rightEye") {
                guide.move(to: le); guide.addLine(to: re)
            }
            if let nose = pt("noseCenter"), let mouth = pt("mouthCenter"), let jaw = pt("jawChin") {
                guide.move(to: nose); guide.addLine(to: mouth); guide.addLine(to: jaw)
            }
            if let nm = pt("neckMount"), let wp = pt("waistPivot") {
                guide.move(to: nm); guide.addLine(to: wp)
            }
            if let ls = pt("leftShoulder"), let rs = pt("rightShoulder") {
                guide.move(to: ls); guide.addLine(to: rs)
            }
            if let wj = pt("waistJoint"), let lh = pt("leftHip"), let rh = pt("rightHip") {
                guide.move(to: lh); guide.addLine(to: wj); guide.addLine(to: rh)
            }
            if pins.count == 2 {
                let p0 = CGPoint(x: drawRect.minX + pins[0].x * drawRect.width, y: drawRect.minY + pins[0].y * drawRect.height)
                let p1 = CGPoint(x: drawRect.minX + pins[1].x * drawRect.width, y: drawRect.minY + pins[1].y * drawRect.height)
                guide.move(to: p0); guide.addLine(to: p1)
            }
            ctx.stroke(
                guide,
                with: .color(Color.teal.opacity(0.55)),
                style: StrokeStyle(lineWidth: 1.5, dash: [4, 4])
            )
        }
        .allowsHitTesting(false)
    }

    private func pinHandleView(pin: PuppetControlPin, drawRect: CGRect) -> some View {
        let px = drawRect.minX + pin.x * drawRect.width
        let py = drawRect.minY + pin.y * drawRect.height
        let isSelected = (puppet.selectedPinId == pin.id || selectedPinId == pin.id || activePinId == pin.id)
        let activeColor: Color = isSelected ? .yellow : .teal

        return ZStack {
            if isSelected {
                Circle()
                    .stroke(Color.yellow.opacity(0.85), lineWidth: 3)
                    .frame(width: 22, height: 22)
            }
            Circle()
                .fill(activeColor)
                .frame(width: 14, height: 14)
            Circle()
                .stroke(Color.black, lineWidth: 2)
                .frame(width: 14, height: 14)
        }
        .frame(width: 24, height: 24)
        .contentShape(Circle())
        .overlay(alignment: .top) {
            if showPinTags {
                Text(pin.name)
                    .font(.system(size: 9, weight: .bold))
                    .fixedSize()
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(Color.black.opacity(0.82))
                    .foregroundStyle(activeColor)
                    .clipShape(Capsule())
                    .offset(y: -20)
                    .allowsHitTesting(false)
            }
        }
        .position(x: px, y: py)
        .zIndex(isSelected ? 10 : 1)
        .onTapGesture(count: 2) {
            puppet.resetSinglePinToDefault(slot: slot, id: pin.id)
        }
        .simultaneousGesture(
            TapGesture().onEnded {
                selectedPinId = pin.id
                puppet.selectedPinId = pin.id
            }
        )
        .gesture(
            DragGesture(minimumDistance: 1)
                .onChanged { value in
                    if !didRecordDragUndo {
                        puppet.recordUndoSnapshot()
                        didRecordDragUndo = true
                    }
                    selectedPinId = pin.id
                    puppet.selectedPinId = pin.id
                    activePinId = pin.id
                    let nx = (value.location.x - drawRect.minX) / max(1, drawRect.width)
                    let ny = (value.location.y - drawRect.minY) / max(1, drawRect.height)
                    puppet.updatePin(slot: slot, id: pin.id, to: CGPoint(x: nx, y: ny))
                }
                .onEnded { _ in
                    activePinId = nil
                    didRecordDragUndo = false
                }
        )
    }

    private func computeAspectFitRect(imageSize: CGSize, in containerSize: CGSize) -> CGRect {
        let pad: CGFloat = 20
        let availW = max(1, containerSize.width - pad * 2)
        let availH = max(1, containerSize.height - pad * 2)
        let imgAspect = max(0.1, imageSize.width / max(1, imageSize.height))
        let boxAspect = availW / availH

        let w: CGFloat
        let h: CGFloat
        if boxAspect > imgAspect {
            h = availH
            w = h * imgAspect
        } else {
            w = availW
            h = w / imgAspect
        }
        return CGRect(
            x: (containerSize.width - w) * 0.5,
            y: (containerSize.height - h) * 0.5,
            width: w,
            height: h
        )
    }

    private func chooseImageFile() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .tiff, .webP]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "Choose a transparent PNG image for \(slot.title)"
        if panel.runModal() == .OK, let url = panel.url {
            puppet.loadImage(from: url, for: slot)
        }
    }
}

// MARK: - Helper Subviews

private struct GuideStepBox: View {
    let number: String
    let title: String
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Text(number)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .frame(width: 18, height: 18)
                    .background(Color.teal)
                    .foregroundStyle(.black)
                    .clipShape(Circle())
                Text(title)
                    .font(.system(size: 11.5, weight: .semibold))
            }
            Text(text)
                .font(.system(size: 10.5))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Color.black.opacity(0.28))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

public struct ExpressionBarRow: View {
    public let label: String
    public let value: Double
    public let color: Color

    public init(label: String, value: Double, color: Color) {
        self.label = label
        self.value = value
        self.color = color
    }

    public var body: some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.system(size: 10.5))
                .frame(width: 115, alignment: .leading)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.white.opacity(0.08))
                    Capsule()
                        .fill(color)
                        .frame(width: max(0, min(1, CGFloat(value))) * geo.size.width)
                }
            }
            .frame(height: 7)
            Text(String(format: "%3.0f%%", max(0, min(1, value)) * 100))
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(.secondary)
                .frame(width: 34, alignment: .trailing)
        }
    }
}

private struct PuppetSliderRow: View {
    let label: String
    @Binding var value: Double
    let range: ClosedRange<Double>

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(label)
                    .font(.system(size: 9.5, weight: .semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text(String(format: "%.2f", value))
                    .font(.system(size: 10.5, design: .monospaced))
            }
            Slider(value: $value, in: range)
                .tint(.teal)
                .controlSize(.small)
        }
    }
}

// MARK: - Paper Puppet Cut-Out Sheet Importer & Designer / AI Guide Modal

private enum SheetPreviewBackground: String, CaseIterable, Identifiable {
    case checkerboard = "Grid"
    case dark = "Dark"
    case green = "Green"
    case blue = "Blue"
    case white = "White"
    var id: String { rawValue }
}

private struct CheckerboardView: View {
    let squareSize: CGFloat = 12

    var body: some View {
        Canvas { ctx, size in
            let cols = Int(ceil(size.width / squareSize))
            let rows = Int(ceil(size.height / squareSize))
            let light = Color(white: 0.22)
            let dark = Color(white: 0.15)
            for r in 0..<rows {
                for c in 0..<cols {
                    let rect = CGRect(
                        x: CGFloat(c) * squareSize,
                        y: CGFloat(r) * squareSize,
                        width: squareSize,
                        height: squareSize
                    )
                    ctx.fill(Path(rect), with: .color((r + c) % 2 == 0 ? light : dark))
                }
            }
        }
    }
}

private struct PuppetSheetImporterModal: View {
    @ObservedObject var puppet: PuppetController
    @Environment(\.dismiss) private var dismiss

    @State private var rawSheetImage: NSImage? = nil
    @State private var processedSheetImage: NSImage? = nil
    @State private var islands: [PuppetSheetIsland] = []
    @State private var targetSlot: PuppetPartSlot = .leftUpperArm
    @State private var targetCategoryFilter: PuppetPartCategory? = nil
    @State private var removeSolidBg: Bool = true
    @State private var bgTolerance: Double = 0.14
    @State private var statusMessage: String = "Click any highlighted body part to assign it to the target slot."
    @State private var copiedPrompt: Bool = false
    @State private var mappedIslandSlots: [Int: String] = [:]

    // Zoom, Pan, Preview Background & Marquee Crop controls
    @State private var previewBg: SheetPreviewBackground = .checkerboard
    @State private var sheetZoom: CGFloat = 1.0
    @State private var sheetPan: CGSize = .zero
    @GestureState private var sheetDrag: CGSize = .zero
    @State private var showOutlines: Bool = true
    @State private var showBadges: Bool = false
    @State private var selectedIslandId: Int? = nil
    @State private var isCropToolActive: Bool = false
    @State private var cropBoxStart: CGPoint? = nil
    @State private var cropBoxCurrent: CGPoint? = nil
    @State private var isAIPromptExpanded: Bool = false
    @State private var localKeyMonitor: Any? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            modalHeader

            HStack(alignment: .top, spacing: 16) {
                sheetInteractiveCanvas
                rightSidebarControls
            }
        }
        .padding(18)
        .frame(width: 1040, height: 720)
        .background(Color(red: 0.08, green: 0.09, blue: 0.12))
        .onAppear {
            targetSlot = puppet.selectedSlot
            let sample = PuppetSheetSlicer.makeExamplePuppetSheet(from: puppet)
            loadAndSlice(image: sample)

            // Local AppKit event monitor: handles Tab, Left/Right arrow, +, -, 0, Delete without alert beep!
            localKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
                let code = event.keyCode
                let chars = event.charactersIgnoringModifiers ?? ""

                if code == 51 || code == 117 { // Delete / Backspace
                    if let selId = selectedIslandId {
                        islands.removeAll(where: { $0.id == selId })
                        selectedIslandId = nil
                        statusMessage = "Deleted part #\(selId)."
                        return nil
                    }
                }
                if code == 48 { // Tab
                    showOutlines.toggle()
                    return nil
                }
                if code == 123 { // Left arrow
                    stepTargetSlot(delta: -1)
                    return nil
                }
                if code == 124 { // Right arrow
                    stepTargetSlot(delta: 1)
                    return nil
                }
                if code == 24 || chars == "+" || chars == "=" {
                    withAnimation(.easeInOut(duration: 0.12)) {
                        sheetZoom = min(4.0, sheetZoom + 0.25)
                    }
                    return nil
                }
                if code == 27 || chars == "-" || chars == "_" {
                    withAnimation(.easeInOut(duration: 0.12)) {
                        sheetZoom = max(0.5, sheetZoom - 0.25)
                    }
                    return nil
                }
                if code == 29 || chars == "0" {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                        sheetZoom = 1.0
                        sheetPan = .zero
                    }
                    return nil
                }
                return event
            }
        }
        .onDisappear {
            if let m = localKeyMonitor {
                NSEvent.removeMonitor(m)
                localKeyMonitor = nil
            }
        }
    }

    private var modalHeader: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Image(systemName: "scissors")
                        .foregroundStyle(Color.teal)
                        .font(.system(size: 16, weight: .bold))
                    Text("Paper Puppet Sheet")
                        .font(.system(size: 15, weight: .bold))
                }
                Text("Click a piece on the sheet to assign it to the target slot, or use 'Crop Box' to manually drag-select any piece.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            Spacer()

            HStack(spacing: 6) {
                Text("Character:")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.secondary)
                TextField("Name", text: $puppet.characterName)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 120)
                    .controlSize(.small)
            }

            Button("Done") {
                dismiss()
            }
            .buttonStyle(.borderedProminent)
            .tint(.teal)
            .controlSize(.small)
        }
    }

    private var sheetInteractiveCanvas: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Row 1: Sheet Actions (Load, Export, Auto-Map, Crop Box, Delete)
            HStack(spacing: 8) {
                Button {
                    openSheetFilePanel()
                } label: {
                    Label("Load Sheet…", systemImage: "photo.badge.plus")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(.teal)
                .controlSize(.small)

                Button {
                    exportAllPartsAsPNGs()
                } label: {
                    Label("Export PNGs…", systemImage: "folder.badge.plus")
                        .font(.system(size: 11))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(islands.isEmpty)
                .help("Save all cut-out pieces as separate transparent PNG files into a folder")

                Button {
                    autoMapDetectedIslands()
                } label: {
                    Label("Auto-Map", systemImage: "wand.and.stars")
                        .font(.system(size: 11, weight: .semibold))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(islands.isEmpty)
                .help("Automatically maps detected cut-out pieces to Head, Torso, Arms and Legs")

                Toggle(isOn: $isCropToolActive) {
                    Label("Crop Box", systemImage: "crop")
                        .font(.system(size: 11, weight: isCropToolActive ? .bold : .regular))
                }
                .toggleStyle(.button)
                .tint(.yellow)
                .controlSize(.small)
                .help("Drag a marquee box anywhere on the sheet to crop a custom piece directly")

                if let selId = selectedIslandId {
                    Button(role: .destructive) {
                        islands.removeAll(where: { $0.id == selId })
                        selectedIslandId = nil
                        statusMessage = "Deleted part #\(selId)."
                    } label: {
                        Label("Delete #\(selId)", systemImage: "trash")
                            .font(.system(size: 11))
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)
                    .controlSize(.small)
                    .help("Delete selected piece (or press Backspace)")
                }

                Spacer()
            }

            // Row 2: Preview BG, Zoom & BG Removal Slider (Never clips!)
            HStack(spacing: 8) {
                // Preview Background switcher (Grid, Dark, Green, Blue, White)
                Picker("", selection: $previewBg) {
                    ForEach(SheetPreviewBackground.allCases) { bg in
                        Text(bg.rawValue).tag(bg)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 220)
                .controlSize(.mini)
                .help("Preview Stage Background: Grid, Dark, Chroma Green, Chroma Blue, White")

                // Zoom controls
                HStack(spacing: 3) {
                    Button {
                        withAnimation(.easeInOut(duration: 0.12)) {
                            sheetZoom = max(0.5, sheetZoom - 0.25)
                        }
                    } label: {
                        Image(systemName: "minus.magnifyingglass")
                            .font(.system(size: 10))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .help("Zoom Out (⌘-)")

                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                            sheetZoom = 1.0
                            sheetPan = .zero
                        }
                    } label: {
                        Text(String(format: "%.0f%%", sheetZoom * 100))
                            .font(.system(size: 10, design: .monospaced))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .help("Reset Zoom to 100% (⌘0 or double-click)")

                    Button {
                        withAnimation(.easeInOut(duration: 0.12)) {
                            sheetZoom = min(4.0, sheetZoom + 0.25)
                        }
                    } label: {
                        Image(systemName: "plus.magnifyingglass")
                            .font(.system(size: 10))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.mini)
                    .help("Zoom In (⌘+)")

                    Toggle(isOn: $showOutlines) {
                        Text("Lines [Tab]")
                            .font(.system(size: 10))
                    }
                    .toggleStyle(.button)
                    .controlSize(.mini)
                    .help("Toggle selection borders on/off (Tab key)")
                }

                Spacer()

                HStack(spacing: 4) {
                    Toggle("Remove BG", isOn: $removeSolidBg)
                        .font(.system(size: 10.5))
                        .toggleStyle(.checkbox)
                        .onChange(of: removeSolidBg) {
                            if let raw = rawSheetImage { loadAndSlice(image: raw) }
                        }

                    if removeSolidBg {
                        Slider(value: $bgTolerance, in: 0.02...0.50, step: 0.01)
                            .frame(width: 65)
                            .controlSize(.mini)
                            .onChange(of: bgTolerance) {
                                if let raw = rawSheetImage { loadAndSlice(image: raw) }
                            }
                        Text("\(Int(bgTolerance * 100))%")
                            .font(.system(size: 9.5, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .fixedSize()
                    }
                }
            }

            GeometryReader { geo in
                ZStack {
                    // Stationary background (Grid, Dark, Green, Blue, White)
                    Group {
                        switch previewBg {
                        case .checkerboard:
                            CheckerboardView()
                        case .dark:
                            Color(red: 0.07, green: 0.08, blue: 0.10)
                        case .green:
                            Color(red: 0.0, green: 0.90, blue: 0.15)
                        case .blue:
                            Color(red: 0.05, green: 0.30, blue: 0.95)
                        case .white:
                            Color.white
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                    // Pannable & Zoomable Image + Islands
                    ZStack {
                        if let sheet = processedSheetImage {
                            let drawRect = aspectFitRect(imageSize: sheet.size, in: geo.size)
                            Image(nsImage: sheet)
                                .resizable()
                                .interpolation(.high)
                                .frame(width: drawRect.width, height: drawRect.height)
                                .position(x: drawRect.midX, y: drawRect.midY)

                            if showOutlines {
                                ForEach(islands) { island in
                                    islandOverlayButton(island: island, drawRect: drawRect)
                                }
                            }
                        }
                    }
                    .scaleEffect(sheetZoom)
                    .offset(x: sheetPan.width + sheetDrag.width, y: sheetPan.height + sheetDrag.height)

                    // Active Crop Marquee Box in screen coordinates (drawn on outer level without double zoom/offset!)
                    if isCropToolActive, let start = cropBoxStart, let current = cropBoxCurrent {
                        let rect = CGRect(
                            x: min(start.x, current.x),
                            y: min(start.y, current.y),
                            width: abs(current.x - start.x),
                            height: abs(current.y - start.y)
                        )
                        Rectangle()
                            .stroke(Color.yellow, style: StrokeStyle(lineWidth: 1.5, dash: [4, 4]))
                            .background(Color.yellow.opacity(0.12))
                            .frame(width: rect.width, height: rect.height)
                            .position(x: rect.midX, y: rect.midY)
                    }
                }
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 2)
                        .updating($sheetDrag) { value, state, _ in
                            if !isCropToolActive {
                                state = value.translation
                            }
                        }
                        .onChanged { val in
                            if isCropToolActive {
                                if cropBoxStart == nil { cropBoxStart = val.startLocation }
                                cropBoxCurrent = val.location
                            }
                        }
                        .onEnded { val in
                            if isCropToolActive {
                                commitCustomCropBox(start: cropBoxStart ?? val.startLocation, end: val.location, in: geo.size)
                                cropBoxStart = nil
                                cropBoxCurrent = nil
                            } else {
                                sheetPan.width += val.translation.width
                                sheetPan.height += val.translation.height
                            }
                        }
                )
                .onTapGesture(count: 2) {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                        sheetZoom = 1.0
                        sheetPan = .zero
                    }
                }
            }
            .clipped()
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            )

            HStack(spacing: 6) {
                Image(systemName: "info.circle.fill")
                    .foregroundStyle(Color.teal)
                Text(statusMessage)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color.teal)
                Spacer()
                Text("\(islands.count) parts detected")
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func commitCustomCropBox(start: CGPoint, end: CGPoint, in containerSize: CGSize) {
        guard let sheet = processedSheetImage else { return }
        let drawRect = aspectFitRect(imageSize: sheet.size, in: containerSize)

        let unzoomedStartX = (start.x - containerSize.width * 0.5 - sheetPan.width) / sheetZoom + containerSize.width * 0.5
        let unzoomedStartY = (start.y - containerSize.height * 0.5 - sheetPan.height) / sheetZoom + containerSize.height * 0.5

        let unzoomedEndX = (end.x - containerSize.width * 0.5 - sheetPan.width) / sheetZoom + containerSize.width * 0.5
        let unzoomedEndY = (end.y - containerSize.height * 0.5 - sheetPan.height) / sheetZoom + containerSize.height * 0.5

        let minX = min(unzoomedStartX, unzoomedEndX)
        let maxX = max(unzoomedStartX, unzoomedEndX)
        let minY = min(unzoomedStartY, unzoomedEndY)
        let maxY = max(unzoomedStartY, unzoomedEndY)

        let boxW = maxX - minX
        let boxH = maxY - minY
        guard boxW > 8 && boxH > 8 else { return }

        let normX = max(0.0, min(1.0, (minX - drawRect.minX) / max(1, drawRect.width)))
        let normY = max(0.0, min(1.0, (minY - drawRect.minY) / max(1, drawRect.height)))
        let normW = min(1.0 - normX, boxW / max(1, drawRect.width))
        let normH = min(1.0 - normY, boxH / max(1, drawRect.height))
        let normRect = CGRect(x: normX, y: normY, width: normW, height: normH)

        if let customIsland = PuppetSheetSlicer.cropCustomIsland(
            from: sheet,
            normalizedRect: normRect,
            id: islands.count + 1
        ) {
            islands.append(customIsland)
            selectedIslandId = customIsland.id
            mappedIslandSlots[customIsland.id] = targetSlot.rawValue
            puppet.assignCroppedSheetPart(
                slot: targetSlot,
                image: customIsland.croppedImage,
                name: "\(puppet.characterName)_\(targetSlot.rawValue)"
            )
            let prevTitle = targetSlot.title
            stepTargetSlot(delta: 1)
            statusMessage = "Custom crop assigned to \(prevTitle)! Next target: \(targetSlot.title)"
        }
    }

    private func islandOverlayButton(island: PuppetSheetIsland, drawRect: CGRect) -> some View {
        let box = CGRect(
            x: drawRect.minX + island.normalizedRect.minX * drawRect.width,
            y: drawRect.minY + island.normalizedRect.minY * drawRect.height,
            width: island.normalizedRect.width * drawRect.width,
            height: island.normalizedRect.height * drawRect.height
        )
        let isSelected = (selectedIslandId == island.id)
        return Button {
            selectedIslandId = island.id
            mappedIslandSlots[island.id] = targetSlot.rawValue
            puppet.assignCroppedSheetPart(
                slot: targetSlot,
                image: island.croppedImage,
                name: "\(puppet.characterName)_\(targetSlot.rawValue)"
            )
            let prevTitle = targetSlot.title
            stepTargetSlot(delta: 1)
            statusMessage = "Assigned Part #\(island.id) → \(prevTitle)! Next target: \(targetSlot.title)"
        } label: {
            ZStack(alignment: .topLeading) {
                if showOutlines {
                    RoundedRectangle(cornerRadius: 3, style: .continuous)
                        .stroke(isSelected ? Color.yellow : Color.teal.opacity(0.65), lineWidth: isSelected ? 2.0 : 0.8)
                        .background(isSelected ? Color.yellow.opacity(0.12) : Color.teal.opacity(0.03))
                }
                if showBadges && box.height > 40 && box.width > 40 {
                    Text("#\(island.id)")
                        .font(.system(size: 8, weight: .bold, design: .monospaced))
                        .padding(.horizontal, 3)
                        .padding(.vertical, 1)
                        .background(isSelected ? Color.yellow : Color.teal)
                        .foregroundStyle(.black)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                        .padding(2)
                }
            }
            .frame(width: max(8, box.width), height: max(8, box.height))
        }
        .buttonStyle(.plain)
        .position(x: box.midX, y: box.midY)
        .help("Click to assign Part #\(island.id) to \(targetSlot.title)")
    }

    private var rightSidebarControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("1. TARGET PUPPET SLOT")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(.secondary)

                // Category filter chips
                HStack(spacing: 4) {
                    Button("All") {
                        targetCategoryFilter = nil
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(targetCategoryFilter == nil ? .teal : Color.white.opacity(0.12))
                    .controlSize(.mini)

                    ForEach(PuppetPartCategory.allCases) { cat in
                        Button(cat.shortLabel) {
                            targetCategoryFilter = cat
                            if targetSlot.category != cat {
                                if let firstInCat = PuppetPartSlot.allCases.first(where: { $0.category == cat }) {
                                    targetSlot = firstInCat
                                    puppet.selectedCategory = cat
                                    puppet.selectedSlot = firstInCat
                                }
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(targetCategoryFilter == cat ? .teal : Color.white.opacity(0.12))
                        .controlSize(.mini)
                    }
                }

                // Slot navigation & clean menu (just R Hand, L Hand, etc.)
                HStack(spacing: 6) {
                    Button {
                        stepTargetSlot(delta: -1)
                    } label: {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 11, weight: .bold))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .help("Previous slot (Left Arrow)")

                    Picker("", selection: $targetSlot) {
                        if let cat = targetCategoryFilter {
                            ForEach(PuppetPartSlot.allCases.filter { $0.category == cat }) { slot in
                                Text(slot.title).tag(slot)
                            }
                        } else {
                            ForEach(PuppetPartSlot.allCases) { slot in
                                Text(slot.title).tag(slot)
                            }
                        }
                    }
                    .labelsHidden()

                    Button {
                        stepTargetSlot(delta: 1)
                    } label: {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 11, weight: .bold))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .help("Next slot (Right Arrow)")
                }

                if let currentImg = puppet.partImages[targetSlot] {
                    HStack(spacing: 10) {
                        Image(nsImage: currentImg)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 44, height: 44)
                            .padding(4)
                            .background(Color.black.opacity(0.4))
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Current \(targetSlot.title)")
                                .font(.system(size: 11, weight: .semibold))
                            Text(puppet.partFileNames[targetSlot] ?? "Assigned")
                                .font(.system(size: 9.5, design: .monospaced))
                                .foregroundStyle(.secondary)
                            Button(role: .destructive) {
                                puppet.removePartImage(slot: targetSlot)
                                statusMessage = "Removed sprite from \(targetSlot.title)."
                            } label: {
                                Label("Remove Sprite", systemImage: "trash")
                                    .font(.system(size: 10))
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(.red)
                        }
                    }
                    .padding(.top, 4)
                }
            }
            .padding(12)
            .background(Color.white.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            // 2. Collapsible AI Sheet Generator Brief & Copy Prompt
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("2. AI SHEET GENERATOR")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(PuppetSheetSlicer.designerAndAIPrompt, forType: .string)
                        copiedPrompt = true
                    } label: {
                        Label(copiedPrompt ? "Copied!" : "Copy Prompt", systemImage: copiedPrompt ? "checkmark.circle.fill" : "doc.on.doc")
                            .font(.system(size: 10, weight: .semibold))
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(copiedPrompt ? .green : .teal)
                    .controlSize(.mini)
                }

                DisclosureGroup(isExpanded: $isAIPromptExpanded) {
                    ScrollView {
                        Text(PuppetSheetSlicer.designerAndAIPrompt)
                            .font(.system(size: 10, design: .monospaced))
                            .padding(6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(height: 120)
                    .background(Color.black.opacity(0.4))
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                } label: {
                    Text(isAIPromptExpanded ? "Hide Prompt Details" : "View Prompt Rules (3-Part Legs, No Text)")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(12)
            .background(Color.white.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .frame(width: 320)
    }

    private func exportAllPartsAsPNGs() {
        let panel = NSOpenPanel()
        panel.title = "Choose Destination Folder to Save Body Part PNGs"
        panel.canChooseDirectories = true
        panel.canCreateDirectories = true
        panel.canChooseFiles = false
        panel.prompt = "Save PNGs Here"
        if panel.runModal() == .OK, let dir = panel.url {
            do {
                let count = try PuppetSheetSlicer.exportIslands(
                    islands,
                    to: dir,
                    characterName: puppet.characterName,
                    mappedSlotNames: mappedIslandSlots
                )
                statusMessage = "Exported \(count) cut-out PNGs to '\(dir.lastPathComponent)'!"
            } catch {
                statusMessage = "Export error: \(error.localizedDescription)"
            }
        }
    }

    private func stepTargetSlot(delta: Int) {
        let seq = PuppetSheetSlicer.standardRiggingSlotSequence
        guard let idx = seq.firstIndex(of: targetSlot) else { return }
        let nextIdx = (idx + delta + seq.count) % seq.count
        let nextSlot = seq[nextIdx]
        targetSlot = nextSlot
        puppet.selectedCategory = nextSlot.category
        puppet.selectedSlot = nextSlot
        if let cat = targetCategoryFilter, nextSlot.category != cat {
            targetCategoryFilter = nil
        }
    }

    private func loadAndSlice(image: NSImage) {
        rawSheetImage = image
        let result = PuppetSheetSlicer.detectIslands(
            in: image,
            removeSolidBackground: removeSolidBg,
            tolerance: CGFloat(bgTolerance)
        )
        processedSheetImage = result.processedSheet
        islands = result.islands
    }

    private func autoMapDetectedIslands() {
        guard !islands.isEmpty else { return }
        puppet.recordUndoSnapshot()

        let sortedByY = islands.sorted { $0.normalizedRect.midY < $1.normalizedRect.midY }
        let sortedByArea = islands.sorted { ($0.normalizedRect.width * $0.normalizedRect.height) > ($1.normalizedRect.width * $1.normalizedRect.height) }

        // Head: center-ish, upper part of sheet
        if let headIsland = sortedByY.first(where: { $0.normalizedRect.midY < 0.42 && $0.normalizedRect.midX > 0.22 && $0.normalizedRect.midX < 0.78 }) {
            mappedIslandSlots[headIsland.id] = "head"
            puppet.assignCroppedSheetPart(slot: .head, image: headIsland.croppedImage, name: "\(puppet.characterName)_head")
        }

        // Torso: largest area in middle
        if let torsoIsland = sortedByArea.first(where: { $0.normalizedRect.midX > 0.28 && $0.normalizedRect.midX < 0.72 && $0.normalizedRect.midY > 0.20 && $0.normalizedRect.midY < 0.80 }) {
            mappedIslandSlots[torsoIsland.id] = "torso"
            puppet.assignCroppedSheetPart(slot: .torso, image: torsoIsland.croppedImage, name: "\(puppet.characterName)_torso")
        }

        // Pelvis: island below torso in central column
        let centralColumn = islands.filter { $0.normalizedRect.midX > 0.30 && $0.normalizedRect.midX < 0.70 }
        if let pelvisIsland = centralColumn.first(where: { $0.normalizedRect.midY > 0.55 }) {
            mappedIslandSlots[pelvisIsland.id] = "pelvis"
            puppet.assignCroppedSheetPart(slot: .pelvis, image: pelvisIsland.croppedImage, name: "\(puppet.characterName)_pelvis")
        }

        // Left arm pieces (x < 0.44, ordered top to bottom)
        let leftPieces = islands.filter { $0.normalizedRect.maxX < 0.44 }.sorted { $0.normalizedRect.midY < $1.normalizedRect.midY }
        if leftPieces.count >= 1 {
            mappedIslandSlots[leftPieces[0].id] = "leftUpperArm"
            puppet.assignCroppedSheetPart(slot: .leftUpperArm, image: leftPieces[0].croppedImage, name: "\(puppet.characterName)_leftUpperArm")
        }
        if leftPieces.count >= 2 {
            mappedIslandSlots[leftPieces[1].id] = "leftForearm"
            puppet.assignCroppedSheetPart(slot: .leftForearm, image: leftPieces[1].croppedImage, name: "\(puppet.characterName)_leftForearm")
        }
        if leftPieces.count >= 3 {
            mappedIslandSlots[leftPieces[2].id] = "leftHand"
            puppet.assignCroppedSheetPart(slot: .leftHand, image: leftPieces[2].croppedImage, name: "\(puppet.characterName)_leftHand")
        }

        // Right arm pieces (x > 0.56, ordered top to bottom)
        let rightPieces = islands.filter { $0.normalizedRect.minX > 0.56 }.sorted { $0.normalizedRect.midY < $1.normalizedRect.midY }
        if rightPieces.count >= 1 {
            mappedIslandSlots[rightPieces[0].id] = "rightUpperArm"
            puppet.assignCroppedSheetPart(slot: .rightUpperArm, image: rightPieces[0].croppedImage, name: "\(puppet.characterName)_rightUpperArm")
        }
        if rightPieces.count >= 2 {
            mappedIslandSlots[rightPieces[1].id] = "rightForearm"
            puppet.assignCroppedSheetPart(slot: .rightForearm, image: rightPieces[1].croppedImage, name: "\(puppet.characterName)_rightForearm")
        }
        if rightPieces.count >= 3 {
            mappedIslandSlots[rightPieces[2].id] = "rightHand"
            puppet.assignCroppedSheetPart(slot: .rightHand, image: rightPieces[2].croppedImage, name: "\(puppet.characterName)_rightHand")
        }

        statusMessage = "Auto-mapped \(islands.count) detected parts! Click any piece on the left to re-assign if needed."
    }

    private func openSheetFilePanel() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.png, .jpeg, .tiff]
        panel.allowsMultipleSelection = false
        panel.message = "Select a Paper Puppet Sheet image (PNG/JPG) with separated body parts"
        if panel.runModal() == .OK, let url = panel.url, let img = NSImage(contentsOf: url) {
            loadAndSlice(image: img)
            statusMessage = "Loaded '\(url.lastPathComponent)' — detected \(islands.count) separated body parts!"
        }
    }

    private func aspectFitRect(imageSize: NSSize, in containerSize: CGSize) -> CGRect {
        let pad: CGFloat = 14
        let availW = max(20, containerSize.width - pad * 2)
        let availH = max(20, containerSize.height - pad * 2)
        let imgAspect = max(0.05, imageSize.width / max(1, imageSize.height))
        let boxAspect = availW / availH
        let drawW: CGFloat
        let drawH: CGFloat
        if imgAspect > boxAspect {
            drawW = availW
            drawH = availW / imgAspect
        } else {
            drawH = availH
            drawW = availH * imgAspect
        }
        return CGRect(
            x: (containerSize.width - drawW) * 0.5,
            y: (containerSize.height - drawH) * 0.5,
            width: drawW,
            height: drawH
        )
    }
}
