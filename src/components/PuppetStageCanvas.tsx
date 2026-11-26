import React, { useEffect, useRef, useState } from "react";
import {
  Maximize2,
  Minimize2,
  Crosshair,
  Timer,
  Snowflake,
  ZoomIn,
  ZoomOut,
  Pin,
  PersonStanding,
  Activity,
  Link2,
  RotateCw,
} from "lucide-react";
import {
  getPin,
  SLOT_META_BY_ID,
  STAGE_BACKGROUNDS,
  type PuppetPartSlot,
  type PuppetRigState,
  type PuppetStageBackground,
  type PuppetStore,
} from "@/lib/puppetModel";
import {
  VISEME_LABELS,
  type CalibrationBaseline,
  type SpeechViseme,
  type TrackedFrame,
  type TrackedHand,
} from "@/lib/trackingTypes";
import { sendNdiRgbaFrame, type NdiBackgroundMode } from "@/lib/oscBridge";

interface Point {
  x: number;
  y: number;
}

/** 2D Affine Matrix [a, b, c, d, tx, ty] matching Canvas ctx.transform(a,b,c,d,tx,ty) & CGAffineTransform */
type Mat2D = [number, number, number, number, number, number];

function matIdentity(): Mat2D {
  return [1, 0, 0, 1, 0, 0];
}

