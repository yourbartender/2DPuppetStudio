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
} from "lucide-react";
import {
  getPin,
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

interface Point {
  x: number;
  y: number;
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
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPt(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Outward 2-bone analytical IK solver matching macOS native PuppetStudioView.swift */
function solve2BoneIK(
  root: Point,
  target: Point,
  len1: number,
  len2: number,
  poleHint: Point,
): { joint: Point; end: Point } {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const rawDist = Math.hypot(dx, dy);
  const maxReach = Math.max(1, (len1 + len2) * 0.995);
  const minReach = Math.max(2, Math.abs(len1 - len2) + 2);
  const d = clamp(rawDist, minReach, maxReach);

  const dirX = rawDist > 1e-4 ? dx / rawDist : 0;
  const dirY = rawDist > 1e-4 ? dy / rawDist : 1;
  const end: Point = {
    x: root.x + dirX * d,
    y: root.y + dirY * d,
  };

  // Law of cosines
  const cosA = clamp((len1 * len1 + d * d - len2 * len2) / (2 * len1 * d), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));

  // Two candidate circle-intersection joints
  const perpX = -dirY;
  const perpY = dirX;
  const c1: Point = {
    x: root.x + (dirX * cosA + perpX * sinA) * len1,
    y: root.y + (dirY * cosA + perpY * sinA) * len1,
  };
  const c2: Point = {
    x: root.x + (dirX * cosA - perpX * sinA) * len1,
    y: root.y + (dirY * cosA - perpY * sinA) * len1,
  };

  // Pick candidate matching preferred outward/camera pole vector
  const midX = (root.x + end.x) * 0.5;
  const midY = (root.y + end.y) * 0.5;
  const hX = poleHint.x - midX;
  const hY = poleHint.y - midY;
  const dot1 = (c1.x - midX) * hX + (c1.y - midY) * hY;
  const dot2 = (c2.x - midX) * hX + (c2.y - midY) * hY;
  return { joint: dot1 >= dot2 ? c1 : c2, end };
}

function drawLimbSegment(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  pStart: Point,
  pEnd: Point,
  pinA: Point,
  pinB: Point,
  thicknessScale: number,
  widthMul: number,
  heightMul: number,
  rotOffsetDeg: number,
  flipH: boolean,
  flipV: boolean,
) {
  const nw = img.naturalWidth || 100;
  const nh = img.naturalHeight || 200;
  const pinDx = (pinB.x - pinA.x) * nw;
  const pinDy = (pinB.y - pinA.y) * nh;
  const intrinsicLen = Math.max(12, Math.hypot(pinDx, pinDy));
  const intrinsicAngle = Math.atan2(pinDy, pinDx);

  const segDx = pEnd.x - pStart.x;
  const segDy = pEnd.y - pStart.y;
  const segLen = Math.max(8, Math.hypot(segDx, segDy));
  const segAngle = Math.atan2(segDy, segDx);

  const lengthScale = (segLen / intrinsicLen) * heightMul;
  const wScale = lengthScale * thicknessScale * widthMul;

  ctx.save();
  ctx.translate(pStart.x, pStart.y);
  ctx.rotate(segAngle + (rotOffsetDeg * Math.PI) / 180);
  // Rotate into local sprite bone axis before optional flips
  ctx.scale(1, flipV ? -1 : 1);
  ctx.rotate(-intrinsicAngle);
  if (flipH) {
    // Flip perpendicular to bone axis around pinA
    const ax = pinA.x * nw * wScale;
    const ay = pinA.y * nh * lengthScale;
    ctx.translate(0, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(img, -ax, -ay, nw * wScale, nh * lengthScale);
  } else {
    const drawW = nw * wScale;
    const drawH = nh * lengthScale;
    ctx.drawImage(img, -pinA.x * drawW, -pinA.y * drawH, drawW, drawH);
  }
  ctx.restore();
}

function drawDeformedHead(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  drawW: number,
  drawH: number,
  neckPin: Point,
  mouthPinY: number,
  browPinY: number,
  jawAmount: number,
  browAmount: number,
) {
  const nw = img.naturalWidth || 512;
  const nh = img.naturalHeight || 512;
  const ox = -neckPin.x * drawW;
  const oy = -neckPin.y * drawH;

  if (Math.abs(jawAmount) < 0.01 && Math.abs(browAmount) < 0.01) {
    ctx.drawImage(img, ox, oy, drawW, drawH);
    return;
  }

  const strips = 24;
  for (let i = 0; i < strips; i++) {
    const t0 = i / strips;
    const t1 = (i + 1) / strips;

    const warpY = (t: number) => {
      let dy = 0;
      if (t > mouthPinY) {
        const k = (t - mouthPinY) / Math.max(0.12, 1 - mouthPinY);
        dy += k * k * jawAmount * drawH * 0.14;
      }
      if (t < browPinY + 0.06 && t > 0.08) {
        const k = 1 - Math.abs(t - browPinY) / Math.max(0.15, browPinY);
        if (k > 0) dy -= k * browAmount * drawH * 0.05;
      }
      return dy;
    };

    const y0 = t0 * drawH + warpY(t0);
    const y1 = t1 * drawH + warpY(t1);
    const sy = t0 * nh;
    const sh = Math.max(1, (t1 - t0) * nh);
    const dh = Math.max(1, y1 - y0 + 0.6); // +0.6px overlap eliminates hairline seams

    ctx.drawImage(img, 0, sy, nw, sh, ox, oy + y0, drawW, dh);
  }
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
}: PuppetStageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState(1.0);
  const [frozen, setFrozen] = useState(false);
  const [showPins, setShowPins] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

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

  // Persistent animation smoothing state (auto-blink & smoothed head/limbs)
  const animStateRef = useRef({
    nextAutoBlinkMs: performance.now() + 2600,
    autoBlinkStartMs: 0,
    lastFrame: null as TrackedFrame | null,
    smoothHeadX: 0,
    smoothHeadY: 0,
    smoothRoll: 0,
    smoothYaw: 0,
    smoothPitch: 0,
    smoothMouth: 0,
    smoothSmile: 0,
    smoothBrow: 0,
    smoothBlinkL: 0,
    smoothBlinkR: 0,
  });

  useEffect(() => {
    let raf = 0;

    const render = (now: number) => {
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
        }

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.save();
          ctx.scale(dpr, dpr);
          drawStage(
            ctx,
            cssW,
            cssH,
            now,
            storeRef.current.rig,
            storeRef.current.images,
            frozenRef.current && animStateRef.current.lastFrame
              ? animStateRef.current.lastFrame
              : frameRef.current,
            calRef.current,
            zoomRef.current,
            showPinsRef.current,
            animStateRef.current,
          );
          if (!frozenRef.current) {
            animStateRef.current.lastFrame = frameRef.current;
          }
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [frameRef]);

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    setDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      ox: store.rig.stageOffsetX,
      oy: store.rig.stageOffsetY,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!dragging || !dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const ox = dragStartRef.current.ox + dx;
    const oy = dragStartRef.current.oy + dy;
    store.updateRig((prev) => ({ ...prev, stageOffsetX: ox, stageOffsetY: oy }), false);
  };

  const handleMouseUp = () => {
    setDragging(false);
    dragStartRef.current = null;
  };

  const handleDoubleClick = () => {
    setZoom(1.0);
    store.updateRig((prev) => ({ ...prev, stageOffsetX: 0, stageOffsetY: 0 }), true);
  };

  const bgInfo =
    STAGE_BACKGROUNDS.find((b) => b.id === store.rig.stageBackground) ??
    STAGE_BACKGROUNDS[0];

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40">
      {/* Stage Toolbar (hidden in Clean Feed mode) */}
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
                  : "bg-white/10 text-muted-foreground hover:bg-white/15"
              }`}
              title="Calibrate neutral head & shoulder baseline now"
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

            {/* Fixed-width viseme pill so UI never jumps horizontally */}
            <span className="inline-flex w-[144px] items-center justify-center rounded-full bg-black/50 px-2.5 py-1 font-mono text-[11px] font-semibold text-amber-400">
              {VISEME_LABELS[viseme]}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {!compact && (
              <>
                {/* Idle motion quick slider */}
                <label
                  className="inline-flex items-center gap-1.5 rounded-full bg-white/8 px-2.5 py-1 text-[11px] text-muted-foreground"
                  title="Subtle idle breathing & sway"
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

                {/* Background selector */}
                <select
                  value={store.rig.stageBackground}
                  onChange={(e) =>
                    store.updateRig((p) => ({
                      ...p,
                      stageBackground: e.target.value as PuppetStageBackground,
                    }))
                  }
                  className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-foreground outline-none"
                  title="Stage background (use Chroma Green/Blue for OBS keying)"
                >
                  {STAGE_BACKGROUNDS.map((bg) => (
                    <option key={bg.id} value={bg.id} className="bg-[#161a24] text-white">
                      {bg.label}
                    </option>
                  ))}
                </select>
              </>
            )}

            {/* Zoom controls */}
            <div className="inline-flex items-center rounded-md border border-white/10 bg-black/30">
              <button
                type="button"
                onClick={() => setZoom((z) => clamp(Number((z - 0.1).toFixed(2)), 0.4, 2.5))}
                className="px-1.5 py-1 text-muted-foreground hover:text-foreground"
                title="Zoom Out"
              >
                <ZoomOut className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(1.0)}
                className="min-w-[40px] px-1 text-center font-mono text-[11px] text-foreground"
                title="Reset Zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => clamp(Number((z + 0.1).toFixed(2)), 0.4, 2.5))}
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
              title="Freeze puppet pose"
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

      {/* Main 60 FPS Canvas Stage */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden select-none"
        style={{ backgroundColor: bgInfo.cssColor }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          className={`h-full w-full ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        />

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

// ── Core 60 FPS Stage Renderer ─────────────────────────────────────────────

interface AnimState {
  nextAutoBlinkMs: number;
  autoBlinkStartMs: number;
  lastFrame: TrackedFrame | null;
  smoothHeadX: number;
  smoothHeadY: number;
  smoothRoll: number;
  smoothYaw: number;
  smoothPitch: number;
  smoothMouth: number;
  smoothSmile: number;
  smoothBrow: number;
  smoothBlinkL: number;
  smoothBlinkR: number;
}

function drawStage(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  now: number,
  rig: PuppetRigState,
  images: Partial<Record<PuppetPartSlot, HTMLImageElement>>,
  frame: TrackedFrame,
  cal: CalibrationBaseline,
  zoom: number,
  showPins: boolean,
  anim: AnimState,
) {
  // 1. Background
  const bg = STAGE_BACKGROUNDS.find((b) => b.id === rig.stageBackground) ?? STAGE_BACKGROUNDS[0];
  ctx.fillStyle = bg.cssColor;
  ctx.fillRect(0, 0, w, h);

  if (rig.stageBackground === "dark") {
    const grad = ctx.createRadialGradient(w * 0.5, h * 0.45, 20, w * 0.5, h * 0.5, Math.max(w, h) * 0.65);
    grad.addColorStop(0, "rgba(42, 54, 78, 0.25)");
    grad.addColorStop(1, "rgba(10, 12, 18, 0.35)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  // Smooth face metrics gently at 60 FPS
  const f = frame.face;
  const k = 0.28;
  anim.smoothHeadX = lerp(anim.smoothHeadX, f.present ? f.headX : 0, k);
  anim.smoothHeadY = lerp(anim.smoothHeadY, f.present ? f.headY : 0, k);
  anim.smoothRoll = lerp(anim.smoothRoll, f.present ? f.roll : 0, k);
  anim.smoothYaw = lerp(anim.smoothYaw, f.present ? f.yaw : 0, k);
  anim.smoothPitch = lerp(anim.smoothPitch, f.present ? f.pitch : 0, k);
  anim.smoothMouth = lerp(anim.smoothMouth, f.present ? f.mouthOpen : 0, 0.38);
  anim.smoothSmile = lerp(anim.smoothSmile, f.present ? f.mouthSmile : 0, 0.32);
  anim.smoothBrow = lerp(anim.smoothBrow, f.present ? f.browRaise : 0, 0.32);
  anim.smoothBlinkL = lerp(anim.smoothBlinkL, f.present ? f.eyeBlinkL : 0, 0.48);
  anim.smoothBlinkR = lerp(anim.smoothBlinkR, f.present ? f.eyeBlinkR : 0, 0.48);

  // Periodic natural auto-blink
  let autoBlink = 0;
  if (rig.autoBlinkEnabled) {
    if (now >= anim.nextAutoBlinkMs) {
      anim.autoBlinkStartMs = now;
      anim.nextAutoBlinkMs = now + 2600 + Math.random() * 2800;
    }
    const bt = (now - anim.autoBlinkStartMs) / 170;
    if (bt >= 0 && bt <= 1) {
      autoBlink = Math.sin(bt * Math.PI);
    }
  }

  const blinkL = Math.max(anim.smoothBlinkL, autoBlink);
  const blinkR = Math.max(anim.smoothBlinkR, autoBlink);

  // Subtle idle breathing & sway
  const tSec = now / 1000;
  const idle = rig.idleMotionAmount;
  const breatheY = Math.sin(tSec * 1.9) * 3.5 * idle;
  const idleSwayX = Math.sin(tSec * 0.95) * 4.0 * idle;
  const idleTilt = Math.sin(tSec * 0.8) * 0.025 * idle;

  // Base character dimensions
  const stageUnit = Math.min(w, h) * zoom;
  // When Full Body legs are visible, lock scale to 1.0x so feet stay anchored on floor
  const depthScale = rig.showFullBodyLegs
    ? 1.0
    : lerp(1.0, clamp(f.present ? f.headScale : 1.0, 0.72, 1.35), rig.headScaleAmount);

  const headScalePx = stageUnit * rig.characterScale * depthScale;

  // Head image aspect ratio
  const headImg = images.head;
  const headAspect = headImg && headImg.naturalHeight > 0
    ? headImg.naturalWidth / headImg.naturalHeight
    : 1.0;
  const headW = headScalePx * (rig.partWidthScale.head ?? 1) * (headAspect >= 1 ? 1 : headAspect);
  const headH = headScalePx * (rig.partHeightScale.head ?? 1) * (headAspect >= 1 ? 1 / headAspect : 1);

  // Torso image dimensions scaled proportionally relative to head
  const torsoImg = images.torso;
  const torsoAspect = torsoImg && torsoImg.naturalHeight > 0
    ? torsoImg.naturalWidth / torsoImg.naturalHeight
    : 0.85;
  const torsoH = headH * 1.08 * (rig.partHeightScale.torso ?? 1);
  const torsoW = torsoH * torsoAspect * (rig.partWidthScale.torso ?? 1);

  // Center of character on stage
  const baseAnchorY = rig.showFullBodyLegs ? h * 0.48 : h * 0.62;
  const moveX = anim.smoothHeadX * stageUnit * 0.55 * rig.headMoveAmount;
  const moveY = anim.smoothHeadY * stageUnit * 0.35 * rig.headMoveAmount;

  // Pose torso tilt if tracked
  let poseTorsoAngle = 0;
  const pose = frame.poseLandmarks;
  if (pose && pose.length >= 25) {
    const shMidX = (pose[11].x + pose[12].x) * 0.5;
    const shMidY = (pose[11].y + pose[12].y) * 0.5;
    const hipMidX = (pose[23].x + pose[24].x) * 0.5;
    const hipMidY = (pose[23].y + pose[24].y) * 0.5;
    const lean = Math.atan2(shMidX - hipMidX, hipMidY - shMidY);
    poseTorsoAngle = clamp(lean * 0.45, -0.32, 0.32) * (1 - frame.poseReturnBlend);
  }

  const torsoCenter: Point = {
    x: w * 0.5 + rig.stageOffsetX + moveX * 0.52 + idleSwayX + (rig.partOffsetX.torso ?? 0) * headScalePx,
    y: baseAnchorY + rig.stageOffsetY + moveY * 0.25 + breatheY + (rig.partOffsetY.torso ?? 0) * headScalePx,
  };
  const torsoAngle =
    poseTorsoAngle +
    anim.smoothYaw * 0.06 * rig.bodyTurnAmount +
    idleTilt * 0.5 +
    ((rig.partRotationOffset.torso ?? 0) * Math.PI) / 180;

  // Helper to transform torso local UV -> world stage point
  const torsoPoint = (pinId: string): Point => {
    const uv = getPin(rig, "torso", pinId);
    const lx = (uv.x - 0.5) * torsoW;
    const ly = (uv.y - 0.5) * torsoH;
    const c = Math.cos(torsoAngle);
    const s = Math.sin(torsoAngle);
    return {
      x: torsoCenter.x + lx * c - ly * s,
      y: torsoCenter.y + lx * s + ly * c,
    };
  };

  const neckMountWorld = torsoPoint("neckMount");
  const leftShoulderWorld = torsoPoint("leftShoulder");
  const rightShoulderWorld = torsoPoint("rightShoulder");
  const waistPivotWorld = torsoPoint("waistPivot");

  // Pelvis & Hip World Coordinates
  const pelvisImg = images.pelvis;
  const pelvisAspect = pelvisImg && pelvisImg.naturalHeight > 0
    ? pelvisImg.naturalWidth / pelvisImg.naturalHeight
    : 1.7;
  const pelvisW = torsoW * 0.84 * (rig.partWidthScale.pelvis ?? 1);
  const pelvisH = (pelvisW / Math.max(0.2, pelvisAspect)) * (rig.partHeightScale.pelvis ?? 1);
  const pelvisWaistUV = getPin(rig, "pelvis", "waistJoint");
  const pelvisAngle = torsoAngle * 0.45 + ((rig.partRotationOffset.pelvis ?? 0) * Math.PI) / 180;

  const pelvisPoint = (pinId: string): Point => {
    const uv = getPin(rig, "pelvis", pinId);
    const lx = (uv.x - pelvisWaistUV.x) * pelvisW;
    const ly = (uv.y - pelvisWaistUV.y) * pelvisH;
    const c = Math.cos(pelvisAngle);
    const s = Math.sin(pelvisAngle);
    return {
      x: waistPivotWorld.x + lx * c - ly * s,
      y: waistPivotWorld.y + lx * s + ly * c,
    };
  };

  const hasPelvis = rig.partEnabled.pelvis && Boolean(pelvisImg);
  const leftHipWorld = hasPelvis
    ? pelvisPoint("leftHip")
    : { x: waistPivotWorld.x - torsoW * 0.22, y: waistPivotWorld.y + torsoH * 0.08 };
  const rightHipWorld = hasPelvis
    ? pelvisPoint("rightHip")
    : { x: waistPivotWorld.x + torsoW * 0.22, y: waistPivotWorld.y + torsoH * 0.08 };

  // ── Compute Arm 2-Bone IK (Left & Right) ──
  const upperArmLen = torsoH * 0.56 * rig.armLengthScale;
  const forearmLen = torsoH * 0.52 * rig.armLengthScale;

  const computeArmIK = (side: "L" | "R") => {
    const isLeft = side === "L";
    const shoulder = isLeft ? leftShoulderWorld : rightShoulderWorld;
    const restWrist: Point = {
      x: shoulder.x + (isLeft ? -1 : 1) * (upperArmLen * 0.34),
      y: shoulder.y + (upperArmLen + forearmLen) * 0.84,
    };
    const restElbowPole: Point = {
      x: shoulder.x + (isLeft ? -1 : 1) * upperArmLen * 0.85,
      y: shoulder.y + upperArmLen * 0.55,
    };

    const handObj: TrackedHand | undefined = frame.hands.find((hh) => hh.label === side);
    let targetWrist: Point | null = null;
    let elbowPole: Point = restElbowPole;
    let wristAngle = isLeft ? Math.PI * 0.58 : Math.PI * 0.42;
    let palmSign = 1;
    let returnBlend = 1;

    // Map camera coordinates around torso shoulder baseline isotropically
    const aspect = frame.frameAspect || 16 / 9;
    const camShSpan = Math.max(0.12, cal.shoulderSpan);
    const stageShSpan = Math.max(24, dist(leftShoulderWorld, rightShoulderWorld));
    const reachBoost = 1 + rig.armReachExaggeration * 0.9;
    const pxPerCamUnit = (stageShSpan / camShSpan) * reachBoost;

    let camOriginX = isLeft ? cal.leftShoulderX : cal.rightShoulderX;
    let camOriginY = isLeft ? cal.leftShoulderY : cal.rightShoulderY;
    let camElbow: Point | null = null;
    let camPoseWrist: Point | null = null;

    if (pose && pose.length >= 17) {
      // Screen-X sorted pose shoulders/elbows/wrists so left/right match puppet side cleanly
      const p11 = pose[11];
      const p12 = pose[12];
      const leftIdx = p11.x <= p12.x ? 11 : 12;
      const rightIdx = leftIdx === 11 ? 12 : 11;
      const shIdx = isLeft ? leftIdx : rightIdx;
      const elIdx = shIdx + 2; // 13 or 14
      const wrIdx = shIdx + 4; // 15 or 16
      camOriginX = pose[shIdx].x;
      camOriginY = pose[shIdx].y;
      camElbow = pose[elIdx];
      camPoseWrist = pose[wrIdx];
    }

    if (handObj && handObj.landmarks.length >= 10) {
      const wLm = handObj.landmarks[0];
      const rawStageTarget: Point = {
        x: shoulder.x + (wLm.x - camOriginX) * pxPerCamUnit * aspect * 0.65,
        y: shoulder.y + (wLm.y - camOriginY) * pxPerCamUnit,
      };
      returnBlend = handObj.returnToRestBlend;
      targetWrist = lerpPt(rawStageTarget, restWrist, returnBlend);
      wristAngle = lerp(handObj.wristAngle, isLeft ? Math.PI * 0.58 : Math.PI * 0.42, returnBlend);
      palmSign = handObj.palmFacingSign;
    } else if (camPoseWrist && frame.posePresent) {
      const rawStageTarget: Point = {
        x: shoulder.x + (camPoseWrist.x - camOriginX) * pxPerCamUnit * aspect * 0.65,
        y: shoulder.y + (camPoseWrist.y - camOriginY) * pxPerCamUnit,
      };
      returnBlend = frame.poseReturnBlend;
      targetWrist = lerpPt(rawStageTarget, restWrist, returnBlend);
      if (camElbow) {
        wristAngle = Math.atan2(camPoseWrist.y - camElbow.y, camPoseWrist.x - camElbow.x);
      }
    }

    if (camElbow) {
      const camPole: Point = {
        x: shoulder.x + (camElbow.x - camOriginX) * pxPerCamUnit * aspect * 0.65,
        y: shoulder.y + (camElbow.y - camOriginY) * pxPerCamUnit,
      };
      // Blend camera elbow hint with natural outward pole
      elbowPole = {
        x: lerp(restElbowPole.x, camPole.x, 0.72 * (1 - returnBlend)),
        y: lerp(restElbowPole.y, camPole.y, 0.72 * (1 - returnBlend)),
      };
    }

    const finalTarget = targetWrist ?? restWrist;
    const solved = solve2BoneIK(shoulder, finalTarget, upperArmLen, forearmLen, elbowPole);

    return {
      shoulder,
      elbow: solved.joint,
      wrist: solved.end,
      wristAngle,
      palmSign,
      tracked: Boolean(targetWrist && returnBlend < 0.99),
    };
  };

  const leftArm = computeArmIK("L");
  const rightArm = computeArmIK("R");

  // ── Compute Leg 2-Bone IK (Ground-Anchored + Free Leg Lifting / High Kicks!) ──
  const thighLen = torsoH * 0.56 * rig.legLengthScale;
  const shinLen = torsoH * 0.54 * rig.legLengthScale;
  const floorY =
    baseAnchorY + rig.stageOffsetY + torsoH * 0.5 + pelvisH * 0.55 + thighLen + shinLen * 0.94;

  const computeLegIK = (side: "L" | "R") => {
    const isLeft = side === "L";
    const hip = isLeft ? leftHipWorld : rightHipWorld;
    const defaultFoot: Point = {
      x: hip.x + (isLeft ? -1 : 1) * torsoW * 0.08,
      y: Math.min(floorY, hip.y + (thighLen + shinLen) * 0.96),
    };
    const defaultKneePole: Point = {
      x: hip.x + (isLeft ? -1 : 1) * thighLen * 0.45,
      y: hip.y + thighLen * 0.55,
    };

    let targetAnkle = defaultFoot;
    let kneePole = defaultKneePole;

    if (pose && pose.length >= 29 && frame.posePresent) {
      // Match left/right legs strictly by projected screen X (fixes mirrored leg swap!)
      const p23 = pose[23];
      const p24 = pose[24];
      const leftHipIdx = p23.x <= p24.x ? 23 : 24;
      const rightHipIdx = leftHipIdx === 23 ? 24 : 23;
      const hipIdx = isLeft ? leftHipIdx : rightHipIdx;
      const kneeIdx = hipIdx + 2; // 25 or 26
      const ankleIdx = hipIdx + 4; // 27 or 28

      const cHip = pose[hipIdx];
      const cKnee = pose[kneeIdx];
      const cAnkle = pose[ankleIdx];

      const camLegLen = Math.max(0.15, dist(cHip, cKnee) + dist(cKnee, cAnkle));
      const scaleLeg = (thighLen + shinLen) / camLegLen;
      const aspect = frame.frameAspect || 16 / 9;

      const rawAnkle: Point = {
        x: hip.x + (cAnkle.x - cHip.x) * scaleLeg * aspect * 0.62,
        y: hip.y + (cAnkle.y - cHip.y) * scaleLeg,
      };
      const rawKnee: Point = {
        x: hip.x + (cKnee.x - cHip.x) * scaleLeg * aspect * 0.62,
        y: hip.y + (cKnee.y - cHip.y) * scaleLeg,
      };

      // Only lift leg when user actually lifts ankle noticeably above resting floor
      const liftedHeight = defaultFoot.y - rawAnkle.y;
      const isLifted = liftedHeight > stageUnit * 0.025;
      const clampedAnkle: Point = {
        x: isLifted ? rawAnkle.x : lerp(defaultFoot.x, rawAnkle.x, 0.35),
        y: Math.min(floorY, isLifted ? rawAnkle.y : defaultFoot.y),
      };
      targetAnkle = lerpPt(clampedAnkle, defaultFoot, frame.poseReturnBlend);
      kneePole = lerpPt(rawKnee, defaultKneePole, frame.poseReturnBlend);
    }

    const solved = solve2BoneIK(hip, targetAnkle, thighLen, shinLen, kneePole);
    return { hip, knee: solved.joint, ankle: solved.end };
  };

  const leftLeg = computeLegIK("L");
  const rightLeg = computeLegIK("R");

  // ── Render All Layers Strictly Back-to-Front (reverse of layerStack) ──
  const backToFront = [...rig.layerStack].reverse();

  for (const slot of backToFront) {
    if (
      !rig.showFullBodyLegs &&
      (slot === "pelvis" ||
        slot === "leftThigh" ||
        slot === "rightThigh" ||
        slot === "leftShin" ||
        slot === "rightShin" ||
        slot === "leftFoot" ||
        slot === "rightFoot")
    ) {
      continue;
    }

    if (slot === "tail") {
      const img = images.tail;
      if (!rig.partEnabled.tail || !img) continue;
      const baseUV = getPin(rig, "tail", "tailBase");
      const tailW = torsoW * 1.05 * (rig.partWidthScale.tail ?? 1);
      const tailH =
        (tailW / Math.max(0.2, img.naturalWidth / Math.max(1, img.naturalHeight))) *
        (rig.partHeightScale.tail ?? 1);
      const sway = Math.sin(tSec * 2.1) * 0.14 * Math.max(0.25, idle) - anim.smoothYaw * 0.22;
      ctx.save();
      ctx.translate(
        waistPivotWorld.x + (rig.partOffsetX.tail ?? 0) * headScalePx,
        waistPivotWorld.y + (rig.partOffsetY.tail ?? 0) * headScalePx,
      );
      ctx.rotate(torsoAngle * 0.5 + sway + ((rig.partRotationOffset.tail ?? 0) * Math.PI) / 180);
      ctx.scale(rig.partFlipH.tail ? -1 : 1, rig.partFlipV.tail ? -1 : 1);
      ctx.drawImage(img, -baseUV.x * tailW, -baseUV.y * tailH, tailW, tailH);
      ctx.restore();
      continue;
    }

    if (slot === "pelvis") {
      if (!hasPelvis || !pelvisImg) continue;
      ctx.save();
      ctx.translate(
        waistPivotWorld.x + (rig.partOffsetX.pelvis ?? 0) * headScalePx,
        waistPivotWorld.y + (rig.partOffsetY.pelvis ?? 0) * headScalePx,
      );
      ctx.rotate(pelvisAngle);
      ctx.scale(rig.partFlipH.pelvis ? -1 : 1, rig.partFlipV.pelvis ? -1 : 1);
      ctx.drawImage(
        pelvisImg,
        -pelvisWaistUV.x * pelvisW,
        -pelvisWaistUV.y * pelvisH,
        pelvisW,
        pelvisH,
      );
      ctx.restore();
      continue;
    }

    if (slot === "torso") {
      if (!rig.partEnabled.torso || !torsoImg) continue;
      ctx.save();
      ctx.translate(torsoCenter.x, torsoCenter.y);
      ctx.rotate(torsoAngle);
      ctx.scale(rig.partFlipH.torso ? -1 : 1, rig.partFlipV.torso ? -1 : 1);
      ctx.drawImage(torsoImg, -torsoW * 0.5, -torsoH * 0.5, torsoW, torsoH);
      ctx.restore();
      continue;
    }

    if (slot === "leftThigh" || slot === "rightThigh") {
      const img = images[slot];
      if (!rig.partEnabled[slot] || !img) continue;
      const leg = slot === "leftThigh" ? leftLeg : rightLeg;
      drawLimbSegment(
        ctx,
        img,
        leg.hip,
        leg.knee,
        getPin(rig, slot, "hipJoint"),
        getPin(rig, slot, "kneeJoint"),
        rig.legThicknessScale,
        rig.partWidthScale[slot] ?? 1,
        rig.partHeightScale[slot] ?? 1,
        rig.partRotationOffset[slot] ?? 0,
        Boolean(rig.partFlipH[slot]),
        Boolean(rig.partFlipV[slot]),
      );
      continue;
    }

    if (slot === "leftShin" || slot === "rightShin") {
      const img = images[slot];
      if (!rig.partEnabled[slot] || !img) continue;
      const leg = slot === "leftShin" ? leftLeg : rightLeg;
      drawLimbSegment(
        ctx,
        img,
        leg.knee,
        leg.ankle,
        getPin(rig, slot, "kneeJoint"),
        getPin(rig, slot, "ankleJoint"),
        rig.legThicknessScale,
        rig.partWidthScale[slot] ?? 1,
        rig.partHeightScale[slot] ?? 1,
        rig.partRotationOffset[slot] ?? 0,
        Boolean(rig.partFlipH[slot]),
        Boolean(rig.partFlipV[slot]),
      );
      continue;
    }

    if (slot === "leftFoot" || slot === "rightFoot") {
      const img = images[slot];
      if (!rig.partEnabled[slot] || !img) continue;
      const leg = slot === "leftFoot" ? leftLeg : rightLeg;
      const ankleUV = getPin(rig, slot, "ankleJoint");
      const footW = torsoW * 0.34 * rig.legThicknessScale * (rig.partWidthScale[slot] ?? 1);
      const footH =
        (footW / Math.max(0.2, img.naturalWidth / Math.max(1, img.naturalHeight))) *
        (rig.partHeightScale[slot] ?? 1);
      ctx.save();
      ctx.translate(leg.ankle.x, leg.ankle.y);
      ctx.rotate(((rig.partRotationOffset[slot] ?? 0) * Math.PI) / 180);
      ctx.scale(rig.partFlipH[slot] ? -1 : 1, rig.partFlipV[slot] ? -1 : 1);
      ctx.drawImage(img, -ankleUV.x * footW, -ankleUV.y * footH, footW, footH);
      ctx.restore();
      continue;
    }

    if (slot === "leftUpperArm" || slot === "rightUpperArm") {
      const img = images[slot];
      if (!rig.partEnabled[slot] || !img) continue;
      const arm = slot === "leftUpperArm" ? leftArm : rightArm;
      drawLimbSegment(
        ctx,
        img,
        arm.shoulder,
        arm.elbow,
        getPin(rig, slot, "shoulderJoint"),
        getPin(rig, slot, "elbowJoint"),
        rig.armThicknessScale,
        rig.partWidthScale[slot] ?? 1,
        rig.partHeightScale[slot] ?? 1,
        rig.partRotationOffset[slot] ?? 0,
        Boolean(rig.partFlipH[slot]),
        Boolean(rig.partFlipV[slot]),
      );
      continue;
    }

    if (slot === "leftForearm" || slot === "rightForearm") {
      const img = images[slot];
      if (!rig.partEnabled[slot] || !img) continue;
      const arm = slot === "leftForearm" ? leftArm : rightArm;
      drawLimbSegment(
        ctx,
        img,
        arm.elbow,
        arm.wrist,
        getPin(rig, slot, "elbowJoint"),
        getPin(rig, slot, "wristJoint"),
        rig.armThicknessScale,
        rig.partWidthScale[slot] ?? 1,
        rig.partHeightScale[slot] ?? 1,
        rig.partRotationOffset[slot] ?? 0,
        Boolean(rig.partFlipH[slot]),
        Boolean(rig.partFlipV[slot]),
      );
      continue;
    }

    if (slot === "leftHand" || slot === "rightHand") {
      const isLeft = slot === "leftHand";
      const arm = isLeft ? leftArm : rightArm;
      const backSlot: PuppetPartSlot = isLeft ? "leftHandBack" : "rightHandBack";
      const useBackSprite =
        rig.dynamicPalmFlip &&
        arm.palmSign < 0 &&
        rig.partEnabled[backSlot] &&
        Boolean(images[backSlot]);
      const activeSlot = useBackSprite ? backSlot : slot;
      const img = images[activeSlot];
      if (!rig.partEnabled[slot] || !img) continue;

      const wristPin = getPin(rig, activeSlot, "wristPivot");
      const fingerPin = getPin(rig, activeSlot, "middleKnuckle");
      const nw = img.naturalWidth || 160;
      const nh = img.naturalHeight || 190;
      const handBase = stageUnit * rig.handScale * depthScale;
      const hAspect = nw / Math.max(1, nh);
      const drawW = handBase * (rig.partWidthScale[activeSlot] ?? 1) * (hAspect >= 1 ? 1 : hAspect);
      const drawH = handBase * (rig.partHeightScale[activeSlot] ?? 1) * (hAspect >= 1 ? 1 / hAspect : 1);

      // Local-axis hand transform: undo sprite intrinsic finger angle BEFORE palm flip!
      const intrinsicHandAngle = Math.atan2(
        (fingerPin.y - wristPin.y) * drawH,
        (fingerPin.x - wristPin.x) * drawW,
      );
      const shouldMirrorFlip =
        rig.dynamicPalmFlip && arm.palmSign < 0 && !useBackSprite;
      const flipX = (rig.partFlipH[activeSlot] ? -1 : 1) * (shouldMirrorFlip ? -1 : 1);
      const flipY = rig.partFlipV[activeSlot] ? -1 : 1;

      ctx.save();
      ctx.translate(arm.wrist.x, arm.wrist.y);
      ctx.rotate(arm.wristAngle + ((rig.partRotationOffset[activeSlot] ?? 0) * Math.PI) / 180);
      // Flip perpendicular to finger axis (local Y) when palm turns around
      ctx.scale(1, flipX * flipY);
      ctx.rotate(-intrinsicHandAngle);
      ctx.drawImage(img, -wristPin.x * drawW, -wristPin.y * drawH, drawW, drawH);
      ctx.restore();
      continue;
    }

    if (slot === "head") {
      if (!rig.partEnabled.head || !headImg) continue;
      const neckPin = getPin(rig, "head", "neckPivot");
      const leftEyePin = getPin(rig, "head", "leftEye");
      const rightEyePin = getPin(rig, "head", "rightEye");
      const leftBrowPin = getPin(rig, "head", "leftBrow");
      const rightBrowPin = getPin(rig, "head", "rightBrow");
      const nosePin = getPin(rig, "head", "noseCenter");
      const mouthPin = getPin(rig, "head", "mouthCenter");

      const headRot =
        anim.smoothRoll * rig.headTiltAmount +
        idleTilt +
        ((rig.partRotationOffset.head ?? 0) * Math.PI) / 180;
      const parallaxX = anim.smoothYaw * headW * 0.085 * rig.headTurnParallax;
      const parallaxY = anim.smoothPitch * headH * 0.055 * rig.headTurnParallax;
      const yawScaleX = 1 - Math.abs(anim.smoothYaw) * 0.07 * rig.headTurnParallax;

      ctx.save();
      ctx.translate(
        neckMountWorld.x + moveX * 0.16 + (rig.partOffsetX.head ?? 0) * headScalePx,
        neckMountWorld.y + moveY * 0.18 + (rig.partOffsetY.head ?? 0) * headScalePx,
      );
      ctx.rotate(headRot);
      ctx.scale((rig.partFlipH.head ? -1 : 1) * yawScaleX, rig.partFlipV.head ? -1 : 1);

      const useJawWarp =
        rig.jawWarpEnabled && rig.mouthAnimationMode !== "sprites";
      drawDeformedHead(
        ctx,
        headImg,
        headW,
        headH,
        neckPin,
        mouthPin.y,
        (leftBrowPin.y + rightBrowPin.y) * 0.5,
        useJawWarp ? anim.smoothMouth * rig.jawWarpAmount : 0,
        anim.smoothBrow * rig.browWarpAmount,
      );

      // Helper to convert head UV to local head canvas coordinates
      const headLocal = (uv: Point, depthMul = 1): Point => ({
        x: (uv.x - neckPin.x) * headW + parallaxX * depthMul,
        y: (uv.y - neckPin.y) * headH + parallaxY * depthMul,
      });

      // ── Eyes (Independent Left & Right Wink/Blink) ──
      const drawEye = (isLeft: boolean) => {
        const openSlot: PuppetPartSlot = isLeft ? "eyesOpen" : "rightEyeOpen";
        const closedSlot: PuppetPartSlot = isLeft ? "eyesClosed" : "rightEyeClosed";
        const eyePin = isLeft ? leftEyePin : rightEyePin;
        const blinkVal = isLeft ? blinkL : blinkR;
        const isClosed = blinkVal >= rig.blinkThreshold;

        // Fall back to mirrored left eye if right eye sprite isn't populated
        const openImg = images[openSlot] ?? (!isLeft ? images.eyesOpen : undefined);
        const closedImg = images[closedSlot] ?? (!isLeft ? images.eyesClosed : undefined);
        const enabled = rig.partEnabled[openSlot] || (!isLeft && rig.partEnabled.eyesOpen);
        if (!enabled || (!openImg && !closedImg)) return;

        const useClosedSprite =
          rig.eyeAnimationMode !== "squash" && isClosed && Boolean(closedImg);
        const sprite = useClosedSprite ? closedImg! : (openImg ?? closedImg!);
        const activeSlot = useClosedSprite ? closedSlot : openSlot;

        const baseW = headW * 0.24 * rig.eyeSpriteScale * (rig.partWidthScale[activeSlot] ?? 1);
        const aspect = sprite.naturalWidth / Math.max(1, sprite.naturalHeight);
        const baseH = (baseW / Math.max(0.2, aspect)) * (rig.partHeightScale[activeSlot] ?? 1);

        const squashY =
          rig.eyeAnimationMode === "sprite"
            ? 1
            : useClosedSprite
              ? 1
              : clamp(1 - blinkVal * 0.88, 0.12, 1);

        const pos = headLocal(eyePin, 1.0);
        const mirrorFallback = !isLeft && !images.rightEyeOpen && !useClosedSprite;
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(((rig.partRotationOffset[activeSlot] ?? 0) * Math.PI) / 180);
        ctx.scale(
          (rig.partFlipH[activeSlot] ? -1 : 1) * (mirrorFallback ? -1 : 1),
          (rig.partFlipV[activeSlot] ? -1 : 1) * squashY,
        );
        ctx.drawImage(sprite, -baseW * 0.5, -baseH * 0.5, baseW, baseH);
        ctx.restore();
      };

      drawEye(true);
      drawEye(false);

      // ── Eyebrows ──
      const drawBrow = (isLeft: boolean) => {
        const bSlot: PuppetPartSlot = isLeft ? "browsOverlay" : "rightBrows";
        const img = images[bSlot] ?? (!isLeft ? images.browsOverlay : undefined);
        if (!rig.partEnabled[bSlot] || !img) return;
        const pos = headLocal(isLeft ? leftBrowPin : rightBrowPin, 1.05);
        const liftY = -anim.smoothBrow * headH * 0.045 * rig.browWarpAmount;
        const bw = headW * 0.24 * rig.eyeSpriteScale * (rig.partWidthScale[bSlot] ?? 1);
        const bh =
          (bw / Math.max(0.2, img.naturalWidth / Math.max(1, img.naturalHeight))) *
          (rig.partHeightScale[bSlot] ?? 1);
        ctx.save();
        ctx.translate(pos.x, pos.y + liftY);
        ctx.rotate(((rig.partRotationOffset[bSlot] ?? 0) * Math.PI) / 180);
        ctx.scale(rig.partFlipH[bSlot] ? -1 : 1, rig.partFlipV[bSlot] ? -1 : 1);
        ctx.drawImage(img, -bw * 0.5, -bh * 0.5, bw, bh);
        ctx.restore();
      };
      drawBrow(true);
      drawBrow(false);

      // ── Nose Overlay (extra 2.5D depth parallax) ──
      if (rig.partEnabled.noseOverlay && images.noseOverlay) {
        const img = images.noseOverlay;
        const pos = headLocal(nosePin, 1.35);
        const nw = headW * 0.22 * rig.noseSpriteScale * (rig.partWidthScale.noseOverlay ?? 1);
        const nh =
          (nw / Math.max(0.2, img.naturalWidth / Math.max(1, img.naturalHeight))) *
          (rig.partHeightScale.noseOverlay ?? 1);
        ctx.save();
        ctx.translate(pos.x, pos.y);
        ctx.rotate(((rig.partRotationOffset.noseOverlay ?? 0) * Math.PI) / 180);
        ctx.scale(rig.partFlipH.noseOverlay ? -1 : 1, rig.partFlipV.noseOverlay ? -1 : 1);
        ctx.drawImage(img, -nw * 0.5, -nh * 0.5, nw, nh);
        ctx.restore();
      }

      // ── Mouth Visemes ──
      if (rig.mouthAnimationMode !== "warp") {
        let mouthSlot: PuppetPartSlot = "mouthNeutral";
        if (f.viseme === "wide" || f.viseme === "ah") {
          mouthSlot = images.mouthAh ? "mouthAh" : "mouthNeutral";
        } else if (f.viseme === "oh") {
          mouthSlot = images.mouthOh ? "mouthOh" : images.mouthAh ? "mouthAh" : "mouthNeutral";
        } else if (f.viseme === "smile") {
          mouthSlot = images.mouthSmile ? "mouthSmile" : "mouthNeutral";
        }
        const mImg = images[mouthSlot] ?? images.mouthNeutral;
        if (mImg && (rig.partEnabled[mouthSlot] || rig.partEnabled.mouthNeutral)) {
          const pos = headLocal(mouthPin, 1.12);
          const jawDrop = useJawWarp ? anim.smoothMouth * rig.jawWarpAmount * headH * 0.03 : 0;
          const mw = headW * 0.34 * rig.mouthSpriteScale * (rig.partWidthScale[mouthSlot] ?? 1);
          const mh =
            (mw / Math.max(0.2, mImg.naturalWidth / Math.max(1, mImg.naturalHeight))) *
            (rig.partHeightScale[mouthSlot] ?? 1);
          const speakScaleY =
            rig.mouthAnimationMode === "hybrid"
              ? 1 + anim.smoothMouth * (mouthSlot === "mouthNeutral" ? 0.35 : 0.22)
              : 1;
          const speakScaleX =
            rig.mouthAnimationMode === "hybrid"
              ? 1 + anim.smoothSmile * 0.14
              : 1;
          ctx.save();
          ctx.translate(pos.x, pos.y + jawDrop);
          ctx.rotate(((rig.partRotationOffset[mouthSlot] ?? 0) * Math.PI) / 180);
          ctx.scale(
            (rig.partFlipH[mouthSlot] ? -1 : 1) * speakScaleX,
            (rig.partFlipV[mouthSlot] ? -1 : 1) * speakScaleY,
          );
          ctx.drawImage(mImg, -mw * 0.5, -mh * 0.5, mw, mh);
          ctx.restore();
        }
      }

      ctx.restore();
    }
  }

  // Optional debug joint pins overlay
  if (showPins) {
    const drawDot = (pt: Point, color: string, label: string) => {
      ctx.save();
      ctx.fillStyle = color;
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = "10px monospace";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, pt.x + 7, pt.y + 3);
      ctx.restore();
    };
    drawDot(neckMountWorld, "#22d3ee", "Neck");
    drawDot(leftShoulderWorld, "#38bdf8", "L.Sh");
    drawDot(rightShoulderWorld, "#38bdf8", "R.Sh");
    drawDot(leftArm.elbow, "#a78bfa", "L.Elb");
    drawDot(rightArm.elbow, "#a78bfa", "R.Elb");
    drawDot(leftArm.wrist, "#4ade80", "L.Wr");
    drawDot(rightArm.wrist, "#4ade80", "R.Wr");
    drawDot(waistPivotWorld, "#fbbf24", "Waist");
    if (rig.showFullBodyLegs) {
      drawDot(leftLeg.hip, "#f472b6", "L.Hip");
      drawDot(rightLeg.hip, "#f472b6", "R.Hip");
      drawDot(leftLeg.knee, "#fb7185", "L.Knee");
      drawDot(rightLeg.knee, "#fb7185", "R.Knee");
      drawDot(leftLeg.ankle, "#34d399", "L.Ank");
      drawDot(rightLeg.ankle, "#34d399", "R.Ank");
    }
  }
}