/** Standard matrix product M = A * B (applies B to point first, then A — matches ctx.translate/rotate/scale chaining) */
function matMul(A: Mat2D, B: Mat2D): Mat2D {
  return [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

/** Matches Swift's `m1.concatenating(m2)` -> applies m1 first, then m2 (`m2 * m1`) */
function matConcat(first: Mat2D, second: Mat2D): Mat2D {
  return matMul(second, first);
}

function matTranslate(m: Mat2D, tx: number, ty: number): Mat2D {
  return matMul(m, [1, 0, 0, 1, tx, ty]);
}

function matRotate(m: Mat2D, rad: number): Mat2D {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return matMul(m, [c, s, -s, c, 0, 0]);
}

function matScale(m: Mat2D, sx: number, sy: number): Mat2D {
  return matMul(m, [sx, 0, 0, sy, 0, 0]);
}

function matApply(m: Mat2D, p: Point): Point {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

function matInvert(m: Mat2D): Mat2D {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-8) return matIdentity();
  const invDet = 1 / det;
  const a = m[3] * invDet;
  const b = -m[1] * invDet;
  const c = -m[2] * invDet;
  const d = m[0] * invDet;
  const tx = -(a * m[4] + c * m[5]);
  const ty = -(b * m[4] + d * m[5]);
  return [a, b, c, d, tx, ty];
}

function applyMatToCtx(ctx: CanvasRenderingContext2D, m: Mat2D) {
  ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function rotateVec(v: Point, angle: number): Point {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

type HandleKind =
  | "topLeft"
  | "top"
  | "topRight"
  | "right"
  | "bottomRight"
  | "bottom"
  | "bottomLeft"
  | "left"
  | "rotate"
  | "moveBodyPart";

interface PlacedStagePart {
  slot: PuppetPartSlot;
  image: HTMLImageElement | undefined;
  localW: number;
  localH: number;
  localToStage: Mat2D;
  boxW: number;
  boxH: number;
  boxToStage: Mat2D;
  pivotInBox: Point;
  draw: (ctx: CanvasRenderingContext2D) => void;
}

interface StageLayoutResult {
  parts: PlacedStagePart[]; // Ordered Back-to-Front (index 0 = backmost, last = frontmost)
  stagePins: { point: Point; color: string }[];
  trackedHandChains: { wristStage: Point; hand: TrackedHand; visualScale: number }[];
}

interface TransformDragSession {
  slot: PuppetPartSlot;
  handle: HandleKind;
  startWidth: number;
  startHeight: number;
  startRotationDeg: number;
  startOffsetX: number;
  startOffsetY: number;
  startInvViewTransform: Mat2D;
  startBoxW: number;
  startBoxH: number;
  startPivotLocal: Point;
  startPivotView: Point;
  startDragView: Point;
  startDragAngle: number;
  stageH: number;
  scaleDelta: number;
}

interface PuppetStageCanvasProps {
  store: PuppetStore;
  frameRef: React.MutableRefObject<TrackedFrame>;
  calibration: CalibrationBaseline;
  countdownSeconds: number | null;
  viseme: SpeechViseme;
  onCalibrateNow: () => void;
  onStartCountdown: () => void;
  isFullStage: boolean;
  onToggleFullStage: () => void;
  cleanFeed?: boolean;
  compact?: boolean;
  allowPartEditing?: boolean;
  ndiEnabled?: boolean;
  ndiBgMode?: NdiBackgroundMode;
}

// Tiny alpha-sampling cache for pixel-accurate click-through hit testing
const alphaSamplerCanvas =
  typeof document !== "undefined" ? document.createElement("canvas") : null;
if (alphaSamplerCanvas) {
  alphaSamplerCanvas.width = 9;
  alphaSamplerCanvas.height = 9;
}

function isOpaquePixel(img: HTMLImageElement, u: number, v: number): boolean {
  if (u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02) return false;
  if (!alphaSamplerCanvas) return true;
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (nw <= 0 || nh <= 0) return true;
  const cu = clamp(u, 0, 0.9999);
  const cv = clamp(v, 0, 0.9999);
  const px = Math.floor(cu * nw);
  const py = Math.floor(cv * nh);
  const rad = Math.max(3, Math.min(16, Math.floor(Math.max(nw, nh) / 160)));
  const sx = Math.max(0, Math.min(nw - 1, px - rad));
  const sy = Math.max(0, Math.min(nh - 1, py - rad));
  const sw = Math.min(rad * 2 + 1, nw - sx);
  const sh = Math.min(rad * 2 + 1, nh - sy);
  const ctx = alphaSamplerCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return true;
  ctx.clearRect(0, 0, 9, 9);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 9, 9);
  const data = ctx.getImageData(0, 0, 9, 9).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > 12) return true;
  }
  return false;
}

function handleLocalPoint(handle: HandleKind, boxW: number, boxH: number): Point {
  switch (handle) {
    case "topLeft":
      return { x: 0, y: 0 };
    case "top":
      return { x: boxW * 0.5, y: 0 };
    case "topRight":
      return { x: boxW, y: 0 };
    case "right":
      return { x: boxW, y: boxH * 0.5 };
    case "bottomRight":
      return { x: boxW, y: boxH };
    case "bottom":
      return { x: boxW * 0.5, y: boxH };
    case "bottomLeft":
      return { x: 0, y: boxH };
    case "left":
      return { x: 0, y: boxH * 0.5 };
    case "rotate":
      return { x: boxW * 0.5, y: -26 };
    case "moveBodyPart":
      return { x: boxW * 0.5, y: boxH * 0.5 };
  }
}

function viewZoomTransform(w: number, h: number, zoom: number): Mat2D {
  if (Math.abs(zoom - 1) < 1e-4) return matIdentity();
  let xf = matIdentity();
  xf = matTranslate(xf, w * 0.5, h * 0.5);
  xf = matScale(xf, zoom, zoom);
  xf = matTranslate(xf, -w * 0.5, -h * 0.5);
  return xf;
}

export function PuppetStageCanvas({
  store,
  frameRef,
  calibration,
  countdownSeconds,
  viseme,
  onCalibrateNow,
  onStartCountdown,
  isFullStage,
  onToggleFullStage,
  cleanFeed = false,
  compact = false,
  allowPartEditing,
  ndiEnabled = false,
  ndiBgMode = "alpha",
}: PuppetStageCanvasProps) {
  const canEditParts = allowPartEditing ?? (!isFullStage && !compact);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ndiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastNdiSendRef = useRef<number>(0);

  const [zoom, setZoom] = useState(1.0);
  const [frozen, setFrozen] = useState(false);
  const [showPins, setShowPins] = useState(false);
  const [ikMenuOpen, setIkMenuOpen] = useState(false);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });

  // Interactive transform & context menu state
  const [activeOverlayBox, setActiveOverlayBox] = useState<{
    slot: PuppetPartSlot;
    boxW: number;
    boxH: number;
    boxToView: Mat2D;
    pivotView: Point;
    pivotInBox: Point;
    scaleDelta: number;
  } | null>(null);
  const [dragHud, setDragHud] = useState<{ text: string; x: number; y: number } | null>(null);
  const [activeDragHandle, setActiveDragHandle] = useState<HandleKind | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    slot: PuppetPartSlot;
  } | null>(null);

  const transformSessionRef = useRef<TransformDragSession | null>(null);
  const panDragRef = useRef<{
    startX: number;
    startY: number;
    origOffX: number;
    origOffY: number;
    moved: boolean;
  } | null>(null);
  const latestLayoutRef = useRef<StageLayoutResult | null>(null);

  const storeRef = useRef(store);
  storeRef.current = store;
  const calRef = useRef(calibration);
  calRef.current = calibration;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;
  const showPinsRef = useRef(showPins);
  showPinsRef.current = showPins;
  const ndiEnabledRef = useRef(ndiEnabled);
  ndiEnabledRef.current = ndiEnabled;
  const ndiBgModeRef = useRef(ndiBgMode);
  ndiBgModeRef.current = ndiBgMode;

  const animStateRef = useRef<AnimSmoothState>({
    lastFrame: null,
    frozenTimeSec: 0,
    smoothHeadX: 0,
    smoothHeadY: 0,
    smoothRoll: 0,
    smoothYaw: 0,
    smoothPitch: 0,
    smoothMouth: 0,
    smoothSmile: 0,
    smoothPucker: 0,
    smoothBrow: 0,
    smoothFurrow: 0,
    smoothBlinkL: 0,
    smoothBlinkR: 0,
    smoothArmL: null,
    smoothArmR: null,
  });

  // Render loop at 60 FPS
  useEffect(() => {
    let raf = 0;
    let lastOverlaySync = 0;

    const render = (nowMs: number) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (canvas && container) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const rect = container.getBoundingClientRect();
        const cssW = Math.max(200, Math.floor(rect.width));
        const cssH = Math.max(200, Math.floor(rect.height));
        const targetW = Math.floor(cssW * dpr);
        const targetH = Math.floor(cssH * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
          setStageSize({ w: cssW, h: cssH });
        }

        const st = storeRef.current;
        const isFrozenNow = frozenRef.current || Boolean(transformSessionRef.current);
        if (!isFrozenNow) {
          animStateRef.current.lastFrame = frameRef.current;
          animStateRef.current.frozenTimeSec = nowMs / 1000;
        }
        const activeFrame =
          isFrozenNow && animStateRef.current.lastFrame
            ? animStateRef.current.lastFrame
            : frameRef.current;
        const activeTimeSec = isFrozenNow
          ? animStateRef.current.frozenTimeSec
          : nowMs / 1000;

        const layout = computeStageLayout(
          cssW,
          cssH,
          st.rig,
          st.images,
          activeFrame,
          calRef.current,
          activeTimeSec,
          animStateRef.current,
          !isFrozenNow,
          st.selectedSlot,
          canEditParts,
        );
        latestLayoutRef.current = layout.result;

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.save();
          ctx.scale(dpr, dpr);
          drawLayoutToCanvas(
            ctx,
            cssW,
            cssH,
            st.rig,
            layout.result,
            zoomRef.current,
            showPinsRef.current && canEditParts,
            null,
          );
          ctx.restore();
        }

        // Sync selected part's Free Transform overlay geometry (~30Hz or immediately during drag)
        if (canEditParts && st.showStageTransformBox) {
          const shouldSync =
            Boolean(transformSessionRef.current) || nowMs - lastOverlaySync >= 32;
          if (shouldSync) {
            lastOverlaySync = nowMs;
            const found = layout.result.parts.find((p) => p.slot === st.selectedSlot);
            if (found) {
              const zXf = viewZoomTransform(cssW, cssH, zoomRef.current);
              const boxToView = matConcat(found.boxToStage, zXf);
              const pivotView = matApply(boxToView, found.pivotInBox);
              setActiveOverlayBox({
                slot: found.slot,
                boxW: found.boxW,
                boxH: found.boxH,
                boxToView,
                pivotView,
                pivotInBox: found.pivotInBox,
                scaleDelta: layout.scaleDelta,
              });
            } else {
              setActiveOverlayBox(null);
            }
          }
        } else if (activeOverlayBox !== null) {
          setActiveOverlayBox(null);
        }

        // Character-Only NDI Video Output (1280x720 @ 30 FPS)
        if (ndiEnabledRef.current && nowMs - lastNdiSendRef.current >= 33) {
          lastNdiSendRef.current = nowMs;
          if (!ndiCanvasRef.current) {
            const c = document.createElement("canvas");
            c.width = 1280;
            c.height = 720;
            ndiCanvasRef.current = c;
          }
          const ndiCtx = ndiCanvasRef.current.getContext("2d", {
            willReadFrequently: true,
          });
          if (ndiCtx) {
            const ndiLayout = computeStageLayout(
              1280,
              720,
              st.rig,
              st.images,
              activeFrame,
              calRef.current,
              activeTimeSec,
              animStateRef.current,
              false,
              st.selectedSlot,
              false,
            );
            drawLayoutToCanvas(
              ndiCtx,
              1280,
              720,
              st.rig,
              ndiLayout.result,
              zoomRef.current,
              false,
              ndiBgModeRef.current,
            );
            const imgData = ndiCtx.getImageData(0, 0, 1280, 720);
            sendNdiRgbaFrame(1280, 720, new Uint8Array(imgData.data.buffer));
          }
        }
      }
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRef, isFullStage, canEditParts]);

  const localPointer = (clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const selectBodyPartAt = (viewPt: Point): boolean => {
    const layout = latestLayoutRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!layout || !rect) return false;
    const zXf = viewZoomTransform(rect.width, rect.height, zoom);

    // Pass 1: Strict Front-to-Back PNG alpha hit test (transparent pixels pass through!)
    for (let i = layout.parts.length - 1; i >= 0; i--) {
      const part = layout.parts[i];
      const viewXf = matConcat(part.localToStage, zXf);
      const localPt = matApply(matInvert(viewXf), viewPt);
      if (
        localPt.x >= -4 &&
        localPt.x <= part.localW + 4 &&
        localPt.y >= -4 &&
        localPt.y <= part.localH + 4
      ) {
        const u = localPt.x / Math.max(1, part.localW);
        const v = localPt.y / Math.max(1, part.localH);
        if (part.image) {
          if (isOpaquePixel(part.image, u, v)) {
            const meta = SLOT_META_BY_ID[part.slot];
            if (meta) store.setSelectedCategory(meta.category);
            store.setSelectedSlot(part.slot);
            store.setShowStageTransformBox(true);
            return true;
          }
        }
      }
    }

    // Pass 2: Bounding-box fallback
    for (let i = layout.parts.length - 1; i >= 0; i--) {
      const part = layout.parts[i];
      const viewXf = matConcat(part.localToStage, zXf);
      const localPt = matApply(matInvert(viewXf), viewPt);
      if (
        localPt.x >= 0 &&
        localPt.x <= part.localW &&
        localPt.y >= 0 &&
        localPt.y <= part.localH
      ) {
        const meta = SLOT_META_BY_ID[part.slot];
        if (meta) store.setSelectedCategory(meta.category);
        store.setSelectedSlot(part.slot);
        store.setShowStageTransformBox(true);
        return true;
      }
    }

    store.setShowStageTransformBox(false);
    return false;
  };

  // Stage background pointer handlers (pan & click-to-select)
  const handleStagePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setContextMenu(null);
    setIkMenuOpen(false);
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    panDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origOffX: store.rig.stageOffsetX,
      origOffY: store.rig.stageOffsetY,
      moved: false,
    };
  };

  const handleStagePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pan = panDragRef.current;
    if (!pan) return;
    const dx = e.clientX - pan.startX;
    const dy = e.clientY - pan.startY;
    if (!pan.moved && Math.hypot(dx, dy) > 4) {
      pan.moved = true;
    }
    if (pan.moved) {
      const nx = pan.origOffX + dx / Math.max(0.25, zoom);
      const ny = pan.origOffY + dy / Math.max(0.25, zoom);
      store.updateRig((p) => ({ ...p, stageOffsetX: nx, stageOffsetY: ny }), false);
    }
  };

  const handleStagePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pan = panDragRef.current;
    panDragRef.current = null;
    if (pan && !pan.moved && canEditParts) {
      selectBodyPartAt(localPointer(e.clientX, e.clientY));
    }
  };

  const handleDoubleClick = () => {
    setZoom(1.0);
    store.updateRig((prev) => ({ ...prev, stageOffsetX: 0, stageOffsetY: 0 }), true);
  };

  // Free Transform Handle Pointer Handlers (exact port of PuppetStudioView.swift)
  const startTransformHandleDrag = (
    e: React.PointerEvent,
    handle: HandleKind,
  ) => {
    e.stopPropagation();
    setContextMenu(null);
    if (e.button !== 0 || !activeOverlayBox) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const ptView = localPointer(e.clientX, e.clientY);
    const slot = activeOverlayBox.slot;
    const rig = store.rig;
    // Record undo snapshot at drag start
    store.updateRig((p) => ({ ...p }), true);

    transformSessionRef.current = {
      slot,
      handle,
      startWidth: rig.partWidthScale[slot] ?? 1.0,
      startHeight: rig.partHeightScale[slot] ?? 1.0,
      startRotationDeg: rig.partRotationOffset[slot] ?? 0.0,
      startOffsetX: rig.partOffsetX[slot] ?? 0.0,
      startOffsetY: rig.partOffsetY[slot] ?? 0.0,
      startInvViewTransform: matInvert(activeOverlayBox.boxToView),
      startBoxW: activeOverlayBox.boxW,
      startBoxH: activeOverlayBox.boxH,
      startPivotLocal: activeOverlayBox.pivotInBox,
      startPivotView: activeOverlayBox.pivotView,
      startDragView: ptView,
      startDragAngle: Math.atan2(
        ptView.y - activeOverlayBox.pivotView.y,
        ptView.x - activeOverlayBox.pivotView.x,
      ),
      stageH: stageSize.h,
      scaleDelta: activeOverlayBox.scaleDelta,
    };
    setActiveDragHandle(handle);
  };

  const moveTransformHandleDrag = (e: React.PointerEvent) => {
    const session = transformSessionRef.current;
    if (!session) return;
    e.stopPropagation();
    const ptView = localPointer(e.clientX, e.clientY);
    const shiftHeld = e.shiftKey;

    if (session.handle === "moveBodyPart") {
      const dsX = (ptView.x - session.startDragView.x) / Math.max(0.25, zoom);
      const dsY = (ptView.y - session.startDragView.y) / Math.max(0.25, zoom);
      // If user barely clicked (<3px), don't move yet so simple click-through works
      if (Math.hypot(dsX, dsY) < 2) return;
      const unit = Math.max(
        40,
        session.stageH * store.rig.characterScale * session.scaleDelta,
      );
      const nx = session.startOffsetX + dsX / unit;
      const ny = session.startOffsetY + dsY / unit;
      store.updateRig(
        (p) => ({
          ...p,
          partOffsetX: { ...p.partOffsetX, [session.slot]: nx },
          partOffsetY: { ...p.partOffsetY, [session.slot]: ny },
        }),
        false,
      );
      setDragHud({
        text: `Δ ${Math.round(dsX)}, ${Math.round(dsY)} px`,
        x: ptView.x,
        y: ptView.y,
      });
    } else if (session.handle === "rotate") {
      const curAng = Math.atan2(
        ptView.y - session.startPivotView.y,
        ptView.x - session.startPivotView.x,
      );
      const diff = curAng - session.startDragAngle;
      const deltaRad = Math.atan2(Math.sin(diff), Math.cos(diff));
      let newDeg = session.startRotationDeg + (deltaRad * 180) / Math.PI;
      while (newDeg > 180) newDeg -= 360;
      while (newDeg < -180) newDeg += 360;
      if (shiftHeld) newDeg = Math.round(newDeg / 15) * 15;
      store.updateRig(
        (p) => ({
          ...p,
          partRotationOffset: { ...p.partRotationOffset, [session.slot]: newDeg },
        }),
        false,
      );
      setDragHud({
        text: `${newDeg >= 0 ? "+" : ""}${newDeg.toFixed(1)}°`,
        x: ptView.x,
        y: ptView.y,
      });
    } else {
      const localPt = matApply(session.startInvViewTransform, ptView);
      const startLocal = handleLocalPoint(
        session.handle,
        session.startBoxW,
        session.startBoxH,
      );
      const affectsX = session.handle !== "top" && session.handle !== "bottom";
      const affectsY = session.handle !== "left" && session.handle !== "right";
      const isCorner = affectsX && affectsY;

      let ratioX = 1;
      if (affectsX) {
        const startSpan = startLocal.x - session.startPivotLocal.x;
        const curSpan = localPt.x - session.startPivotLocal.x;
        if (Math.abs(startSpan) >= Math.max(8, session.startBoxW * 0.14)) {
          ratioX = clamp(curSpan / startSpan, 0.2, 4.0);
        } else {
          const outSign = startLocal.x >= session.startBoxW * 0.5 ? 1 : -1;
          const delta =
            ((localPt.x - startLocal.x) * outSign) / Math.max(12, session.startBoxW);
          ratioX = clamp(1 + delta, 0.2, 4.0);
        }
      }

      let ratioY = 1;
      if (affectsY) {
        const startSpan = startLocal.y - session.startPivotLocal.y;
        const curSpan = localPt.y - session.startPivotLocal.y;
        if (Math.abs(startSpan) >= Math.max(8, session.startBoxH * 0.14)) {
          ratioY = clamp(curSpan / startSpan, 0.2, 4.0);
        } else {
          const outSign = startLocal.y >= session.startBoxH * 0.5 ? 1 : -1;
          const delta =
            ((localPt.y - startLocal.y) * outSign) / Math.max(12, session.startBoxH);
          ratioY = clamp(1 + delta, 0.2, 4.0);
        }
      }

      const finalRX = isCorner && shiftHeld ? (ratioX + ratioY) * 0.5 : ratioX;
      const finalRY = isCorner && shiftHeld ? (ratioX + ratioY) * 0.5 : ratioY;
      const nw = affectsX ? clamp(session.startWidth * finalRX, 0.25, 3.5) : session.startWidth;
      const nh = affectsY ? clamp(session.startHeight * finalRY, 0.25, 3.5) : session.startHeight;

      store.updateRig(
        (p) => ({
          ...p,
          partWidthScale: affectsX
            ? { ...p.partWidthScale, [session.slot]: nw }
            : p.partWidthScale,
          partHeightScale: affectsY
            ? { ...p.partHeightScale, [session.slot]: nh }
            : p.partHeightScale,
        }),
        false,
      );
      setDragHud({
        text: `W ${Math.round(nw * 100)}% × H ${Math.round(nh * 100)}%`,
        x: ptView.x,
        y: ptView.y,
      });
    }
  };

  const endTransformHandleDrag = (e: React.PointerEvent) => {
    const session = transformSessionRef.current;
    transformSessionRef.current = null;
    setActiveDragHandle(null);
    setDragHud(null);
    if (session && session.handle === "moveBodyPart") {
      const ptView = localPointer(e.clientX, e.clientY);
      if (
        Math.hypot(
          ptView.x - session.startDragView.x,
          ptView.y - session.startDragView.y,
        ) < 3
      ) {
        // Pure click inside current box: allow selecting overlapping parts underneath/on top
        selectBodyPartAt(ptView);
      }
    }
  };

  const bgInfo =
    STAGE_BACKGROUNDS.find((b) => b.id === store.rig.stageBackground) ??
    STAGE_BACKGROUNDS[0];

  const bothIk = store.rig.followChildrenOnMove && store.rig.followChildrenOnRotate;
  const anyIk = store.rig.followChildrenOnMove || store.rig.followChildrenOnRotate;
  const ikLabel = bothIk
    ? "IK M+R"
    : store.rig.followChildrenOnMove
      ? "IK Move"
      : store.rig.followChildrenOnRotate
        ? "IK Rot"
        : "IK Solo";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40">
      {/* Stage Toolbar */}
      {!cleanFeed && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 bg-[#12161e] px-3 py-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-1 font-medium text-foreground">
              <PersonStanding className="h-3.5 w-3.5 text-cyan-400" />
              <span className="max-w-[150px] truncate">{store.rig.characterName}</span>
            </span>

            <button
              type="button"
              onClick={onCalibrateNow}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition ${
                calibration.calibrated
                  ? "bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30"
                  : "bg-amber-500/80 text-black hover:bg-amber-400"
              }`}
              title="Calibrate neutral face & body baseline now"
            >
              <Crosshair className="h-3 w-3" />
              {calibration.calibrated ? "Calibrated" : "Calibrate"}
            </button>

            <button
              type="button"
              onClick={onStartCountdown}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 font-medium text-sky-300 transition hover:bg-white/15"
              title="3-second countdown for neutral A-Pose calibration"
            >
              <Timer className="h-3 w-3" />
              {countdownSeconds !== null ? `${countdownSeconds}s…` : "3s Pose"}
            </button>

            {/* Fixed-width viseme pill */}
            <span className="inline-flex w-[144px] items-center justify-center rounded-full bg-black/50 px-2.5 py-1 font-mono text-[11px] font-semibold text-amber-400">
              {VISEME_LABELS[viseme]}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {/* Hierarchical FK/IK Follow Chain Switch (matches macOS Native "IK M+R") */}
            {canEditParts && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIkMenuOpen((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold transition ${
                    anyIk
                      ? "bg-teal-500/25 text-teal-300 hover:bg-teal-500/35"
                      : "bg-white/8 text-muted-foreground hover:bg-white/15"
                  }`}
                  title="Hierarchical Bone Chain: choose whether child limbs follow parent Move & Rotate"
                >
                  <Link2 className="h-3 w-3" />
                  {ikLabel}
                </button>
                {ikMenuOpen && (
                  <div className="absolute right-0 top-full z-40 mt-1 w-48 rounded-xl border border-white/15 bg-[#161b26] p-2 text-xs shadow-2xl">
                    <label className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 hover:bg-white/8">
                      <span>Children Follow Move</span>
                      <input
                        type="checkbox"
                        checked={store.rig.followChildrenOnMove}
                        onChange={(e) =>
                          store.updateRig(
                            (p) => ({ ...p, followChildrenOnMove: e.target.checked }),
                            true,
                          )
                        }
                        className="accent-cyan-400"
                      />
                    </label>
                    <label className="flex cursor-pointer items-center justify-between rounded px-2 py-1.5 hover:bg-white/8">
                      <span>Children Follow Rotate</span>
                      <input
                        type="checkbox"
                        checked={store.rig.followChildrenOnRotate}
                        onChange={(e) =>
                          store.updateRig(
                            (p) => ({ ...p, followChildrenOnRotate: e.target.checked }),
                            true,
                          )
                        }
                        className="accent-cyan-400"
                      />
                    </label>
                  </div>
                )}
              </div>
            )}

            {!compact && (
              <>
                <label
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-1 text-[11px] text-muted-foreground"
                  title="Idle Motion / Sway Amount"
                >
                  <Activity className="h-3 w-3 text-cyan-400" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={store.rig.idleMotionAmount}
                    onChange={(e) =>
                      store.updateRig((p) => ({
                        ...p,
                        idleMotionAmount: parseFloat(e.target.value),
                      }))
                    }
                    className="h-1 w-14 accent-cyan-400"
                  />
                  <span className="w-7 text-right font-mono">
                    {Math.round(store.rig.idleMotionAmount * 100)}%
                  </span>
                </label>

                <select
                  value={store.rig.stageBackground}
                  onChange={(e) =>
                    store.updateRig((p) => ({
                      ...p,
                      stageBackground: e.target.value as PuppetStageBackground,
                    }))
                  }
                  className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-foreground outline-none"
                >
                  {STAGE_BACKGROUNDS.map((bg) => (
                    <option key={bg.id} value={bg.id} className="bg-[#161a24] text-white">
                      {bg.label}
                    </option>
                  ))}
                </select>
              </>
            )}

            <div className="inline-flex items-center rounded-md border border-white/10 bg-black/30">
              <button
                type="button"
                onClick={() => setZoom((z) => clamp(Number((z - 0.15).toFixed(2)), 0.4, 3.0))}
                className="px-1.5 py-1 text-muted-foreground hover:text-foreground"
                title="Zoom Out"
              >
                <ZoomOut className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={handleDoubleClick}
                className="min-w-[40px] px-1 text-center font-mono text-[11px] text-foreground"
                title="Reset Zoom & Position"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => clamp(Number((z + 0.15).toFixed(2)), 0.4, 3.0))}
                className="px-1.5 py-1 text-muted-foreground hover:text-foreground"
                title="Zoom In"
              >
                <ZoomIn className="h-3 w-3" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => setFrozen((f) => !f)}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
                frozen
                  ? "bg-sky-500 text-white"
                  : "bg-white/8 text-muted-foreground hover:bg-white/15 hover:text-foreground"
              }`}
              title="Freeze puppet pose while editing parts"
            >
              <Snowflake className="h-3 w-3" />
              {!compact && "Freeze"}
            </button>

            <button
              type="button"
              onClick={() =>
                store.updateRig(
                  (p) => ({ ...p, showFullBodyLegs: !p.showFullBodyLegs }),
                  true,
                )
              }
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
                store.rig.showFullBodyLegs
                  ? "bg-blue-600 text-white"
                  : "bg-white/8 text-muted-foreground hover:bg-white/15"
              }`}
              title="Toggle full-body legs"
            >
              Full Body
            </button>

            {canEditParts && (
              <button
                type="button"
                onClick={() => setShowPins((s) => !s)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
                  showPins
                    ? "bg-amber-500 text-black"
                    : "bg-white/8 text-muted-foreground hover:bg-white/15"
                }`}
                title="Show rigging joint pins on stage"
              >
                <Pin className="h-3 w-3" />
              </button>
            )}

            <button
              type="button"
              onClick={onToggleFullStage}
              className="inline-flex items-center rounded-md bg-white/8 p-1.5 text-muted-foreground transition hover:bg-white/15 hover:text-foreground"
              title={isFullStage ? "Exit Full Stage" : "Full Stage Preview"}
            >
              {isFullStage ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Main 60 FPS Canvas Stage + Interactive Free Transform Overlay */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden select-none"
        style={{ backgroundColor: bgInfo.cssColor }}
        onClick={() => {
          if (contextMenu) setContextMenu(null);
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onDoubleClick={handleDoubleClick}
          onContextMenu={(e) => {
            if (!canEditParts) return;
            e.preventDefault();
            const pt = localPointer(e.clientX, e.clientY);
            if (selectBodyPartAt(pt)) {
              setTimeout(() => {
                setContextMenu({ x: pt.x, y: pt.y, slot: storeRef.current.selectedSlot });
              }, 0);
            }
          }}
          className={`h-full w-full ${canEditParts ? "cursor-crosshair" : "cursor-grab"}`}
        />

        {/* Photoshop-Style On-Stage Free Transform Box (Move, 8 Resize Handles, Rotate Lollipop) */}
        {canEditParts && store.showStageTransformBox && activeOverlayBox && (
          <FreeTransformOverlaySVG
            box={activeOverlayBox}
            stageW={stageSize.w}
            stageH={stageSize.h}
            layerIndex={store.rig.layerStack.indexOf(activeOverlayBox.slot)}
            activeHandle={activeDragHandle}
            dragHud={dragHud}
            onStartHandle={startTransformHandleDrag}
            onMoveHandle={moveTransformHandleDrag}
            onEndHandle={endTransformHandleDrag}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const pt = localPointer(e.clientX, e.clientY);
              setContextMenu({ x: pt.x, y: pt.y, slot: activeOverlayBox.slot });
            }}
          />
        )}

        {/* Right-Click Context Menu on Selected Stage Part */}
        {contextMenu && (
          <div
            style={{
              left: Math.min(stageSize.w - 190, Math.max(8, contextMenu.x)),
              top: Math.min(stageSize.h - 240, Math.max(8, contextMenu.y)),
            }}
            className="absolute z-40 w-48 rounded-xl border border-white/15 bg-[#151923]/95 p-1.5 text-xs text-foreground shadow-2xl backdrop-blur"
            onClick={(e) => e.stopPropagation()}
          >
            <ContextBtn
              label="Bring Forward"
              onClick={() => {
                store.moveLayerForward(contextMenu.slot);
                setContextMenu(null);
              }}
            />
            <ContextBtn
              label="Send Backward"
              onClick={() => {
                store.moveLayerBackward(contextMenu.slot);
                setContextMenu(null);
              }}
            />
            <ContextBtn
              label="Bring to Front"
              onClick={() => {
                store.moveLayerToFront(contextMenu.slot);
                setContextMenu(null);
              }}
            />
            <ContextBtn
              label="Send to Back"
              onClick={() => {
                store.moveLayerToBack(contextMenu.slot);
                setContextMenu(null);
              }}
            />
            <div className="my-1 border-t border-white/10" />
            <ContextBtn
              label={
                store.rig.partFlipH[contextMenu.slot]
                  ? "Unflip Horizontal"
                  : "Flip Horizontal"
              }
              onClick={() => {
                store.updateRig(
                  (p) => ({
                    ...p,
                    partFlipH: {
                      ...p.partFlipH,
                      [contextMenu.slot]: !p.partFlipH[contextMenu.slot],
                    },
                  }),
                  true,
                );
                setContextMenu(null);
              }}
            />
            <ContextBtn
              label={
                store.rig.partFlipV[contextMenu.slot] ? "Unflip Vertical" : "Flip Vertical"
              }
              onClick={() => {
                store.updateRig(
                  (p) => ({
                    ...p,
                    partFlipV: {
                      ...p.partFlipV,
                      [contextMenu.slot]: !p.partFlipV[contextMenu.slot],
                    },
                  }),
                  true,
                );
                setContextMenu(null);
              }}
            />
            <div className="my-1 border-t border-white/10" />
            <ContextBtn
              label={`${store.rig.followChildrenOnMove ? "✓ " : ""}Children Follow Move`}
              onClick={() => {
                store.updateRig(
                  (p) => ({ ...p, followChildrenOnMove: !p.followChildrenOnMove }),
                  true,
                );
                setContextMenu(null);
              }}
            />
            <ContextBtn
              label={`${store.rig.followChildrenOnRotate ? "✓ " : ""}Children Follow Rotate`}
              onClick={() => {
                store.updateRig(
                  (p) => ({ ...p, followChildrenOnRotate: !p.followChildrenOnRotate }),
                  true,
                );
                setContextMenu(null);
              }}
            />
            <div className="my-1 border-t border-white/10" />
            <ContextBtn
              label="Reset Part Transform"
              onClick={() => {
                store.resetPartTransform(contextMenu.slot);
                setContextMenu(null);
              }}
            />
            <ContextBtn
              label="Hide Selection Box"
              onClick={() => {
                store.setShowStageTransformBox(false);
                setContextMenu(null);
              }}
            />
          </div>
        )}

        {/* Countdown Overlay */}
        {countdownSeconds !== null && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25 backdrop-blur-[1px]">
            <div className="flex flex-col items-center rounded-2xl border border-cyan-400/40 bg-black/75 px-8 py-5 text-center shadow-2xl">
              <span className="text-5xl font-bold text-cyan-400">{countdownSeconds}</span>
              <span className="mt-1 text-xs font-medium text-white/85">
                Hold neutral A-Pose facing camera…
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ContextBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded px-2.5 py-1 text-left text-[11px] hover:bg-cyan-500/20 hover:text-cyan-200"
    >
      {label}
    </button>
  );
}

// ── Interactive SVG Free Transform Overlay ─────────────────────────────────

function FreeTransformOverlaySVG({
  box,
  stageW,
  stageH,
  layerIndex,
  activeHandle,
  dragHud,
  onStartHandle,
  onMoveHandle,
  onEndHandle,
  onContextMenu,
}: {
  box: {
    slot: PuppetPartSlot;
    boxW: number;
    boxH: number;
    boxToView: Mat2D;
    pivotView: Point;
  };
  stageW: number;
  stageH: number;
  layerIndex: number;
  activeHandle: HandleKind | null;
  dragHud: { text: string; x: number; y: number } | null;
  onStartHandle: (e: React.PointerEvent, handle: HandleKind) => void;
  onMoveHandle: (e: React.PointerEvent) => void;
  onEndHandle: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { boxW: w, boxH: h, boxToView, pivotView } = box;
  const tl = matApply(boxToView, { x: 0, y: 0 });
  const tm = matApply(boxToView, { x: w * 0.5, y: 0 });
  const tr = matApply(boxToView, { x: w, y: 0 });
  const rm = matApply(boxToView, { x: w, y: h * 0.5 });
  const br = matApply(boxToView, { x: w, y: h });
  const bm = matApply(boxToView, { x: w * 0.5, y: h });
  const bl = matApply(boxToView, { x: 0, y: h });
  const lm = matApply(boxToView, { x: 0, y: h * 0.5 });
  const center = matApply(boxToView, { x: w * 0.5, y: h * 0.5 });

  const edgeDx = tr.x - tl.x;
  const edgeDy = tr.y - tl.y;
  const edgeLen = Math.max(1, Math.hypot(edgeDx, edgeDy));
  const candA = { x: edgeDy / edgeLen, y: -edgeDx / edgeLen };
  const candB = { x: -edgeDy / edgeLen, y: edgeDx / edgeLen };
  const dotA = candA.x * (tm.x - center.x) + candA.y * (tm.y - center.y);
  const upDir = dotA >= 0 ? candA : candB;
  const rotHandle = { x: tm.x + upDir.x * 26, y: tm.y + upDir.y * 26 };

  const handles: { kind: HandleKind; pos: Point }[] = [
    { kind: "topLeft", pos: tl },
    { kind: "top", pos: tm },
    { kind: "topRight", pos: tr },
    { kind: "right", pos: rm },
    { kind: "bottomRight", pos: br },
    { kind: "bottom", pos: bm },
    { kind: "bottomLeft", pos: bl },
    { kind: "left", pos: lm },
  ];

  const chipX = clamp((bl.x + br.x) * 0.5, 60, stageW - 60);
  const chipY = clamp(Math.max(bl.y, br.y) + 16, 28, stageH - 16);
  const title = SLOT_META_BY_ID[box.slot]?.title ?? box.slot;

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <svg className="h-full w-full overflow-visible">
        {/* Draggable interior quad */}
        <polygon
          points={`${tl.x},${tl.y} ${tr.x},${tr.y} ${br.x},${br.y} ${bl.x},${bl.y}`}
          fill="rgba(34, 211, 238, 0.03)"
          stroke="rgba(34, 211, 238, 0.92)"
          strokeWidth={1.5}
          className="pointer-events-auto cursor-move"
          onPointerDown={(e) => onStartHandle(e, "moveBodyPart")}
          onPointerMove={onMoveHandle}
          onPointerUp={onEndHandle}
          onContextMenu={onContextMenu}
        />

        {/* Rotation stem */}
        <line
          x1={tm.x}
          y1={tm.y}
          x2={rotHandle.x}
          y2={rotHandle.y}
          stroke="rgba(34, 211, 238, 0.9)"
          strokeWidth={1.5}
        />

        {/* Pivot crosshair */}
        <g transform={`translate(${pivotView.x}, ${pivotView.y})`}>
          <circle r={5.5} fill="none" stroke="rgba(0,0,0,0.75)" strokeWidth={2.5} />
          <circle r={5.5} fill="none" stroke="#facc15" strokeWidth={1.4} />
          <line x1={-7} y1={0} x2={7} y2={0} stroke="#facc15" strokeWidth={1.2} />
          <line x1={0} y1={-7} x2={0} y2={7} stroke="#facc15" strokeWidth={1.2} />
        </g>

        {/* 8 Resize Handles */}
        {handles.map((hItem) => {
          const active = activeHandle === hItem.kind;
          return (
            <g
              key={hItem.kind}
              transform={`translate(${hItem.pos.x}, ${hItem.pos.y})`}
              className="pointer-events-auto cursor-nwse-resize"
              onPointerDown={(e) => onStartHandle(e, hItem.kind)}
              onPointerMove={onMoveHandle}
              onPointerUp={onEndHandle}
            >
              <rect x={-10} y={-10} width={20} height={20} fill="transparent" />
              <rect
                x={-4}
                y={-4}
                width={8}
                height={8}
                rx={1.5}
                fill={active ? "#facc15" : "#ffffff"}
                stroke="#000000"
                strokeWidth={1.2}
              />
            </g>
          );
        })}
      </svg>

      {/* Rotation Lollipop Handle */}
      <div
        style={{ left: rotHandle.x, top: rotHandle.y }}
        className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 cursor-grab p-1.5"
        title="Drag to rotate around joint pivot (Hold Shift to snap 15°)"
        onPointerDown={(e) => onStartHandle(e, "rotate")}
        onPointerMove={onMoveHandle}
        onPointerUp={onEndHandle}
      >
        <div
          className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border border-black shadow ${
            activeHandle === "rotate" ? "bg-yellow-400" : "bg-cyan-400"
          }`}
        >
          <RotateCw className="h-2 w-2 text-black" />
        </div>
      </div>

      {/* Selected Part Label Chip */}
      <div
        style={{ left: chipX, top: chipY }}
        className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/70 bg-black/80 px-2 py-0.5 text-[10px] font-semibold text-white shadow"
      >
        {title}{" "}
        {layerIndex >= 0 && (
          <span className="font-mono text-[9px] text-cyan-300">#{layerIndex + 1}</span>
        )}
      </div>

      {/* Live Drag Readout HUD */}
      {dragHud && (
        <div
          style={{
            left: clamp(dragHud.x + 28, 60, stageW - 60),
            top: clamp(dragHud.y - 24, 20, stageH - 20),
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2 rounded bg-yellow-400 px-2 py-0.5 font-mono text-[10px] font-bold text-black shadow-lg"
        >
          {dragHud.text}
        </div>
      )}
    </div>
  );
}

// ── Exact 1:1 Port of PuppetStudioView.swift Unified Stage Layout Engine ───

interface ArmSmoothEntry {
  shoulder: Point;
  elbow: Point;
  wrist: Point;
  angle: number;
}

interface AnimSmoothState {
  lastFrame: TrackedFrame | null;
  frozenTimeSec: number;
  smoothHeadX: number;
  smoothHeadY: number;
  smoothRoll: number;
  smoothYaw: number;
  smoothPitch: number;
  smoothMouth: number;
  smoothSmile: number;
  smoothPucker: number;
  smoothBrow: number;
  smoothFurrow: number;
  smoothBlinkL: number;
  smoothBlinkR: number;
  smoothArmL: ArmSmoothEntry | null;
  smoothArmR: ArmSmoothEntry | null;
}

function makeAnchoredTransform(
  pivotStage: Point,
  rotationRad: number,
  flipX: number,
  flipY: number,
  pivotUV: Point,
  width: number,
  height: number,
) {
  let localXf = matIdentity();
  localXf = matTranslate(localXf, pivotStage.x, pivotStage.y);
  localXf = matRotate(localXf, rotationRad);
  localXf = matScale(localXf, flipX, flipY);
  localXf = matTranslate(localXf, -pivotUV.x * width, -pivotUV.y * height);

  const effW = Math.max(4, Math.abs(flipX) * width);
  const effH = Math.max(4, Math.abs(flipY) * height);
  const effU = flipX < 0 ? 1 - pivotUV.x : pivotUV.x;
  const effV = flipY < 0 ? 1 - pivotUV.y : pivotUV.y;
  const pivotInBox: Point = { x: effU * effW, y: effV * effH };

  let boxXf = matIdentity();
  boxXf = matTranslate(boxXf, pivotStage.x, pivotStage.y);
  boxXf = matRotate(boxXf, rotationRad);
  boxXf = matTranslate(boxXf, -pivotInBox.x, -pivotInBox.y);

  return { localToStage: localXf, boxW: effW, boxH: effH, boxToStage: boxXf, pivotInBox };
}

function makeHandAnchoredTransform(
  pivotStage: Point,
  worldRotationRad: number,
  intrinsicRotationRad: number,
  flipX: number,
  flipY: number,
  pivotUV: Point,
  width: number,
  height: number,
) {
  let localXf = matIdentity();
  localXf = matTranslate(localXf, pivotStage.x, pivotStage.y);
  localXf = matRotate(localXf, worldRotationRad);
  localXf = matScale(localXf, flipX, flipY);
  localXf = matRotate(localXf, -intrinsicRotationRad);
  localXf = matTranslate(localXf, -pivotUV.x * width, -pivotUV.y * height);

  const effW = Math.max(4, Math.abs(flipX) * width);
  const effH = Math.max(4, Math.abs(flipY) * height);
  const effU = flipX < 0 ? 1 - pivotUV.x : pivotUV.x;
  const effV = flipY < 0 ? 1 - pivotUV.y : pivotUV.y;
  const pivotInBox: Point = { x: effU * effW, y: effV * effH };

  const isOddReflection = flipX * flipY < 0;
  const boxRotationRad =
    worldRotationRad + (isOddReflection ? intrinsicRotationRad : -intrinsicRotationRad);

  let boxXf = matIdentity();
  boxXf = matTranslate(boxXf, pivotStage.x, pivotStage.y);
  boxXf = matRotate(boxXf, boxRotationRad);
  boxXf = matTranslate(boxXf, -pivotInBox.x, -pivotInBox.y);

  return { localToStage: localXf, boxW: effW, boxH: effH, boxToStage: boxXf, pivotInBox };
}

function counterpartLimbSlot(slot: PuppetPartSlot): PuppetPartSlot | null {
  switch (slot) {
    case "leftUpperArm":
      return "rightUpperArm";
    case "rightUpperArm":
      return "leftUpperArm";
    case "leftForearm":
      return "rightForearm";
    case "rightForearm":
      return "leftForearm";
    case "leftThigh":
      return "rightThigh";
    case "rightThigh":
      return "leftThigh";
    case "leftShin":
      return "rightShin";
    case "rightShin":
      return "leftShin";
    case "leftFoot":
      return "rightFoot";
    case "rightFoot":
      return "leftFoot";
    default:
      return null;
  }
}

function resolvedMirrorTransform(
  rig: PuppetRigState,
  slot: PuppetPartSlot,
  fallbackSlot: PuppetPartSlot,
  needsMirror: boolean,
) {
  if (!needsMirror) {
    return {
      width: rig.partWidthScale[slot] ?? 1,
      height: rig.partHeightScale[slot] ?? 1,
      rotDeg: rig.partRotationOffset[slot] ?? 0,
      flipH: Boolean(rig.partFlipH[slot]),
      flipV: Boolean(rig.partFlipV[slot]),
    };
  }
  const ownW = rig.partWidthScale[slot];
  const ownH = rig.partHeightScale[slot];
  const ownR = rig.partRotationOffset[slot];
  return {
    width: ownW !== undefined ? ownW : (rig.partWidthScale[fallbackSlot] ?? 1),
    height: ownH !== undefined ? ownH : (rig.partHeightScale[fallbackSlot] ?? 1),
    rotDeg: ownR !== undefined ? ownR : -(rig.partRotationOffset[fallbackSlot] ?? 0),
    flipH:
      rig.partFlipH[slot] !== undefined
        ? Boolean(rig.partFlipH[slot])
        : !rig.partFlipH[fallbackSlot],
    flipV:
      rig.partFlipV[slot] !== undefined
        ? Boolean(rig.partFlipV[slot])
        : Boolean(rig.partFlipV[fallbackSlot]),
  };
}

function solveTwoBoneIKElbow(
  shoulder: Point,
  targetWrist: Point,
  len1: number,
  len2: number,
  isLeftArm: boolean,
  anatomyConstraints: number,
  poseShoulder: Point | null,
  poseElbow: Point | null,
): Point {
  const dx = targetWrist.x - shoulder.x;
  const dy = targetWrist.y - shoulder.y;
  const rawDist = Math.max(1, Math.hypot(dx, dy));
  const constraintLimit = 0.99 - anatomyConstraints * 0.04;
  const maxReach = (len1 + len2) * constraintLimit;
  const minReach = Math.abs(len1 - len2) + 4;
  const d = clamp(rawDist, minReach, maxReach);

  const baseAngle = Math.atan2(dy, dx);
  const cosA = clamp(
    (len1 * len1 + d * d - len2 * len2) / Math.max(1e-4, 2 * len1 * d),
    -1,
    1,
  );
  const bendAngle = Math.acos(cosA);

  const ptPlus: Point = {
    x: shoulder.x + Math.cos(baseAngle + bendAngle) * len1,
    y: shoulder.y + Math.sin(baseAngle + bendAngle) * len1,
  };
  const ptMinus: Point = {
    x: shoulder.x + Math.cos(baseAngle - bendAngle) * len1,
    y: shoulder.y + Math.sin(baseAngle - bendAngle) * len1,
  };

  const outSign = isLeftArm ? -1 : 1;
  const clampedWrist: Point = {
    x: shoulder.x + Math.cos(baseAngle) * d,
    y: shoulder.y + Math.sin(baseAngle) * d,
  };
  const midPt: Point = {
    x: (shoulder.x + clampedWrist.x) * 0.5,
    y: (shoulder.y + clampedWrist.y) * 0.5,
  };
  const poleDir: Point = { x: outSign * 0.68, y: 1.0 };
  const poleDotPlus = (ptPlus.x - midPt.x) * poleDir.x + (ptPlus.y - midPt.y) * poleDir.y;
  const poleDotMinus = (ptMinus.x - midPt.x) * poleDir.x + (ptMinus.y - midPt.y) * poleDir.y;
  const anatomicalChoice = poleDotPlus >= poleDotMinus ? ptPlus : ptMinus;

  if (
    poseShoulder &&
    poseElbow &&
    Math.hypot(poseElbow.x - poseShoulder.x, poseElbow.y - poseShoulder.y) > 14
  ) {
    const trackDirX = poseElbow.x - poseShoulder.x;
    const trackDirY = poseElbow.y - poseShoulder.y;
    const isChickenWing =
      trackDirY < -Math.abs(trackDirX) * 0.35 ||
      (outSign * trackDirX < -24 && trackDirY < 0);
    if (isChickenWing && anatomyConstraints > 0.35) {
      return anatomicalChoice;
    }
    const dotPlus = (ptPlus.x - shoulder.x) * trackDirX + (ptPlus.y - shoulder.y) * trackDirY;
    const dotMinus = (ptMinus.x - shoulder.x) * trackDirX + (ptMinus.y - shoulder.y) * trackDirY;
    return dotPlus >= dotMinus ? ptPlus : ptMinus;
  }

  return anatomicalChoice;
}

function buildLimbSegmentPart(
  rig: PuppetRigState,
  images: Partial<Record<PuppetPartSlot, HTMLImageElement>>,
  slot: PuppetPartSlot,
  startPinId: string,
  endPinId: string,
  startPt: Point,
  endPt: Point,
  naturalLength: number,
  thicknessScale: number,
  flipAcrossBone = false,
  localRotationRad = 0,
): PlacedStagePart | null {
  if (rig.partEnabled[slot] === false) return null;
  const hasDirect = Boolean(images[slot]);
  const cp = counterpartLimbSlot(slot);
  const hasFallback = Boolean(cp && images[cp]);
  if (!hasDirect && !hasFallback) return null;

  const activeSlot = hasDirect ? slot : cp!;
  const img = images[activeSlot];
  if (!img) return null;
  const needsMirror = !hasDirect && hasFallback;

  const pStart = getPin(rig, activeSlot, startPinId);
  const pEnd = getPin(rig, activeSlot, endPinId);

  const segDx = endPt.x - startPt.x;
  const segDy = endPt.y - startPt.y;
  const targetDist = Math.max(4, Math.hypot(segDx, segDy));
  const targetAngle = Math.atan2(segDy, segDx);
  const visualAngle = targetAngle + localRotationRad;

  const nw = Math.max(1, img.naturalWidth);
  const nh = Math.max(1, img.naturalHeight);
  const imgAspect = nw / nh;
  const rawPinDx = (pEnd.x - pStart.x) * imgAspect;
  const rawPinDy = pEnd.y - pStart.y;
  const normPinDist = Math.max(0.1, Math.hypot(rawPinDx, rawPinDy));

  let symmetricNormPinDist = normPinDist;
  if (cp && images[cp]) {
    const cpImg = images[cp]!;
    if (cpImg.naturalWidth === nw && cpImg.naturalHeight === nh) {
      const cpStart = getPin(rig, cp, startPinId);
      const cpEnd = getPin(rig, cp, endPinId);
      const cpDist = Math.max(
        0.1,
        Math.hypot((cpEnd.x - cpStart.x) * imgAspect, cpEnd.y - cpStart.y),
      );
      symmetricNormPinDist = (normPinDist + cpDist) * 0.5;
    }
  }

  const refLen = Math.max(4, naturalLength);
  const imgH = refLen / symmetricNormPinDist;
  const imgW = imgH * imgAspect;

  const actualPinDx = (pEnd.x - pStart.x) * imgW;
  const actualPinDy = (pEnd.y - pStart.y) * imgH;
  const pinAngle = Math.atan2(actualPinDy, actualPinDx);

  const xf = resolvedMirrorTransform(rig, slot, cp ?? slot, needsMirror);
  const flipH = xf.flipH ? -1 : 1;
  const flipV = xf.flipV ? -1 : 1;

  const alongBoneScale = (targetDist / refLen) * flipV;
  const defaultAcrossSign = needsMirror || flipAcrossBone ? -1 : 1;
  const acrossBoneScale = defaultAcrossSign * flipH * thicknessScale * xf.width;

  let localXf = matIdentity();
  localXf = matTranslate(localXf, startPt.x, startPt.y);
  localXf = matRotate(localXf, visualAngle);
  // Keep vertical-flipped limbs anchored between startPt and endPt instead of flipping backward out of joint
  if (flipV < 0) {
    localXf = matTranslate(localXf, targetDist, 0);
  }
  localXf = matScale(localXf, alongBoneScale, acrossBoneScale);
  localXf = matRotate(localXf, -pinAngle);
  localXf = matTranslate(localXf, -pStart.x * imgW, -pStart.y * imgH);

  const boxW = Math.max(22, imgW * thicknessScale * xf.width * 0.8);
  const boxH = Math.max(24, targetDist);
  const pivotInBox: Point = { x: boxW * 0.5, y: 0 };
  let boxXf = matIdentity();
  boxXf = matTranslate(boxXf, startPt.x, startPt.y);
  boxXf = matRotate(boxXf, visualAngle - Math.PI * 0.5);
  boxXf = matTranslate(boxXf, -boxW * 0.5, 0);

  return {
    slot,
    image: img,
    localW: imgW,
    localH: imgH,
    localToStage: localXf,
    boxW,
    boxH,
    boxToStage: boxXf,
    pivotInBox,
    draw: (ctx) => {
      ctx.save();
      applyMatToCtx(ctx, localXf);
      ctx.drawImage(img, 0, 0, imgW, imgH);
      ctx.restore();
    },
  };
}

function computeStageLayout(
  stageW: number,
  stageH: number,
  rig: PuppetRigState,
  images: Partial<Record<PuppetPartSlot, HTMLImageElement>>,
  activeFrame: TrackedFrame,
  cal: CalibrationBaseline,
  timeSec: number,
  anim: AnimSmoothState,
  updateSmoothing: boolean,
  selectedSlot: PuppetPartSlot,
  allowPartEditing: boolean,
): { result: StageLayoutResult; scaleDelta: number } {
  const fRaw = activeFrame.face;
  if (updateSmoothing) {
    const k = 0.28;
    anim.smoothHeadX = lerp(anim.smoothHeadX, fRaw.present ? fRaw.headX : 0, k);
    anim.smoothHeadY = lerp(anim.smoothHeadY, fRaw.present ? fRaw.headY : 0, k);
    anim.smoothRoll = lerp(anim.smoothRoll, fRaw.present ? fRaw.roll : 0, k);
    anim.smoothYaw = lerp(anim.smoothYaw, fRaw.present ? fRaw.yaw : 0, k);
    anim.smoothPitch = lerp(anim.smoothPitch, fRaw.present ? fRaw.pitch : 0, k);
    anim.smoothMouth = lerp(anim.smoothMouth, fRaw.present ? fRaw.mouthOpen : 0, 0.38);
    anim.smoothSmile = lerp(anim.smoothSmile, fRaw.present ? fRaw.mouthSmile : 0, 0.32);
    anim.smoothPucker = lerp(anim.smoothPucker, fRaw.present ? fRaw.mouthPucker : 0, 0.32);
    anim.smoothBrow = lerp(anim.smoothBrow, fRaw.present ? fRaw.browRaise : 0, 0.32);
    anim.smoothFurrow = lerp(anim.smoothFurrow, fRaw.present ? fRaw.browFurrow : 0, 0.32);
    anim.smoothBlinkL = lerp(anim.smoothBlinkL, fRaw.present ? fRaw.eyeBlinkL : 0, 0.48);
    anim.smoothBlinkR = lerp(anim.smoothBlinkR, fRaw.present ? fRaw.eyeBlinkR : 0, 0.48);
  }

  const charScale = rig.characterScale;
  const moveX = anim.smoothHeadX * rig.headMoveAmount * (stageW * 0.16);
  const moveY = anim.smoothHeadY * rig.headMoveAmount * (stageH * 0.14);
  const rawScaleDelta = rig.showFullBodyLegs
    ? 1.0
    : 1.0 + ((fRaw.present ? fRaw.headScale : 1.0) - 1.0) * rig.headScaleAmount;
  const clampedScale = clamp(rawScaleDelta, 0.6, 1.55);
  const offsetUnit = Math.max(40, stageH * charScale * clampedScale);

  const rollAngle = anim.smoothRoll * rig.headTiltAmount;
  const headTurn = anim.smoothYaw * rig.headTurnParallax;
  const headNod = anim.smoothPitch * rig.headTurnParallax;
  const bodyTurn = headTurn * rig.bodyTurnAmount;

  const pose = activeFrame.poseLandmarks;
  const poseFresh = activeFrame.poseJointFresh;
  const frameAspect = Math.max(0.35, activeFrame.frameAspect || 16 / 9);
  const isoUnit = stageH;
  const isoXShift = (stageW - stageH * frameAspect) * 0.5;

  // Note: activeFrame.poseLandmarks ALREADY has mirror applied in useHolisticTracker.ts!
  const posePt = (idx: number, requireFresh = false): Point | null => {
    if (!pose || idx >= pose.length || !pose[idx]) return null;
    if (requireFresh && idx < poseFresh.length && !poseFresh[idx]) return null;
    const lm = pose[idx];
    return {
      x: isoXShift + lm.x * frameAspect * isoUnit,
      y: lm.y * isoUnit,
    };
  };

  // Screen-X sorted left/right pose indices so mirrored webcam & unmirrored reference video both match screen sides!
  let leftShIdx = 11;
  let rightShIdx = 12;
  if (pose && pose.length >= 17) {
    if (pose[11].x > pose[12].x) {
      leftShIdx = 12;
      rightShIdx = 11;
    }
  }

  let torsoRoll = rollAngle * 0.22 + bodyTurn * 0.08;
  const lsPt = posePt(leftShIdx);
  const rsPt = posePt(rightShIdx);
  if (lsPt && rsPt) {
    const dx = rsPt.x - lsPt.x;
    const dy = rsPt.y - lsPt.y;
    if (dx > stageW * 0.12 && Math.abs(dy) < dx * 0.45) {
      const poseTilt = clamp(Math.atan2(dy, dx), -0.18, 0.18);
      torsoRoll = torsoRoll * 0.72 + poseTilt * 0.28;
    }
  }

  const baseCenterY = rig.showFullBodyLegs ? 0.36 : 0.62;
  const torsoHeightFactor = 0.9;
  const legLenMult = rig.legLengthScale;
  const legThickMult = rig.legThicknessScale;
  const armLenMult = rig.armLengthScale;
  const armThickMult = rig.armThicknessScale;

  const neckMountUV = getPin(rig, "torso", "neckMount");
  const lShoulderUV = getPin(rig, "torso", "leftShoulder");
  const rShoulderUV = getPin(rig, "torso", "rightShoulder");
  const waistUV = getPin(rig, "torso", "waistPivot");

  const neutralRefHeadH = stageH * charScale * 0.92;
  const neutralRefTorsoH = neutralRefHeadH * torsoHeightFactor;
  const neutralTorsoH = neutralRefTorsoH * (rig.partHeightScale.torso ?? 1);

  let neutralNeckToHipY = 0;
  if (rig.partEnabled.pelvis && images.pelvis) {
    const waistDy = (waistUV.y - neckMountUV.y) * neutralTorsoH;
    const pelvisH0 = neutralRefTorsoH * 0.44 * (rig.partHeightScale.pelvis ?? 1);
    const wJointUV = getPin(rig, "pelvis", "waistJoint");
    const lhUV = getPin(rig, "pelvis", "leftHip");
    const rhUV = getPin(rig, "pelvis", "rightHip");
    neutralNeckToHipY = waistDy + ((lhUV.y + rhUV.y) * 0.5 - wJointUV.y) * pelvisH0;
  } else {
    const lhY = rig.pinsBySlot.torso?.find((p) => p.id === "leftHip")?.y ?? 0.88;
    const rhY = rig.pinsBySlot.torso?.find((p) => p.id === "rightHip")?.y ?? 0.88;
    neutralNeckToHipY = ((lhY + rhY) * 0.5 - neckMountUV.y) * neutralTorsoH;
  }

  const avgThighHScale =
    ((rig.partHeightScale.leftThigh ?? 1) + (rig.partHeightScale.rightThigh ?? 1)) * 0.5;
  const avgShinHScale =
    ((rig.partHeightScale.leftShin ?? 1) + (rig.partHeightScale.rightShin ?? 1)) * 0.5;
  const neutralLegDrop =
    neutralRefTorsoH * 0.5 * legLenMult * (avgThighHScale * 0.975 + avgShinHScale * 0.965);
  const neutralNeckToAnkle = Math.max(20, neutralNeckToHipY + neutralLegDrop);
  const groundAnkleY = stageH * baseCenterY + rig.stageOffsetY + neutralNeckToAnkle;

  let resolvedNeckStageY: number;
  if (rig.showFullBodyLegs) {
    const standingNeckY = groundAnkleY - neutralNeckToAnkle * clampedScale;
    const crouchDropY = clamp(moveY, 0, neutralLegDrop * clampedScale * 0.44);
    resolvedNeckStageY = standingNeckY + crouchDropY;
  } else {
    resolvedNeckStageY = stageH * baseCenterY + rig.stageOffsetY + moveY;
  }

  const baseStageOriginX = stageW * 0.5 + rig.stageOffsetX;
  const baseNeckStage: Point = {
    x: baseStageOriginX + moveX,
    y: resolvedNeckStageY,
  };

  const refHeadH = neutralRefHeadH * clampedScale;
  const headH = refHeadH * (rig.partHeightScale.head ?? 1);

  const torsoImg = images.torso;
  const torsoAspect =
    (torsoImg?.naturalWidth ?? 512) / Math.max(1, torsoImg?.naturalHeight ?? 440);
  const refTorsoH = refHeadH * torsoHeightFactor;
  const torsoH = refTorsoH * (rig.partHeightScale.torso ?? 1);
  const torsoPerspectiveScaleX = Math.max(0.84, 1 - Math.abs(bodyTurn) * 0.06);
  const torsoW = torsoH * torsoAspect * torsoPerspectiveScaleX * (rig.partWidthScale.torso ?? 1);

  const followMove = rig.followChildrenOnMove;
  const followRotate = rig.followChildrenOnRotate;

  const torsoOffX = rig.partOffsetX.torso ?? 0;
  const torsoOffY = rig.partOffsetY.torso ?? 0;
  const torsoChainMove: Point = followMove
    ? { x: torsoOffX * offsetUnit, y: torsoOffY * offsetUnit }
    : { x: 0, y: 0 };
  const torsoManualRotRad = ((rig.partRotationOffset.torso ?? 0) * Math.PI) / 180;
  const torsoChainRotRad = followRotate ? torsoManualRotRad : 0;
  const chainNeckStage: Point = {
    x: baseNeckStage.x + torsoChainMove.x,
    y: baseNeckStage.y + torsoChainMove.y,
  };
  const chainTorsoRoll = torsoRoll + torsoChainRotRad;

  const torsoUVToStage = (uv: Point, depthFactor = 0): Point => {
    const turnOffsetX = bodyTurn * torsoW * 0.055 * depthFactor;
    const lx = (uv.x - neckMountUV.x) * torsoW + turnOffsetX;
    const ly = (uv.y - neckMountUV.y) * torsoH;
    const c = Math.cos(chainTorsoRoll);
    const s = Math.sin(chainTorsoRoll);
    return {
      x: chainNeckStage.x + lx * c - ly * s,
      y: chainNeckStage.y + lx * s + ly * c,
    };
  };

  const leftShoulderStage = torsoUVToStage(lShoulderUV, 0.8);
  const rightShoulderStage = torsoUVToStage(rShoulderUV, 0.8);
  const waistStage = torsoUVToStage(waistUV, -0.3);

  const partsBySlot: Partial<Record<PuppetPartSlot, PlacedStagePart>> = {};
  const stagePins: { point: Point; color: string }[] = [];
  const handChains: { wristStage: Point; hand: TrackedHand; visualScale: number }[] = [];

  // ── 1. TORSO ──
  if (rig.partEnabled.torso && torsoImg) {
    const pivotPt: Point = {
      x: baseNeckStage.x + torsoOffX * offsetUnit,
      y: baseNeckStage.y + torsoOffY * offsetUnit,
    };
    const xfData = makeAnchoredTransform(
      pivotPt,
      torsoRoll + torsoManualRotRad,
      rig.partFlipH.torso ? -1 : 1,
      rig.partFlipV.torso ? -1 : 1,
      neckMountUV,
      torsoW,
      torsoH,
    );
    partsBySlot.torso = {
      slot: "torso",
      image: torsoImg,
      localW: torsoW,
      localH: torsoH,
      localToStage: xfData.localToStage,
      boxW: xfData.boxW,
      boxH: xfData.boxH,
      boxToStage: xfData.boxToStage,
      pivotInBox: xfData.pivotInBox,
      draw: (ctx) => {
        ctx.save();
        applyMatToCtx(ctx, xfData.localToStage);
        ctx.drawImage(torsoImg, 0, 0, torsoW, torsoH);
        ctx.restore();
      },
    };
    stagePins.push(
      { point: chainNeckStage, color: "#facc15" },
      { point: leftShoulderStage, color: "#fb923c" },
      { point: rightShoulderStage, color: "#fb923c" },
      { point: waistStage, color: "#fb923c" },
    );
  }

  // ── 2. HEAD & FACIAL FEATURES ──
  const headImg = images.head;
  if (rig.partEnabled.head && headImg) {
    const neckUV = getPin(rig, "head", "neckPivot");
    const lBrowUV = getPin(rig, "head", "leftBrow");
    const rBrowUV = getPin(rig, "head", "rightBrow");
    const lEyeUV = getPin(rig, "head", "leftEye");
    const rEyeUV = getPin(rig, "head", "rightEye");
    const noseUV = getPin(rig, "head", "noseCenter");
    const mouthUV = getPin(rig, "head", "mouthCenter");
    const jawUV = getPin(rig, "head", "jawChin");

    const headAspect = headImg.naturalWidth / Math.max(1, headImg.naturalHeight);
    const headPerspScaleX = Math.max(0.85, 1 - Math.abs(headTurn) * 0.065);
    const headPartW = rig.partWidthScale.head ?? 1;
    const headPartRotRad = ((rig.partRotationOffset.head ?? 0) * Math.PI) / 180;
    const headW = headH * headAspect * headPerspScaleX * headPartW;
    const headTurnBaseShiftX = headTurn * (headW * 0.035);

    const hOffX = rig.partOffsetX.head ?? 0;
    const hOffY = rig.partOffsetY.head ?? 0;
    const headPivotPt: Point = {
      x: chainNeckStage.x + headTurnBaseShiftX + hOffX * offsetUnit,
      y: chainNeckStage.y + hOffY * offsetUnit,
    };

    const xfData = makeAnchoredTransform(
      headPivotPt,
      rollAngle + torsoChainRotRad + headPartRotRad,
      rig.partFlipH.head ? -1 : 1,
      rig.partFlipV.head ? -1 : 1,
      neckUV,
      headW,
      headH,
    );

    const browY = (lBrowUV.y + rBrowUV.y) * 0.5;
    const mouthY = mouthUV.y;
    const jawY = Math.max(mouthY + 0.05, jawUV.y);
    const effJawWarp =
      rig.mouthAnimationMode === "sprites" || !rig.jawWarpEnabled ? 0 : rig.jawWarpAmount;
    const jawOpenPx = anim.smoothMouth * effJawWarp * (headH * 0.13);
    const smileWidthFactor =
      1 + (anim.smoothSmile - anim.smoothPucker * 0.6) * 0.07 * effJawWarp;
    const browLiftPx =
      (anim.smoothBrow - anim.smoothFurrow * 0.6) * rig.browWarpAmount * (headH * 0.055);
    const featureTurnShiftX = headTurn * (headW * 0.068);
    const featureNodShiftY = headNod * (headH * 0.042);

    const verticalDeformAt = (v: number) => {
      let dy = 0;
      const browDist = (v - browY) / 0.09;
      dy -= browLiftPx * Math.exp(-(browDist * browDist));
      let wScale = 1;
      if (v > mouthY) {
        const jp = Math.min(1, (v - mouthY) / Math.max(0.05, jawY - mouthY));
        const smooth = jp * jp * (3 - 2 * jp);
        dy += jawOpenPx * smooth;
        const mDist = (v - mouthY) / 0.08;
        wScale = 1 + (smileWidthFactor - 1) * Math.exp(-(mDist * mDist));
      }
      return { dy, wScale };
    };

    const featurePosition = (uv: Point, depthMul: number): Point => {
      const vd = verticalDeformAt(uv.y);
      return {
        x: uv.x * headW + featureTurnShiftX * depthMul,
        y: uv.y * headH + vd.dy + featureNodShiftY * depthMul,
      };
    };

    partsBySlot.head = {
      slot: "head",
      image: headImg,
      localW: headW,
      localH: headH,
      localToStage: xfData.localToStage,
      boxW: xfData.boxW,
      boxH: xfData.boxH,
      boxToStage: xfData.boxToStage,
      pivotInBox: xfData.pivotInBox,
      draw: (ctx) => {
        ctx.save();
        applyMatToCtx(ctx, xfData.localToStage);

        // Head base (24-strip deformation when jaw/brow warp active)
        const nw = headImg.naturalWidth;
        const nh = headImg.naturalHeight;
        if (Math.abs(jawOpenPx) < 0.25 && Math.abs(browLiftPx) < 0.25) {
          ctx.drawImage(headImg, 0, 0, headW, headH);
        } else {
          const strips = 24;
          for (let i = 0; i < strips; i++) {
            const v0 = i / strips;
            const v1 = (i + 1) / strips;
            const d0 = verticalDeformAt(v0);
            const d1 = verticalDeformAt(v1);
            const dstY0 = v0 * headH + d0.dy;
            const dstY1 = v1 * headH + d1.dy;
            const dstH = Math.max(0.5, dstY1 - dstY0 + 0.65);
            const avgW = (d0.wScale + d1.wScale) * 0.5;
            const scaledW = headW * avgW;
            const dstX = (headW - scaledW) * 0.5;
            ctx.drawImage(
              headImg,
              0,
              v0 * nh,
              nw,
              Math.max(1, (v1 - v0) * nh),
              dstX,
              dstY0,
              scaledW,
              dstH,
            );
          }
        }

        // Auto-blink pulse
        let autoBlinkPulse = 0;
        if (rig.autoBlinkEnabled) {
          const cycle = timeSec % 3.8;
          if (cycle < 0.14) autoBlinkPulse = Math.sin((cycle / 0.14) * Math.PI);
        }
        const blinkL = Math.max(anim.smoothBlinkL, autoBlinkPulse);
        const blinkR = Math.max(anim.smoothBlinkR, autoBlinkPulse);
        const threshold = rig.blinkThreshold;

        // Eyes (exact 0.195 baseFactor matching PuppetStudioView.swift!)
        const eyeItems = [
          { uv: lEyeUV, blink: blinkL, isRight: false },
          { uv: rEyeUV, blink: blinkR, isRight: true },
        ];
        for (const eyeItem of eyeItems) {
          const eyePt = featurePosition(eyeItem.uv, 1.0);
          const isClosed = eyeItem.blink >= threshold;
          const sideSign = eyeItem.isRight ? 1 : -1;
          const eyeTurnPersp = clamp(1 - sideSign * headTurn * 0.12, 0.76, 1.12);

          if (rig.eyeAnimationMode === "squash") {
            if (eyeItem.blink > 0.15) {
              const lidW = headW * 0.15 * rig.eyeSpriteScale * eyeTurnPersp;
              const lidH = headH * 0.09 * Math.min(1, eyeItem.blink) * rig.eyeSpriteScale;
              ctx.save();
              ctx.fillStyle = "#e0b899";
              ctx.beginPath();
              ctx.ellipse(eyePt.x, eyePt.y, lidW * 0.5, lidH * 0.5, 0, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          } else {
            const eyeSlot: PuppetPartSlot = eyeItem.isRight
              ? isClosed
                ? "rightEyeClosed"
                : "rightEyeOpen"
              : isClosed
                ? "eyesClosed"
                : "eyesOpen";
            const fallbackSlot: PuppetPartSlot = isClosed ? "eyesClosed" : "eyesOpen";
            const chosen = images[eyeSlot] ?? images[fallbackSlot];
            const openSlot: PuppetPartSlot = eyeItem.isRight ? "rightEyeOpen" : "eyesOpen";
            const openFallback = images[openSlot] ?? images.eyesOpen;
            const usingSquashedOpen =
              isClosed && !chosen && rig.partEnabled[openSlot] !== false && Boolean(openFallback);
            const activeSprite = chosen ?? (usingSquashedOpen ? openFallback : undefined);
            const mirrorLToR =
              eyeItem.isRight &&
              (chosen
                ? !images[eyeSlot] && Boolean(images[fallbackSlot])
                : usingSquashedOpen && !images.rightEyeOpen && Boolean(images.eyesOpen));

            const slotEnabled =
              rig.partEnabled[eyeSlot] !== false ||
              (usingSquashedOpen && rig.partEnabled[openSlot] !== false);
            if (slotEnabled && activeSprite) {
              const widthSlot = usingSquashedOpen ? openSlot : eyeSlot;
              const mirrorSrc = usingSquashedOpen ? "eyesOpen" : fallbackSlot;
              const eXf = resolvedMirrorTransform(rig, widthSlot, mirrorSrc, mirrorLToR);
              const imgAspect =
                activeSprite.naturalHeight / Math.max(1, activeSprite.naturalWidth);
              const baseEyeW =
                headW * 0.195 * rig.eyeSpriteScale * eXf.width * eyeTurnPersp;
              const baseEyeH =
                headW * 0.195 * rig.eyeSpriteScale * imgAspect * eXf.height;
              let squashY = 1;
              if (usingSquashedOpen) squashY = 0.14;
              else if (rig.eyeAnimationMode === "hybrid" && !isClosed) {
                const t = Math.min(1, eyeItem.blink / Math.max(0.1, threshold));
                squashY = Math.max(0.35, 1 - t * 0.55);
              }

              ctx.save();
              ctx.translate(eyePt.x, eyePt.y);
              ctx.rotate((eXf.rotDeg * Math.PI) / 180);
              ctx.scale(
                (mirrorLToR ? -1 : 1) * (eXf.flipH ? -1 : 1),
                eXf.flipV ? -1 : 1,
              );
              const drawH = baseEyeH * squashY;
              ctx.drawImage(activeSprite, -baseEyeW * 0.5, -drawH * 0.5, baseEyeW, drawH);
              ctx.restore();
            }
          }
        }

        // Brows (exact 0.26 / 0.52 factor matching PuppetStudioView.swift)
        const lBrowImg = images.browsOverlay;
        const rBrowImg = images.rightBrows ?? lBrowImg;
        if (lBrowImg && rig.partEnabled.browsOverlay !== false) {
          const isWideBar =
            lBrowImg.naturalWidth / Math.max(1, lBrowImg.naturalHeight) > 2.2;
          if (isWideBar && !images.rightBrows) {
            const bPt = featurePosition(
              { x: (lBrowUV.x + rBrowUV.x) * 0.5, y: browY },
              1.05,
            );
            const bw = headW * 0.52 * (rig.partWidthScale.browsOverlay ?? 1);
            const bh =
              headW *
              0.52 *
              (lBrowImg.naturalHeight / Math.max(1, lBrowImg.naturalWidth)) *
              (rig.partHeightScale.browsOverlay ?? 1);
            ctx.save();
            ctx.translate(bPt.x, bPt.y);
            ctx.rotate(((rig.partRotationOffset.browsOverlay ?? 0) * Math.PI) / 180);
            ctx.drawImage(lBrowImg, -bw * 0.5, -bh * 0.5, bw, bh);
            ctx.restore();
          } else {
            const bPt = featurePosition(lBrowUV, 1.05);
            const bw = headW * 0.26 * (rig.partWidthScale.browsOverlay ?? 1);
            const bh =
              headW *
              0.26 *
              (lBrowImg.naturalHeight / Math.max(1, lBrowImg.naturalWidth)) *
              (rig.partHeightScale.browsOverlay ?? 1);
            ctx.save();
            ctx.translate(bPt.x, bPt.y);
            ctx.rotate(((rig.partRotationOffset.browsOverlay ?? 0) * Math.PI) / 180);
            ctx.scale(
              rig.partFlipH.browsOverlay ? -1 : 1,
              rig.partFlipV.browsOverlay ? -1 : 1,
            );
            ctx.drawImage(lBrowImg, -bw * 0.5, -bh * 0.5, bw, bh);
            ctx.restore();

            if (rBrowImg && rig.partEnabled.rightBrows !== false) {
              const mirrorR = !images.rightBrows;
              const bXf = resolvedMirrorTransform(
                rig,
                "rightBrows",
                "browsOverlay",
                mirrorR,
              );
              const rbPt = featurePosition(rBrowUV, 1.05);
              const rbw = headW * 0.26 * bXf.width;
              const rbh =
                headW *
                0.26 *
                (rBrowImg.naturalHeight / Math.max(1, rBrowImg.naturalWidth)) *
                bXf.height;
              ctx.save();
              ctx.translate(rbPt.x, rbPt.y);
              ctx.rotate((bXf.rotDeg * Math.PI) / 180);
              ctx.scale(
                (mirrorR ? -1 : 1) * (bXf.flipH ? -1 : 1),
                bXf.flipV ? -1 : 1,
              );
              ctx.drawImage(rBrowImg, -rbw * 0.5, -rbh * 0.5, rbw, rbh);
              ctx.restore();
            }
          }
        }

        // Mouth Visemes (exact 0.29 factor matching PuppetStudioView.swift)
        if (rig.mouthAnimationMode !== "warp") {
          const hasValidMouth = (s: PuppetPartSlot) =>
            rig.partEnabled[s] === true && Boolean(images[s]);
          let candidates: PuppetPartSlot[] = [
            "mouthNeutral",
            "mouthSmile",
            "mouthAh",
            "mouthOh",
          ];
          if (fRaw.viseme === "ah" || fRaw.viseme === "wide") {
            candidates = ["mouthAh", "mouthOh", "mouthNeutral", "mouthSmile"];
          } else if (fRaw.viseme === "oh") {
            candidates = ["mouthOh", "mouthAh", "mouthNeutral", "mouthSmile"];
          } else if (fRaw.viseme === "smile") {
            candidates = ["mouthSmile", "mouthNeutral", "mouthAh", "mouthOh"];
          }
          const activeMouth = candidates.find(hasValidMouth);
          if (activeMouth && images[activeMouth]) {
            const mImg = images[activeMouth]!;
            const mOffX = rig.partOffsetX[activeMouth] ?? 0;
            const mOffY = rig.partOffsetY[activeMouth] ?? 0;
            const baseMPt = featurePosition(mouthUV, 1.15);
            const mPt = {
              x: baseMPt.x + mOffX * offsetUnit,
              y: baseMPt.y + mOffY * offsetUnit,
            };
            const mAnchor = getPin(rig, activeMouth, "mouthAnchor");
            const baseMW =
              headW * 0.29 * rig.mouthSpriteScale * (rig.partWidthScale[activeMouth] ?? 1);
            const baseMH =
              headW *
              0.29 *
              rig.mouthSpriteScale *
              (mImg.naturalHeight / Math.max(1, mImg.naturalWidth)) *
              (rig.partHeightScale[activeMouth] ?? 1);
            const tweenSX =
              rig.mouthAnimationMode === "hybrid"
                ? 1 + anim.smoothSmile * 0.18 - anim.smoothPucker * 0.16
                : 1;
            const tweenSY =
              rig.mouthAnimationMode === "hybrid" && fRaw.viseme !== "neutral"
                ? 0.85 + anim.smoothMouth * 0.45
                : 1;
            const mw = baseMW * tweenSX;
            const mh = baseMH * tweenSY;
            ctx.save();
            ctx.translate(mPt.x, mPt.y);
            ctx.rotate(((rig.partRotationOffset[activeMouth] ?? 0) * Math.PI) / 180);
            ctx.scale(
              rig.partFlipH[activeMouth] ? -1 : 1,
              rig.partFlipV[activeMouth] ? -1 : 1,
            );
            ctx.drawImage(mImg, -mw * mAnchor.x, -mh * (mAnchor.y - 0.05), mw, mh);
            ctx.restore();
          }
        }

        // Nose Overlay (exact 0.145 factor matching PuppetStudioView.swift)
        if (rig.partEnabled.noseOverlay && images.noseOverlay) {
          const nImg = images.noseOverlay;
          const nOffX = rig.partOffsetX.noseOverlay ?? 0;
          const nOffY = rig.partOffsetY.noseOverlay ?? 0;
          const baseNPt = featurePosition(noseUV, 1.45);
          const nPt = {
            x: baseNPt.x + nOffX * offsetUnit,
            y: baseNPt.y + nOffY * offsetUnit,
          };
          const nAnchor = getPin(rig, "noseOverlay", "noseAnchor");
          const refNW = headW * 0.145 * rig.noseSpriteScale;
          const nwPx = refNW * (rig.partWidthScale.noseOverlay ?? 1);
          const nhPx =
            refNW *
            (nImg.naturalHeight / Math.max(1, nImg.naturalWidth)) *
            (rig.partHeightScale.noseOverlay ?? 1);
          ctx.save();
          ctx.translate(nPt.x, nPt.y);
          ctx.rotate(((rig.partRotationOffset.noseOverlay ?? 0) * Math.PI) / 180);
          ctx.scale(
            rig.partFlipH.noseOverlay ? -1 : 1,
            rig.partFlipV.noseOverlay ? -1 : 1,
          );
          ctx.drawImage(nImg, -nwPx * nAnchor.x, -nhPx * nAnchor.y, nwPx, nhPx);
          ctx.restore();
        }

        ctx.restore();
      },
    };
  }

  // ── 3. TAIL ──
  if (rig.partEnabled.tail && images.tail) {
    const tailImg = images.tail;
    const tailBaseUV = getPin(rig, "tail", "tailBase");
    const tailH = refTorsoH * 0.72 * (rig.partHeightScale.tail ?? 1);
    const tailAspect = tailImg.naturalWidth / Math.max(1, tailImg.naturalHeight);
    const tailW = tailH * tailAspect * (rig.partWidthScale.tail ?? 1);
    const tOffX = rig.partOffsetX.tail ?? 0;
    const tOffY = rig.partOffsetY.tail ?? 0;
    const tailAttach: Point = {
      x: waistStage.x - bodyTurn * torsoW * 0.09 + tOffX * offsetUnit,
      y: waistStage.y + tOffY * offsetUnit,
    };
    const idleWag = Math.sin(timeSec * 2.6) * 0.07 * rig.idleMotionAmount;
    const wagAngle =
      idleWag -
      bodyTurn * 0.18 +
      chainTorsoRoll * 0.5 +
      ((rig.partRotationOffset.tail ?? 0) * Math.PI) / 180;
    const xfData = makeAnchoredTransform(
      tailAttach,
      wagAngle,
      rig.partFlipH.tail ? -1 : 1,
      rig.partFlipV.tail ? -1 : 1,
      tailBaseUV,
      tailW,
      tailH,
    );
    partsBySlot.tail = {
      slot: "tail",
      image: tailImg,
      localW: tailW,
      localH: tailH,
      localToStage: xfData.localToStage,
      boxW: xfData.boxW,
      boxH: xfData.boxH,
      boxToStage: xfData.boxToStage,
      pivotInBox: xfData.pivotInBox,
      draw: (ctx) => {
        ctx.save();
        applyMatToCtx(ctx, xfData.localToStage);
        ctx.drawImage(tailImg, 0, 0, tailW, tailH);
        ctx.restore();
      },
    };
    stagePins.push({ point: tailAttach, color: "#34d399" });
  }

  // ── 4. PELVIS & 3-PART LEGS (with Full FK/IK Chain) ──
  if (rig.showFullBodyLegs) {
    const pelvisImg = images.pelvis;
    const hasPelvis = rig.partEnabled.pelvis && Boolean(pelvisImg);
    const pelvisRoll = torsoRoll * 0.5;
    const pOffX = rig.partOffsetX.pelvis ?? 0;
    const pOffY = rig.partOffsetY.pelvis ?? 0;
    const pelvisChainMove: Point =
      hasPelvis && followMove
        ? { x: pOffX * offsetUnit, y: pOffY * offsetUnit }
        : { x: 0, y: 0 };
    const pelvisManualRotRad = hasPelvis
      ? ((rig.partRotationOffset.pelvis ?? 0) * Math.PI) / 180
      : 0;
    const pelvisChainRotRad = followRotate ? pelvisManualRotRad : 0;
    const parentLegRotRad = torsoChainRotRad + pelvisChainRotRad;

    const refPelvisH = refTorsoH * 0.44 * (rig.partHeightScale.pelvis ?? 1);
    const pelvisAspect =
      (pelvisImg?.naturalWidth ?? 360) / Math.max(1, pelvisImg?.naturalHeight ?? 180);
    const pelvisW =
      refPelvisH * pelvisAspect * torsoPerspectiveScaleX * (rig.partWidthScale.pelvis ?? 1);
    const waistJointUV = getPin(rig, "pelvis", "waistJoint");
    const lHipUV = getPin(rig, "pelvis", "leftHip");
    const rHipUV = getPin(rig, "pelvis", "rightHip");

    if (hasPelvis && pelvisImg) {
      const pPivot: Point = {
        x: waistStage.x + pOffX * offsetUnit,
        y: waistStage.y + pOffY * offsetUnit,
      };
      const xfData = makeAnchoredTransform(
        pPivot,
        pelvisRoll + torsoChainRotRad + pelvisManualRotRad,
        rig.partFlipH.pelvis ? -1 : 1,
        rig.partFlipV.pelvis ? -1 : 1,
        waistJointUV,
        pelvisW,
        refPelvisH,
      );
      partsBySlot.pelvis = {
        slot: "pelvis",
        image: pelvisImg,
        localW: pelvisW,
        localH: refPelvisH,
        localToStage: xfData.localToStage,
        boxW: xfData.boxW,
        boxH: xfData.boxH,
        boxToStage: xfData.boxToStage,
        pivotInBox: xfData.pivotInBox,
        draw: (ctx) => {
          ctx.save();
          applyMatToCtx(ctx, xfData.localToStage);
          ctx.drawImage(pelvisImg, 0, 0, pelvisW, refPelvisH);
          ctx.restore();
        },
      };
    }

    const pelvisUVToStage = (uv: Point): Point => {
      if (!hasPelvis) {
        const hipPinId = uv.x < 0.5 ? "leftHip" : "rightHip";
        const torsoHip = rig.pinsBySlot.torso?.find((p) => p.id === hipPinId);
        if (torsoHip) return torsoUVToStage({ x: torsoHip.x, y: torsoHip.y }, 0.4);
        return torsoUVToStage({ x: uv.x < 0.5 ? 0.34 : 0.66, y: 0.88 }, 0.4);
      }
      const lx = (uv.x - waistJointUV.x) * pelvisW;
      const ly = (uv.y - waistJointUV.y) * refPelvisH;
      const effRoll = pelvisRoll + parentLegRotRad;
      const c = Math.cos(effRoll);
      const s = Math.sin(effRoll);
      return {
        x: waistStage.x + pelvisChainMove.x + lx * c - ly * s,
        y: waistStage.y + pelvisChainMove.y + lx * s + ly * c,
      };
    };

    const leftHipStage = pelvisUVToStage(lHipUV);
    const rightHipStage = pelvisUVToStage(rHipUV);
    stagePins.push(
      { point: leftHipStage, color: "#22d3ee" },
      { point: rightHipStage, color: "#22d3ee" },
    );

    const baseThighLen = refTorsoH * 0.5;
    const baseShinLen = refTorsoH * 0.5;

    const legSides: {
      isRight: boolean;
      hipStage: Point;
      thighSlot: PuppetPartSlot;
      shinSlot: PuppetPartSlot;
      footSlot: PuppetPartSlot;
    }[] = [
      { isRight: true, hipStage: rightHipStage, thighSlot: "rightThigh", shinSlot: "rightShin", footSlot: "rightFoot" },
      { isRight: false, hipStage: leftHipStage, thighSlot: "leftThigh", shinSlot: "leftShin", footSlot: "leftFoot" },
    ];

    for (const side of legSides) {
      const hasShin =
        rig.partEnabled[side.shinSlot] !== false &&
        Boolean(images[side.shinSlot] || images.leftShin);
      const thighLen = baseThighLen * legLenMult * (rig.partHeightScale[side.thighSlot] ?? 1);
      const shinLen = baseShinLen * legLenMult * (rig.partHeightScale[side.shinSlot] ?? 1);
      const sideSign = side.isRight ? 1 : -1;

      let restHipOffsetX: number;
      if (hasPelvis) {
        const hipUV = side.isRight ? rHipUV : lHipUV;
        restHipOffsetX =
          (waistUV.x - neckMountUV.x) * torsoW + (hipUV.x - waistJointUV.x) * pelvisW;
      } else {
        const hipPinId = side.isRight ? "rightHip" : "leftHip";
        const hx =
          rig.pinsBySlot.torso?.find((p) => p.id === hipPinId)?.x ??
          (side.isRight ? 0.66 : 0.34);
        restHipOffsetX = (hx - neckMountUV.x) * torsoW;
      }

      const groundedAnkleStage: Point = {
        x:
          baseStageOriginX +
          torsoChainMove.x +
          pelvisChainMove.x +
          moveX * 0.85 +
          restHipOffsetX +
          sideSign * thighLen * 0.08,
        y: groundAnkleY + torsoChainMove.y + pelvisChainMove.y,
      };

      // Solve grounded or lifted leg target (exact port of buildLegJointTarget)
      const solveGroundedKnee = (targetAnkle: Point): { knee: Point; ankle: Point } => {
        const dx = targetAnkle.x - side.hipStage.x;
        const dy = targetAnkle.y - side.hipStage.y;
        const rawDist = Math.max(1, Math.hypot(dx, dy));
        const maxReach = (thighLen + shinLen) * 0.992;
        const minReach = Math.abs(thighLen - shinLen) + 4;
        const d = clamp(rawDist, minReach, maxReach);
        const clampedAnkle: Point =
          rawDist > maxReach
            ? {
                x: side.hipStage.x + (dx / rawDist) * maxReach,
                y: side.hipStage.y + (dy / rawDist) * maxReach,
              }
            : targetAnkle;
        const baseAng = Math.atan2(
          clampedAnkle.y - side.hipStage.y,
          clampedAnkle.x - side.hipStage.x,
        );
        const cosA = clamp(
          (thighLen * thighLen + d * d - shinLen * shinLen) /
            Math.max(1e-4, 2 * thighLen * d),
          -1,
          1,
        );
        const bend = Math.acos(cosA);
        const pPlus: Point = {
          x: side.hipStage.x + Math.cos(baseAng + bend) * thighLen,
          y: side.hipStage.y + Math.sin(baseAng + bend) * thighLen,
        };
        const pMinus: Point = {
          x: side.hipStage.x + Math.cos(baseAng - bend) * thighLen,
          y: side.hipStage.y + Math.sin(baseAng - bend) * thighLen,
        };
        const mid: Point = {
          x: (side.hipStage.x + clampedAnkle.x) * 0.5,
          y: (side.hipStage.y + clampedAnkle.y) * 0.5,
        };
        const dotPlus = (pPlus.x - mid.x) * sideSign + (pPlus.y - mid.y) * 0.15;
        const dotMinus = (pMinus.x - mid.x) * sideSign + (pMinus.y - mid.y) * 0.15;
        const chosenKnee = dotPlus >= dotMinus ? pPlus : pMinus;
        const aDx = clampedAnkle.x - chosenKnee.x;
        const aDy = clampedAnkle.y - chosenKnee.y;
        const aDist = Math.max(1, Math.hypot(aDx, aDy));
        return {
          knee: chosenKnee,
          ankle: {
            x: chosenKnee.x + (aDx / aDist) * shinLen,
            y: chosenKnee.y + (aDy / aDist) * shinLen,
          },
        };
      };

      let legTarget = solveGroundedKnee(groundedAnkleStage);
      const h23 = posePt(23, false);
      const h24 = posePt(24, false);
      if (h23 && h24 && Math.abs(h23.x - h24.x) > 4) {
        const leftOnScreenIs23 = h23.x <= h24.x;
        const useLeftLm = side.isRight ? !leftOnScreenIs23 : leftOnScreenIs23;
        const hipIdx = useLeftLm ? 23 : 24;
        const kneeIdx = useLeftLm ? 25 : 26;
        const ankleIdx = useLeftLm ? 27 : 28;
        const pHip = posePt(hipIdx, false);
        const pKnee = posePt(kneeIdx, true);
        if (pHip && pKnee && Math.hypot(pKnee.x - pHip.x, pKnee.y - pHip.y) > 8) {
          const a1 = Math.atan2(pKnee.y - pHip.y, pKnee.x - pHip.x);
          const knee: Point = {
            x: side.hipStage.x + Math.cos(a1) * thighLen,
            y: side.hipStage.y + Math.sin(a1) * thighLen,
          };
          const pAnkle = posePt(ankleIdx, true);
          if (pAnkle && Math.hypot(pAnkle.x - pKnee.x, pAnkle.y - pKnee.y) > 8) {
            const a2 = Math.atan2(pAnkle.y - pKnee.y, pAnkle.x - pKnee.x);
            const rawTrackedAnkle: Point = {
              x: knee.x + Math.cos(a2) * shinLen,
              y: knee.y + Math.sin(a2) * shinLen,
            };
            if (rawTrackedAnkle.y <= groundedAnkleStage.y + 4) {
              legTarget = { knee, ankle: rawTrackedAnkle };
            } else {
              legTarget = solveGroundedKnee({
                x: rawTrackedAnkle.x,
                y: groundedAnkleStage.y,
              });
            }
          } else if (knee.y < side.hipStage.y + thighLen * 0.72) {
            legTarget = {
              knee,
              ankle: {
                x: knee.x + sideSign * shinLen * 0.08,
                y: Math.min(groundedAnkleStage.y, knee.y + shinLen),
              },
            };
          }
        }
      }

      // FK / IK chain propagation through Thigh -> Shin -> Foot
      const rawThighVec = {
        x: legTarget.knee.x - side.hipStage.x,
        y: legTarget.knee.y - side.hipStage.y,
      };
      const rawShinVec = {
        x: legTarget.ankle.x - legTarget.knee.x,
        y: legTarget.ankle.y - legTarget.knee.y,
      };

      const thighRotRad = ((rig.partRotationOffset[side.thighSlot] ?? 0) * Math.PI) / 180;
      const thighChainRot = followRotate ? thighRotRad : 0;
      const thighLocalRot = followRotate ? 0 : thighRotRad;
      const thighOffX = (rig.partOffsetX[side.thighSlot] ?? 0) * offsetUnit;
      const thighOffY = (rig.partOffsetY[side.thighSlot] ?? 0) * offsetUnit;

      const thighVecRot = rotateVec(rawThighVec, parentLegRotRad + thighChainRot);
      const thighStart = { x: side.hipStage.x + thighOffX, y: side.hipStage.y + thighOffY };
      const thighEnd = { x: thighStart.x + thighVecRot.x, y: thighStart.y + thighVecRot.y };
      const kneeForChild = followMove
        ? thighEnd
        : { x: side.hipStage.x + thighVecRot.x, y: side.hipStage.y + thighVecRot.y };

      const shinRotRad = ((rig.partRotationOffset[side.shinSlot] ?? 0) * Math.PI) / 180;
      const shinChainRot = followRotate ? shinRotRad : 0;
      const shinLocalRot = followRotate ? 0 : shinRotRad;
      const shinOffX = (rig.partOffsetX[side.shinSlot] ?? 0) * offsetUnit;
      const shinOffY = (rig.partOffsetY[side.shinSlot] ?? 0) * offsetUnit;

      const shinVecRot = rotateVec(
        rawShinVec,
        parentLegRotRad + thighChainRot + shinChainRot,
      );
      const shinStart = { x: kneeForChild.x + shinOffX, y: kneeForChild.y + shinOffY };
      const shinEnd = { x: shinStart.x + shinVecRot.x, y: shinStart.y + shinVecRot.y };
      const ankleForChild = followMove
        ? shinEnd
        : { x: kneeForChild.x + shinVecRot.x, y: kneeForChild.y + shinVecRot.y };

      const thighPart = buildLimbSegmentPart(
        rig,
        images,
        side.thighSlot,
        "hipJoint",
        "kneeJoint",
        thighStart,
        thighEnd,
        baseThighLen,
        legThickMult,
        false,
        thighLocalRot,
      );
      if (thighPart) partsBySlot[side.thighSlot] = thighPart;

      if (hasShin) {
        stagePins.push(
          { point: shinStart, color: "#22d3ee" },
          { point: shinEnd, color: "#22d3ee" },
        );
        const shinPart = buildLimbSegmentPart(
          rig,
          images,
          side.shinSlot,
          "kneeJoint",
          "ankleJoint",
          shinStart,
          shinEnd,
          baseShinLen,
          legThickMult,
          false,
          shinLocalRot,
        );
        if (shinPart) partsBySlot[side.shinSlot] = shinPart;
      }

      // Foot part (exact 0.38 factor + ground tilt + parent rotation propagation)
      const fallbackFoot: PuppetPartSlot = side.isRight ? "leftFoot" : "rightFoot";
      const hasDirectFoot =
        rig.partEnabled[side.footSlot] !== false && Boolean(images[side.footSlot]);
      const hasFallbackFoot =
        rig.partEnabled[fallbackFoot] !== false && Boolean(images[fallbackFoot]);
      if (rig.partEnabled[side.footSlot] !== false && (hasDirectFoot || hasFallbackFoot)) {
        const activeFootSlot = hasDirectFoot ? side.footSlot : fallbackFoot;
        const footImg = images[activeFootSlot];
        if (footImg) {
          const ankleUV = getPin(rig, activeFootSlot, "ankleJoint");
          const fw = Math.max(1, footImg.naturalWidth);
          const fh = Math.max(1, footImg.naturalHeight);
          const needsMirrorFoot = !hasDirectFoot && hasFallbackFoot;
          const fXf = resolvedMirrorTransform(
            rig,
            side.footSlot,
            fallbackFoot,
            needsMirrorFoot,
          );
          const naturalFootH = refTorsoH * 0.38 * Math.max(0.85, legThickMult);
          const baseScale = naturalFootH / fh;
          const baseFootW = fw * baseScale * fXf.width;
          const baseFootH = fh * baseScale * fXf.height;

          const ankleForFoot = hasShin ? ankleForChild : kneeForChild;
          const kneeForFoot = hasShin ? shinStart : thighStart;
          const shinAngle = Math.atan2(
            ankleForFoot.x - kneeForFoot.x,
            Math.max(1, ankleForFoot.y - kneeForFoot.y),
          );
          const ankleGroundTilt = shinAngle * 0.18;
          const parentFootRot = followRotate
            ? parentLegRotRad + thighChainRot + (hasShin ? shinChainRot : 0)
            : 0;
          const totalFootRot =
            ankleGroundTilt + parentFootRot + (fXf.rotDeg * Math.PI) / 180;

          const fOffX = (rig.partOffsetX[side.footSlot] ?? 0) * offsetUnit;
          const fOffY = (rig.partOffsetY[side.footSlot] ?? 0) * offsetUnit;
          const fPivot = { x: ankleForFoot.x + fOffX, y: ankleForFoot.y + fOffY };
          const xfData = makeAnchoredTransform(
            fPivot,
            totalFootRot,
            (needsMirrorFoot ? -1 : 1) * (fXf.flipH ? -1 : 1),
            fXf.flipV ? -1 : 1,
            ankleUV,
            baseFootW,
            baseFootH,
          );
          partsBySlot[side.footSlot] = {
            slot: side.footSlot,
            image: footImg,
            localW: baseFootW,
            localH: baseFootH,
            localToStage: xfData.localToStage,
            boxW: xfData.boxW,
            boxH: xfData.boxH,
            boxToStage: xfData.boxToStage,
            pivotInBox: xfData.pivotInBox,
            draw: (ctx) => {
              ctx.save();
              applyMatToCtx(ctx, xfData.localToStage);
              ctx.drawImage(footImg, 0, 0, baseFootW, baseFootH);
              ctx.restore();
            },
          };
          stagePins.push({ point: fPivot, color: "#34d399" });
        }
      }
    }
  }

  // ── 5. ARMS & HANDS (Hand-Led Soft-IK + Clavicle Lead + FK/IK Chain) ──
  const baseUpperArmLen = refTorsoH * 0.52;
  const baseForearmLen = refTorsoH * 0.5;
  const headImgAspect =
    (images.head?.naturalWidth ?? 512) / Math.max(1, images.head?.naturalHeight ?? 512);
  const approxHeadW = headH * headImgAspect * (rig.partWidthScale.head ?? 1);
  const reachExag = rig.armReachExaggeration;
  const realHeadX = fRaw.present ? fRaw.rawAnchorX : cal.anchorX || 0.5;
  const realHeadY = fRaw.present ? fRaw.rawAnchorY : cal.anchorY || 0.3;
  const realHeadCameraH = clamp((fRaw.present ? fRaw.rawIOD : 0.085) * 2.8, 0.14, 0.45);

  const camShoulderSpan =
    lsPt && rsPt
      ? Math.max(32, Math.hypot(rsPt.x - lsPt.x, rsPt.y - lsPt.y))
      : cal.shoulderSpan > 0.08
        ? cal.shoulderSpan * isoUnit
        : Math.max(40, isoUnit * frameAspect * 0.22);

  const camTotalArmReachStage =
    cal.calibratedUpperArmLen &&
    cal.calibratedForearmLen &&
    (cal.calibratedUpperArmLen + cal.calibratedForearmLen) * isoUnit > 30
      ? (cal.calibratedUpperArmLen + cal.calibratedForearmLen) * isoUnit
      : fRaw.present
        ? Math.max(camShoulderSpan * 1.48, realHeadCameraH * isoUnit * 1.85)
        : camShoulderSpan * 1.55;

  const armSides: {
    isLeft: boolean;
    shoulderStage: Point;
    upperSlot: PuppetPartSlot;
    foreSlot: PuppetPartSlot;
    handSlot: PuppetPartSlot;
    handBackSlot: PuppetPartSlot;
    poseShIdx: number;
    poseElIdx: number;
    poseWrIdx: number;
  }[] = [
    {
      isLeft: true,
      shoulderStage: leftShoulderStage,
      upperSlot: "leftUpperArm",
      foreSlot: "leftForearm",
      handSlot: "leftHand",
      handBackSlot: "leftHandBack",
      poseShIdx: leftShIdx,
      poseElIdx: leftShIdx + 2,
      poseWrIdx: leftShIdx + 4,
    },
    {
      isLeft: false,
      shoulderStage: rightShoulderStage,
      upperSlot: "rightUpperArm",
      foreSlot: "rightForearm",
      handSlot: "rightHand",
      handBackSlot: "rightHandBack",
      poseShIdx: rightShIdx,
      poseElIdx: rightShIdx + 2,
      poseWrIdx: rightShIdx + 4,
    },
  ];

  for (const side of armSides) {
    const label = side.isLeft ? "L" : "R";
    const trackedHand = activeFrame.hands.find(
      (h) => h.label === label && h.landmarks.length >= 21,
    );
    const pShoulder = posePt(side.poseShIdx);
    const pElbow = posePt(side.poseElIdx, true);
    const pPoseWrist = posePt(side.poseWrIdx, true);
    const hasForearm =
      rig.partEnabled[side.foreSlot] !== false &&
      Boolean(images[side.foreSlot] || images.leftForearm);

    const upperArmLen = baseUpperArmLen * armLenMult * (rig.partHeightScale[side.upperSlot] ?? 1);
    const forearmLen = baseForearmLen * armLenMult * (rig.partHeightScale[side.foreSlot] ?? 1);
    const baseOnePieceLen = refTorsoH * 0.94;
    const onePieceLen = baseOnePieceLen * armLenMult * (rig.partHeightScale[side.upperSlot] ?? 1);

    const sway =
      Math.sin(timeSec * 2.1 + (side.isLeft ? 0 : 1.2)) * 0.04 * rig.idleMotionAmount;
    const outSign = side.isLeft ? -1 : 1;
    const restElbow: Point = {
      x: side.shoulderStage.x + outSign * upperArmLen * (0.24 + sway),
      y: side.shoulderStage.y + upperArmLen * 0.94,
    };
    const restWrist: Point = !hasForearm
      ? {
          x: side.shoulderStage.x + outSign * onePieceLen * (0.16 + sway * 0.5),
          y: side.shoulderStage.y + onePieceLen * 0.96,
        }
      : {
          x: restElbow.x + outSign * forearmLen * 0.08,
          y: restElbow.y + forearmLen * 0.9,
        };
    const restDx = restWrist.x - (hasForearm ? restElbow.x : side.shoulderStage.x);
    const restDy = restWrist.y - (hasForearm ? restElbow.y : side.shoulderStage.y);
    const restHandAngle = Math.atan2(restDy, restDx) + Math.PI * 0.5;

    let targetShoulder = side.shoulderStage;
    let targetElbow = restElbow;
    let targetWrist = restWrist;
    let targetHandAngle = restHandAngle;
    let handDepthScale = 1.0;
    let palmSign = 1.0;
    let activelyTracked = false;

    if (trackedHand) {
      activelyTracked = true;
      // Note: trackedHand.landmarks ALREADY has mirror applied in useHolisticTracker.ts!
      const wristX = trackedHand.landmarks[0].x;
      const wristY = trackedHand.landmarks[0].y;
      const palmX = trackedHand.landmarks[9].x;
      const palmY = trackedHand.landmarks[9].y;
      const handScreenX = wristX * 0.72 + palmX * 0.28;
      const handScreenY = wristY * 0.78 + palmY * 0.22;

      const camShoulderStagePt: Point =
        pShoulder ??
        (fRaw.present
          ? {
              x:
                isoXShift +
                (realHeadX + outSign * realHeadCameraH * 0.88) * frameAspect * isoUnit,
              y: (realHeadY + realHeadCameraH * 1.05) * isoUnit,
            }
          : {
              x:
                isoXShift +
                (side.isLeft ? cal.leftShoulderX : cal.rightShoulderX) *
                  frameAspect *
                  isoUnit,
              y: (side.isLeft ? cal.leftShoulderY : cal.rightShoulderY) * isoUnit,
            });
      const handStagePt: Point = {
        x: isoXShift + handScreenX * frameAspect * isoUnit,
        y: handScreenY * isoUnit,
      };
      const dCamX = (handStagePt.x - camShoulderStagePt.x) / Math.max(40, camTotalArmReachStage);
      const dCamY = (handStagePt.y - camShoulderStagePt.y) / Math.max(40, camTotalArmReachStage);

      const restArmSpan = upperArmLen + (hasForearm ? forearmLen : 0);
      const baseReachUnit = restArmSpan * Math.max(0.88, armLenMult);
      const headClearUnit = Math.max(baseReachUnit, restArmSpan + headH * 0.28);
      const effectiveReachUnit =
        baseReachUnit +
        (headClearUnit - baseReachUnit) * Math.min(1, reachExag * 0.85) +
        baseReachUnit * reachExag * 0.25;

      let desiredWrist: Point = {
        x: side.shoulderStage.x + dCamX * effectiveReachUnit,
        y: side.shoulderStage.y + dCamY * effectiveReachUnit,
      };

      if (pPoseWrist && pShoulder) {
        const pDx = (pPoseWrist.x - pShoulder.x) / Math.max(40, camTotalArmReachStage);
        const pDy = (pPoseWrist.y - pShoulder.y) / Math.max(40, camTotalArmReachStage);
        const poseTarget: Point = {
          x: side.shoulderStage.x + pDx * effectiveReachUnit,
          y: side.shoulderStage.y + pDy * effectiveReachUnit,
        };
        desiredWrist = {
          x: desiredWrist.x * 0.7 + poseTarget.x * 0.3,
          y: desiredWrist.y * 0.7 + poseTarget.y * 0.3,
        };
      }

      const camOutsideFace = outSign * (handScreenX - realHeadX);
      if (
        reachExag > 0.05 &&
        camOutsideFace > realHeadCameraH * 0.52 &&
        desiredWrist.y < side.shoulderStage.y + headH * 0.15
      ) {
        const cheekEdgeX = chainNeckStage.x + outSign * (approxHeadW * 0.52);
        const blend =
          Math.min(1, reachExag * 1.2) *
          Math.min(
            1,
            (camOutsideFace - realHeadCameraH * 0.52) / Math.max(0.05, realHeadCameraH * 0.45),
          );
        if (outSign * (desiredWrist.x - cheekEdgeX) < 0) {
          desiredWrist.x += (cheekEdgeX - desiredWrist.x) * blend;
        }
      }

      const restBlend = trackedHand.returnToRestBlend;
      if (restBlend > 0.001) {
        desiredWrist = {
          x: lerp(desiredWrist.x, restWrist.x, restBlend),
          y: lerp(desiredWrist.y, restWrist.y, restBlend),
        };
      }

      // Clavicle lead
      const rawDx = desiredWrist.x - side.shoulderStage.x;
      const rawDy = desiredWrist.y - side.shoulderStage.y;
      const distFromBase = Math.max(1, Math.hypot(rawDx, rawDy));
      let clavicleShift = 0;
      if (distFromBase > restArmSpan * 0.6) {
        const maxShift = restArmSpan * (0.04 + reachExag * 0.11) * (1 - restBlend);
        const t = Math.tanh(
          (distFromBase - restArmSpan * 0.6) / Math.max(1, restArmSpan * 0.65),
        );
        clavicleShift = maxShift * t;
      }
      targetShoulder = {
        x: side.shoulderStage.x + (rawDx / distFromBase) * clavicleShift,
        y: side.shoulderStage.y + (rawDy / distFromBase) * clavicleShift,
      };

      // Analytic Soft-IK stretch
      const effDx = desiredWrist.x - targetShoulder.x;
      const effDy = desiredWrist.y - targetShoulder.y;
      const distFromShoulder = Math.max(1, Math.hypot(effDx, effDy));
      const constraintLimit = 0.985 - rig.humanAnatomyConstraints * 0.045;
      const softStart = restArmSpan * 0.8;
      const maxSpan = restArmSpan * (1 + reachExag * 0.65);
      const softTargetDist =
        distFromShoulder <= softStart || maxSpan <= restArmSpan
          ? Math.min(distFromShoulder, restArmSpan * constraintLimit)
          : softStart +
            (maxSpan - softStart) *
              Math.tanh((distFromShoulder - softStart) / Math.max(1, maxSpan - softStart));
      const stretchFactor = Math.max(
        1,
        softTargetDist / Math.max(1, restArmSpan * constraintLimit),
      );

      const rawDepth = clamp(trackedHand.scale, 0.88, 1.18);
      handDepthScale = lerp(rawDepth, 1.0, restBlend);
      targetHandAngle = lerpAngle(trackedHand.wristAngle, restHandAngle, restBlend);
      palmSign = lerp(trackedHand.palmFacingSign, 1.0, restBlend);

      if (hasForearm) {
        const effUpper = upperArmLen * stretchFactor;
        const effFore = forearmLen * stretchFactor;
        targetElbow = solveTwoBoneIKElbow(
          targetShoulder,
          desiredWrist,
          effUpper,
          effFore,
          side.isLeft,
          rig.humanAnatomyConstraints,
          pShoulder,
          pElbow,
        );
        const fDx = desiredWrist.x - targetElbow.x;
        const fDy = desiredWrist.y - targetElbow.y;
        const fDist = Math.max(1, Math.hypot(fDx, fDy));
        targetWrist = {
          x: targetElbow.x + (fDx / fDist) * effFore,
          y: targetElbow.y + (fDy / fDist) * effFore,
        };
      } else {
        const effOneLen = onePieceLen * stretchFactor;
        const clampedLen = clamp(distFromShoulder, onePieceLen * 0.78, effOneLen);
        targetElbow = targetShoulder;
        targetWrist = {
          x: targetShoulder.x + (effDx / distFromShoulder) * clampedLen,
          y: targetShoulder.y + (effDy / distFromShoulder) * clampedLen,
        };
      }
    } else if (
      pShoulder &&
      pElbow &&
      pPoseWrist &&
      Math.hypot(pElbow.x - pShoulder.x, pElbow.y - pShoulder.y) > 12 &&
      Math.hypot(pPoseWrist.x - pElbow.x, pPoseWrist.y - pElbow.y) > 10
    ) {
      activelyTracked = true;
      const uDx = pElbow.x - pShoulder.x;
      const uDy = pElbow.y - pShoulder.y;
      const upperAngle = Math.atan2(uDy, uDx);
      const uFore = clamp(Math.hypot(uDx, uDy) / (camShoulderSpan * 0.8), 0.65, 1.08);
      const fDx = pPoseWrist.x - pElbow.x;
      const fDy = pPoseWrist.y - pElbow.y;
      const foreAngle = Math.atan2(fDy, fDx);
      const fFore = clamp(Math.hypot(fDx, fDy) / (camShoulderSpan * 0.76), 0.65, 1.08);
      const poseStretch = 1 + reachExag * 0.22;
      const rb = activeFrame.poseReturnBlend;
      targetHandAngle = lerpAngle(foreAngle + Math.PI * 0.5, restHandAngle, rb);

      if (hasForearm) {
        const rawEl: Point = {
          x: side.shoulderStage.x + Math.cos(upperAngle) * upperArmLen * uFore * poseStretch,
          y: side.shoulderStage.y + Math.sin(upperAngle) * upperArmLen * uFore * poseStretch,
        };
        const rawWr: Point = {
          x: rawEl.x + Math.cos(foreAngle) * forearmLen * fFore * poseStretch,
          y: rawEl.y + Math.sin(foreAngle) * forearmLen * fFore * poseStretch,
        };
        targetElbow = { x: lerp(rawEl.x, restElbow.x, rb), y: lerp(rawEl.y, restElbow.y, rb) };
        targetWrist = { x: lerp(rawWr.x, restWrist.x, rb), y: lerp(rawWr.y, restWrist.y, rb) };
      } else {
        const totalAngle = Math.atan2(pPoseWrist.y - pShoulder.y, pPoseWrist.x - pShoulder.x);
        const rawWr: Point = {
          x: side.shoulderStage.x + Math.cos(totalAngle) * onePieceLen * poseStretch,
          y: side.shoulderStage.y + Math.sin(totalAngle) * onePieceLen * poseStretch,
        };
        targetElbow = side.shoulderStage;
        targetWrist = { x: lerp(rawWr.x, restWrist.x, rb), y: lerp(rawWr.y, restWrist.y, rb) };
      }
    }

    // Gentle stage damping on arm joints so untracked / resting arms never jitter
    if (updateSmoothing) {
      const prev = side.isLeft ? anim.smoothArmL : anim.smoothArmR;
      const a = activelyTracked ? 0.34 : 0.14;
      const nextSmooth: ArmSmoothEntry = prev
        ? {
            shoulder: {
              x: lerp(prev.shoulder.x, targetShoulder.x, a),
              y: lerp(prev.shoulder.y, targetShoulder.y, a),
            },
            elbow: {
              x: lerp(prev.elbow.x, targetElbow.x, a),
              y: lerp(prev.elbow.y, targetElbow.y, a),
            },
            wrist: {
              x: lerp(prev.wrist.x, targetWrist.x, a),
              y: lerp(prev.wrist.y, targetWrist.y, a),
            },
            angle: lerpAngle(prev.angle, targetHandAngle, a),
          }
        : {
            shoulder: targetShoulder,
            elbow: targetElbow,
            wrist: targetWrist,
            angle: targetHandAngle,
          };
      if (side.isLeft) anim.smoothArmL = nextSmooth;
      else anim.smoothArmR = nextSmooth;
      targetShoulder = nextSmooth.shoulder;
      targetElbow = nextSmooth.elbow;
      targetWrist = nextSmooth.wrist;
      targetHandAngle = nextSmooth.angle;
    }

    // Hierarchical FK / IK Chain propagation: Torso -> UpperArm -> Forearm -> Hand!
    const upperRotRad = ((rig.partRotationOffset[side.upperSlot] ?? 0) * Math.PI) / 180;
    const foreRotRad = ((rig.partRotationOffset[side.foreSlot] ?? 0) * Math.PI) / 180;
    const upperChainRot = followRotate ? upperRotRad : 0;
    const upperLocalRot = followRotate ? 0 : upperRotRad;
    const foreChainRot = followRotate ? foreRotRad : 0;
    const foreLocalRot = followRotate ? 0 : foreRotRad;

    const upperOffX = (rig.partOffsetX[side.upperSlot] ?? 0) * offsetUnit;
    const upperOffY = (rig.partOffsetY[side.upperSlot] ?? 0) * offsetUnit;
    const foreOffX = (rig.partOffsetX[side.foreSlot] ?? 0) * offsetUnit;
    const foreOffY = (rig.partOffsetY[side.foreSlot] ?? 0) * offsetUnit;

    let upperStart: Point;
    let upperEnd: Point;
    let foreStart: Point;
    let foreEnd: Point;
    let wristStage: Point;

    if (hasForearm) {
      const rawUpperVec = {
        x: targetElbow.x - targetShoulder.x,
        y: targetElbow.y - targetShoulder.y,
      };
      const upperVecRot = rotateVec(rawUpperVec, torsoChainRotRad + upperChainRot);
      upperStart = { x: targetShoulder.x + upperOffX, y: targetShoulder.y + upperOffY };
      upperEnd = { x: upperStart.x + upperVecRot.x, y: upperStart.y + upperVecRot.y };

      const elbowChildAnchor = followMove
        ? upperEnd
        : { x: targetShoulder.x + upperVecRot.x, y: targetShoulder.y + upperVecRot.y };

      const rawForeVec = {
        x: targetWrist.x - targetElbow.x,
        y: targetWrist.y - targetElbow.y,
      };
      const foreVecRot = rotateVec(
        rawForeVec,
        torsoChainRotRad + upperChainRot + foreChainRot,
      );
      foreStart = { x: elbowChildAnchor.x + foreOffX, y: elbowChildAnchor.y + foreOffY };
      foreEnd = { x: foreStart.x + foreVecRot.x, y: foreStart.y + foreVecRot.y };
      wristStage = followMove
        ? foreEnd
        : { x: elbowChildAnchor.x + foreVecRot.x, y: elbowChildAnchor.y + foreVecRot.y };
      stagePins.push({ point: foreStart, color: "#fb923c" });
    } else {
      const rawArmVec = {
        x: targetWrist.x - targetShoulder.x,
        y: targetWrist.y - targetShoulder.y,
      };
      const armVecRot = rotateVec(rawArmVec, torsoChainRotRad + upperChainRot);
      upperStart = { x: targetShoulder.x + upperOffX, y: targetShoulder.y + upperOffY };
      upperEnd = { x: upperStart.x + armVecRot.x, y: upperStart.y + armVecRot.y };
      foreStart = targetShoulder;
      foreEnd = upperEnd;
      wristStage = followMove
        ? upperEnd
        : { x: targetShoulder.x + armVecRot.x, y: targetShoulder.y + armVecRot.y };
    }
    stagePins.push({ point: wristStage, color: "#fb923c" });

    if (hasForearm) {
      const upperPart = buildLimbSegmentPart(
        rig,
        images,
        side.upperSlot,
        "shoulderJoint",
        "elbowJoint",
        upperStart,
        upperEnd,
        baseUpperArmLen,
        armThickMult,
        false,
        upperLocalRot,
      );
      if (upperPart) partsBySlot[side.upperSlot] = upperPart;

      const forePart = buildLimbSegmentPart(
        rig,
        images,
        side.foreSlot,
        "elbowJoint",
        "wristJoint",
        foreStart,
        foreEnd,
        baseForearmLen,
        armThickMult,
        false,
        foreLocalRot,
      );
      if (forePart) partsBySlot[side.foreSlot] = forePart;
    } else {
      const onePart = buildLimbSegmentPart(
        rig,
        images,
        side.upperSlot,
        "shoulderJoint",
        "elbowJoint",
        upperStart,
        upperEnd,
        baseOnePieceLen,
        armThickMult * (1 + (handDepthScale - 1) * 0.35),
        palmSign < 0,
        upperLocalRot,
      );
      if (onePart) partsBySlot[side.upperSlot] = onePart;
    }

    // Hand + Back-of-Hand (exact port of PuppetStudioView.swift lines 2636-2735!)
    const hasPalmDirect = Boolean(images[side.handSlot]);
    const palmFallbackSlot: PuppetPartSlot = side.isLeft ? "rightHand" : "leftHand";
    const hasPalmFallback = Boolean(images[palmFallbackSlot]);

    const backSlot = side.handBackSlot;
    const backFallbackSlot: PuppetPartSlot = side.isLeft ? "rightHandBack" : "leftHandBack";
    const hasBackDirect =
      rig.partEnabled[backSlot] !== false && Boolean(images[backSlot]);
    const hasBackFallback =
      rig.partEnabled[backSlot] !== false && Boolean(images[backFallbackSlot]);
    const hasAnyBack = hasBackDirect || hasBackFallback;

    const isEditingBack = allowPartEditing && selectedSlot === backSlot;
    const useBackGraphic =
      hasAnyBack && (isEditingBack || (rig.dynamicPalmFlip && palmSign < -0.06));
    const hasAnyHand =
      rig.partEnabled[side.handSlot] !== false &&
      (useBackGraphic || hasPalmDirect || hasPalmFallback);

    if (hasAnyHand) {
      const activeHandSlot: PuppetPartSlot = useBackGraphic
        ? hasBackDirect
          ? backSlot
          : backFallbackSlot
        : hasPalmDirect
          ? side.handSlot
          : palmFallbackSlot;
      const transformOwner: PuppetPartSlot = useBackGraphic ? backSlot : side.handSlot;
      const transformFallback: PuppetPartSlot = useBackGraphic
        ? backFallbackSlot
        : palmFallbackSlot;
      const needsHandMirror = useBackGraphic
        ? !hasBackDirect && hasBackFallback
        : !hasPalmDirect && hasPalmFallback;

      const handImg = images[activeHandSlot];
      if (handImg) {
        const wristUV = getPin(rig, activeHandSlot, "wristPivot");
        const knuckleUV = getPin(rig, activeHandSlot, "middleKnuckle");
        const handAspect = handImg.naturalWidth / Math.max(1, handImg.naturalHeight);
        const baseHandH = stageH * rig.handScale * clampedScale * handDepthScale;
        const baseHandW = baseHandH * handAspect;
        const pinDx = (knuckleUV.x - wristUV.x) * baseHandW;
        const pinDy = (knuckleUV.y - wristUV.y) * baseHandH;
        const intrinsicHandAngle =
          Math.hypot(pinDx, pinDy) > 1 ? Math.atan2(pinDx, -pinDy) : 0;

        const handXf = resolvedMirrorTransform(
          rig,
          transformOwner,
          transformFallback,
          needsHandMirror,
        );
        const finalHandW = baseHandW * handXf.width;
        const finalHandH = baseHandH * handXf.height;
        const partRotRad = (handXf.rotDeg * Math.PI) / 180;
        const parentArmRot = followRotate
          ? torsoChainRotRad + upperChainRot + (hasForearm ? foreChainRot : 0)
          : 0;
        const flipH = handXf.flipH ? -1 : 1;
        const flipV = handXf.flipV ? -1 : 1;
        const avgCurl =
          trackedHand && trackedHand.fingerCurls.length > 0
            ? trackedHand.fingerCurls.reduce((s, c) => s + c, 0) /
              trackedHand.fingerCurls.length
            : 0;
        const curlSquashY = 1 - avgCurl * 0.16;

        const hOffX = (rig.partOffsetX[transformOwner] ?? 0) * offsetUnit;
        const hOffY = (rig.partOffsetY[transformOwner] ?? 0) * offsetUnit;
        const handPivotPt = { x: wristStage.x + hOffX, y: wristStage.y + hOffY };
        const worldHandRot = targetHandAngle + parentArmRot + partRotRad;
        const defaultHandSignX = needsHandMirror ? -1 : 1;

        let resolvedPalmFlipX = 1.0;
        if (rig.dynamicPalmFlip) {
          const persp = clamp(Math.abs(palmSign) * 1.25, 0.72, 1.0);
          resolvedPalmFlipX = useBackGraphic
            ? persp
            : (palmSign >= -0.06 ? 1 : -1) * persp;
        }
        const finalFlipX = defaultHandSignX * resolvedPalmFlipX * flipH;

        const xfData = makeHandAnchoredTransform(
          handPivotPt,
          worldHandRot,
          intrinsicHandAngle,
          finalFlipX,
          flipV * curlSquashY,
          wristUV,
          finalHandW,
          finalHandH,
        );
        const interactiveSlot: PuppetPartSlot = isEditingBack ? backSlot : side.handSlot;
        partsBySlot[side.handSlot] = {
          slot: interactiveSlot,
          image: handImg,
          localW: finalHandW,
          localH: finalHandH,
          localToStage: xfData.localToStage,
          boxW: xfData.boxW,
          boxH: xfData.boxH,
          boxToStage: xfData.boxToStage,
          pivotInBox: xfData.pivotInBox,
          draw: (ctx) => {
            ctx.save();
            applyMatToCtx(ctx, xfData.localToStage);
            ctx.drawImage(handImg, 0, 0, finalHandW, finalHandH);
            ctx.restore();
          },
        };

        if (trackedHand) {
          handChains.push({
            wristStage: handPivotPt,
            hand: trackedHand,
            visualScale: stageH * rig.handScale * clampedScale * handDepthScale * 1.8,
          });
        }
      }
    }
  }

  // Strict Back-to-Front Layer Ordering from rig.layerStack
  const orderedParts: PlacedStagePart[] = [];
  for (let i = rig.layerStack.length - 1; i >= 0; i--) {
    const slot = rig.layerStack[i];
    const p = partsBySlot[slot];
    if (p) orderedParts.push(p);
  }

  return {
    result: {
      parts: orderedParts,
      stagePins,
      trackedHandChains: handChains,
    },
    scaleDelta: clampedScale,
  };
}

function drawLayoutToCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  rig: PuppetRigState,
  layout: StageLayoutResult,
  zoom: number,
  showPins: boolean,
  ndiBgOverride: NdiBackgroundMode | null,
) {
  if (ndiBgOverride === "alpha") {
    ctx.clearRect(0, 0, w, h);
  } else if (ndiBgOverride === "green") {
    ctx.fillStyle = "#00d926";
    ctx.fillRect(0, 0, w, h);
  } else if (ndiBgOverride === "white") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
  } else {
    const bg =
      STAGE_BACKGROUNDS.find((b) => b.id === rig.stageBackground) ??
      STAGE_BACKGROUNDS[0];
    ctx.fillStyle = bg.cssColor;
    ctx.fillRect(0, 0, w, h);

    if (rig.stageBackground === "dark") {
      const grad = ctx.createRadialGradient(
        w * 0.5,
        h * 0.45,
        20,
        w * 0.5,
        h * 0.5,
        Math.max(w, h) * 0.65,
      );
      grad.addColorStop(0, "rgba(42, 54, 78, 0.25)");
      grad.addColorStop(1, "rgba(10, 12, 18, 0.35)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  ctx.save();
  applyMatToCtx(ctx, viewZoomTransform(w, h, zoom));

  for (const part of layout.parts) {
    part.draw(ctx);
  }

  if (showPins) {
    for (const pinItem of layout.stagePins) {
      ctx.save();
      ctx.fillStyle = pinItem.color;
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pinItem.point.x, pinItem.point.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  ctx.restore();
}
