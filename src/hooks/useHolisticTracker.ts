import { useEffect, useRef, useState, useCallback } from "react";
import {
  GestureRecognizer,
  PoseLandmarker,
  FaceLandmarker,
  FilesetResolver,
  type GestureRecognizerResult,
  type PoseLandmarkerResult,
  type FaceLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { LandmarkSmoother } from "@/lib/oneEuro";
import { pinchAmount, type Landmark } from "@/lib/gestures";
import { sendOsc, type OscMessage } from "@/lib/oscBridge";
import { FACE_TIERS, type FaceTier } from "@/lib/faceSubsets";
import {
  createDefaultCalibration,
  createEmptyFaceMetrics,
  createEmptyTrackedFrame,
  type CalibrationBaseline,
  type InputSourceMode,
  type SpeechViseme,
  type TrackedFaceMetrics,
  type TrackedFrame,
  type TrackedHand,
} from "@/lib/trackingTypes";

export type MappingMode = "normalized" | "centered_aspect";

export type TrackerSettings = {
  host: string;
  port: number;
  fps: number;
  mirror: boolean;
  smoothMinCutoff: number;
  smoothBeta: number;
  mapping: MappingMode;
  screenWidth: number;
  screenHeight: number;

  // Hands
  trackHands: boolean;
  handsSendLandmarks: boolean;
  handsSendBundled: boolean;
  handsSendAxisGrouped: boolean;
  handsSendGesture: boolean;

  // Pose
  trackPose: boolean;
  poseSendLandmarks: boolean;
  poseSendBundled: boolean;
  poseSendAxisGrouped: boolean;

  // Face
  trackFace: boolean;
  faceTier: FaceTier;
  faceSendLandmarks: boolean;
  faceSendBundled: boolean;
  faceSendAxisGrouped: boolean;
  faceSendBlendshapes: boolean;
};

export type TrackerStats = {
  fps: number;
  msgsPerSec: number;
  hands: number;
  poses: number;
  faces: number;
  gestures: { L?: string; R?: string };
  viseme: SpeechViseme;
  faceSummary: {
    mouthOpen: number;
    mouthSmile: number;
    mouthPucker: number;
    browRaise: number;
    eyeBlinkL: number;
    eyeBlinkR: number;
  };
  lastError?: string;
};

const GESTURE_MODEL = "./mediapipe/gesture_recognizer.task";
const POSE_MODEL = "./mediapipe/pose_landmarker_full.task";
const FACE_MODEL = "./mediapipe/face_landmarker.task";
const WASM_URL = "./mediapipe/wasm";

const HAND_HOLD_MS = 2000;
const HAND_GLIDE_MS = 1600;
const POSE_HOLD_MS = 2000;
const POSE_GLIDE_MS = 1600;
const FACE_HOLD_MS = 2000;
const FACE_GLIDE_MS = 1600;

interface HandCacheEntry {
  hand: TrackedHand;
  lastSeenMs: number;
}

export interface HolisticTrackerReturn {
  stats: TrackerStats;
  frameRef: React.MutableRefObject<TrackedFrame>;
  calibration: CalibrationBaseline;
  countdownSeconds: number | null;
  inputSource: InputSourceMode;
  mediaFileName: string | null;
  videoPlaying: boolean;
  calibrateNow: () => void;
  startCountdownCalibration: (seconds?: number) => void;
  resetCalibration: () => void;
  loadVideoFile: (file: File) => void;
  loadImageFile: (file: File) => void;
  switchToCamera: () => void;
  toggleVideoPlayPause: () => void;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function dist2D(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function useHolisticTracker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  deviceId: string | null,
  settings: TrackerSettings,
  running: boolean,
  pausedForModal = false,
): HolisticTrackerReturn {
  const [stats, setStats] = useState<TrackerStats>({
    fps: 0,
    msgsPerSec: 0,
    hands: 0,
    poses: 0,
    faces: 0,
    gestures: {},
    viseme: "neutral",
    faceSummary: {
      mouthOpen: 0,
      mouthSmile: 0,
      mouthPucker: 0,
      browRaise: 0,
      eyeBlinkL: 0,
      eyeBlinkR: 0,
    },
  });

  const [calibration, setCalibration] = useState<CalibrationBaseline>(() =>
    createDefaultCalibration(),
  );
  const calibrationRef = useRef<CalibrationBaseline>(calibration);
  calibrationRef.current = calibration;

  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const [inputSource, setInputSource] = useState<InputSourceMode>("camera");
  const inputSourceRef = useRef<InputSourceMode>("camera");
  inputSourceRef.current = inputSource;

  const [mediaFileName, setMediaFileName] = useState<string | null>(null);
  const [videoPlaying, setVideoPlaying] = useState(true);

  const frameRef = useRef<TrackedFrame>(createEmptyTrackedFrame());
  const latestRawFaceRef = useRef<{
    anchorX: number;
    anchorY: number;
    iod: number;
    verticalSkull: number;
    roll: number;
    yaw: number;
    pitch: number;
  } | null>(null);
  const latestPoseRef = useRef<Landmark[] | null>(null);

  const handLm = useRef<GestureRecognizer | null>(null);
  const poseLm = useRef<PoseLandmarker | null>(null);
  const faceLm = useRef<FaceLandmarker | null>(null);
  const lastMpTimestampRef = useRef<number>(0);
  const lastSmoothTimestampRef = useRef<number>(0);

  // Reference media objects
  const mediaObjectUrlRef = useRef<string | null>(null);
  const refImageElRef = useRef<HTMLImageElement | null>(null);
  const refImageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaVersionRef = useRef<number>(0);
  const [mediaVersion, setMediaVersion] = useState(0);

  const smootherRef = useRef(
    new LandmarkSmoother(settings.smoothMinCutoff, settings.smoothBeta),
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const pausedRef = useRef(pausedForModal);
  pausedRef.current = pausedForModal;

  // Temporal persistence caches for smooth hold -> glide -> reset
  const handCacheRef = useRef<Partial<Record<"L" | "R", HandCacheEntry>>>({});
  const poseCacheRef = useRef<{
    landmarks: Landmark[] | null;
    lastSeenMs: number;
  }>({ landmarks: null, lastSeenMs: 0 });
  const faceCacheRef = useRef<{
    metrics: TrackedFaceMetrics;
    lastSeenMs: number;
    lockedHeadScale: number;
  }>({
    metrics: createEmptyFaceMetrics(),
    lastSeenMs: 0,
    lockedHeadScale: 1,
  });

  useEffect(() => {
    smootherRef.current.setParams(settings.smoothMinCutoff, settings.smoothBeta);
  }, [settings.smoothMinCutoff, settings.smoothBeta]);

  const calibrateNow = useCallback(() => {
    const rawFace = latestRawFaceRef.current;
    const pose = latestPoseRef.current;
    const next: CalibrationBaseline = { ...calibrationRef.current, calibrated: true };

    if (rawFace) {
      next.anchorX = rawFace.anchorX;
      next.anchorY = rawFace.anchorY;
      next.iod = Math.max(0.03, rawFace.iod);
      next.verticalSkull = Math.max(0.04, rawFace.verticalSkull);
      next.rollOffset = rawFace.roll;
      next.yawOffset = rawFace.yaw;
      next.pitchOffset = rawFace.pitch;
    }

    if (pose && pose.length >= 25) {
      const aspect = frameRef.current.frameAspect || 16 / 9;
      const p11 = pose[11];
      const p12 = pose[12];
      const leftSh = p11.x <= p12.x ? p11 : p12;
      const rightSh = p11.x <= p12.x ? p12 : p11;
      const shSpanIso = Math.max(
        0.12,
        Math.hypot((rightSh.x - leftSh.x) * aspect, rightSh.y - leftSh.y),
      );
      next.shoulderSpan = shSpanIso;
      next.leftShoulderX = leftSh.x;
      next.leftShoulderY = leftSh.y;
      next.rightShoulderX = rightSh.x;
      next.rightShoulderY = rightSh.y;

      const p23 = pose[23];
      const p24 = pose[24];
      if (p23 && p24) {
        next.hipCenterX = (p23.x + p24.x) * 0.5;
        next.hipCenterY = (p23.y + p24.y) * 0.5;
      }

      // Measure calibrated isotropic upper arm & forearm lengths
      const isoDist = (a: Landmark, b: Landmark) =>
        Math.hypot((b.x - a.x) * aspect, b.y - a.y);
      const p13 = pose[13];
      const p14 = pose[14];
      const p15 = pose[15];
      const p16 = pose[16];
      const u1 = p13 && (p13.visibility ?? 1) >= 0.55 ? isoDist(p11, p13) : 0;
      const u2 = p14 && (p14.visibility ?? 1) >= 0.55 ? isoDist(p12, p14) : 0;
      const f1 = p13 && p15 && (p15.visibility ?? 1) >= 0.55 ? isoDist(p13, p15) : 0;
      const f2 = p14 && p16 && (p16.visibility ?? 1) >= 0.55 ? isoDist(p14, p16) : 0;
      const bestU = Math.max(u1, u2);
      const bestF = Math.max(f1, f2);
      if (bestU > 0.08 && bestF > 0.08) {
        next.calibratedUpperArmLen = bestU;
        next.calibratedForearmLen = bestF;
        next.armSpan = bestU + bestF;
      }
    }

    calibrationRef.current = next;
    setCalibration(next);
  }, []);

  const countdownTimerRef = useRef<number | null>(null);
  const startCountdownCalibration = useCallback(
    (seconds = 3) => {
      if (countdownTimerRef.current !== null) {
        window.clearInterval(countdownTimerRef.current);
      }
      let remaining = seconds;
      setCountdownSeconds(remaining);
      countdownTimerRef.current = window.setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          if (countdownTimerRef.current !== null) {
            window.clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          setCountdownSeconds(null);
          calibrateNow();
        } else {
          setCountdownSeconds(remaining);
        }
      }, 1000);
    },
    [calibrateNow],
  );

  const resetCalibration = useCallback(() => {
    const def = createDefaultCalibration();
    calibrationRef.current = def;
    setCalibration(def);
  }, []);

  useEffect(() => {
    return () => {
      if (countdownTimerRef.current !== null) {
        window.clearInterval(countdownTimerRef.current);
      }
      if (mediaObjectUrlRef.current) {
        URL.revokeObjectURL(mediaObjectUrlRef.current);
      }
    };
  }, []);

  const loadVideoFile = useCallback((file: File) => {
    if (mediaObjectUrlRef.current) {
      URL.revokeObjectURL(mediaObjectUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    mediaObjectUrlRef.current = url;
    refImageElRef.current = null;
    setMediaFileName(file.name);
    setInputSource("video");
    setVideoPlaying(true);
    mediaVersionRef.current += 1;
    setMediaVersion(mediaVersionRef.current);
  }, []);

  const loadImageFile = useCallback((file: File) => {
    if (mediaObjectUrlRef.current) {
      URL.revokeObjectURL(mediaObjectUrlRef.current);
    }
    const url = URL.createObjectURL(file);
    mediaObjectUrlRef.current = url;
    const img = new Image();
    img.onload = () => {
      refImageElRef.current = img;
      const off = document.createElement("canvas");
      off.width = img.naturalWidth || 1280;
      off.height = img.naturalHeight || 720;
      const octx = off.getContext("2d");
      if (octx) {
        octx.drawImage(img, 0, 0, off.width, off.height);
      }
      refImageCanvasRef.current = off;
      setMediaFileName(file.name);
      setInputSource("image");
      mediaVersionRef.current += 1;
      setMediaVersion(mediaVersionRef.current);
    };
    img.src = url;
  }, []);

  const switchToCamera = useCallback(() => {
    refImageElRef.current = null;
    refImageCanvasRef.current = null;
    setMediaFileName(null);
    setInputSource("camera");
    mediaVersionRef.current += 1;
    setMediaVersion(mediaVersionRef.current);
  }, []);

  const toggleVideoPlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video || inputSourceRef.current !== "video") return;
    if (video.paused) {
      video.play().catch(() => {});
      setVideoPlaying(true);
    } else {
      video.pause();
      setVideoPlaying(false);
    }
  }, [videoRef]);

  const stopRef = useRef<() => void>(() => {});

  const start = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let cancelled = false;
    let raf = 0;
    let activeStream: MediaStream | null = null;

    stopRef.current = () => {
      cancelled = true;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (activeStream) {
        activeStream.getTracks().forEach((t) => t.stop());
        activeStream = null;
      }
      if (video.srcObject) {
        video.srcObject = null;
      }
      if (video.src) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      smootherRef.current.reset();
    };

    setStats((p) => ({ ...p, lastError: undefined }));

    const sourceMode = inputSourceRef.current;

    if (sourceMode === "camera") {
      video.removeAttribute("src");
      video.loop = false;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: 1280, height: 720 }
          : { width: 1280, height: 720 },
        audio: false,
      });

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      activeStream = stream;
      video.srcObject = stream;
      await video.play();
    } else if (sourceMode === "video" && mediaObjectUrlRef.current) {
      video.srcObject = null;
      video.src = mediaObjectUrlRef.current;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      setVideoPlaying(true);
    }

    if (cancelled) {
      stopRef.current();
      return;
    }

    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    if (cancelled) {
      stopRef.current();
      return;
    }

    let lastSend = 0;
    let lastVideoTime = -1;
    let lastImageRun = 0;
    let frameCount = 0;
    let msgCount = 0;
    let lastStats = performance.now();
    let oscInFlight = false;

    const loading = { hands: false, pose: false, face: false };
    const failed = { hands: false, pose: false, face: false };

    const createWithCpuFallback = async <T,>(
      build: (delegate: "GPU" | "CPU") => Promise<T>,
    ): Promise<T> => {
      try {
        return await build("GPU");
      } catch {
        return await build("CPU");
      }
    };

    const ensureModels = (s: TrackerSettings) => {
      if (
        s.trackHands &&
        !handLm.current &&
        !loading.hands &&
        !failed.hands
      ) {
        loading.hands = true;
        createWithCpuFallback((delegate) =>
          GestureRecognizer.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: GESTURE_MODEL, delegate },
            runningMode: "VIDEO",
            numHands: 2,
          }),
        )
          .then((lm) => {
            if (!cancelled) {
              handLm.current = lm;
              lastVideoTime = -1;
              lastImageRun = 0;
              lastStats = performance.now();
              frameCount = 0;
            }
          })
          .catch((e) => {
            failed.hands = true;
            if (!cancelled) {
              setStats((p) => ({ ...p, lastError: (e as Error).message }));
            }
          })
          .finally(() => {
            loading.hands = false;
          });
      }

      if (s.trackPose && !poseLm.current && !loading.pose && !failed.pose) {
        loading.pose = true;
        createWithCpuFallback((delegate) =>
          PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: POSE_MODEL, delegate },
            runningMode: "VIDEO",
            numPoses: 1,
          }),
        )
          .then((lm) => {
            if (!cancelled) {
              poseLm.current = lm;
              lastVideoTime = -1;
              lastImageRun = 0;
              lastStats = performance.now();
              frameCount = 0;
            }
          })
          .catch((e) => {
            failed.pose = true;
            if (!cancelled) {
              setStats((p) => ({ ...p, lastError: (e as Error).message }));
            }
          })
          .finally(() => {
            loading.pose = false;
          });
      }

      if (s.trackFace && !faceLm.current && !loading.face && !failed.face) {
        loading.face = true;
        createWithCpuFallback((delegate) =>
          FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: FACE_MODEL, delegate },
            runningMode: "VIDEO",
            numFaces: 1,
            outputFaceBlendshapes: true,
          }),
        )
          .then((lm) => {
            if (!cancelled) {
              faceLm.current = lm;
              lastVideoTime = -1;
              lastImageRun = 0;
              lastStats = performance.now();
              frameCount = 0;
            }
          })
          .catch((e) => {
            failed.face = true;
            if (!cancelled) {
              setStats((p) => ({ ...p, lastError: (e as Error).message }));
            }
          })
          .finally(() => {
            loading.face = false;
          });
      }
    };

    ensureModels(settingsRef.current);

    const loop = () => {
      if (cancelled) return;
      const now = performance.now();

      // Pause MediaPipe inference while heavy modals (PSD / Sheet Importer) are open
      if (pausedRef.current) {
        raf = requestAnimationFrame(loop);
        return;
      }

      const s = settingsRef.current;
      ensureModels(s);

      const srcMode = inputSourceRef.current;
      const isMirror = srcMode === "camera" ? s.mirror : false;

      let sourceEl: HTMLVideoElement | HTMLCanvasElement | null = null;
      let srcW = 1280;
      let srcH = 720;
      let shouldProcess = false;
      let smoothDtMs = 16.67;

      if (srcMode === "image") {
        const imgCanvas = refImageCanvasRef.current;
        if (imgCanvas && now - lastImageRun >= 66) {
          sourceEl = imgCanvas;
          srcW = imgCanvas.width;
          srcH = imgCanvas.height;
          shouldProcess = true;
          smoothDtMs = Math.max(16.67, now - lastImageRun);
          lastImageRun = now;
        }
      } else {
        const curVideo = videoRef.current;
        if (curVideo && curVideo.readyState >= 2 && curVideo.videoWidth > 0) {
          const timeChanged = curVideo.currentTime !== lastVideoTime;
          const cameraTick = srcMode === "camera" && now - lastImageRun >= 20;
          const pausedVideoTick =
            srcMode === "video" && curVideo.paused && now - lastImageRun > 120;
          if (timeChanged || cameraTick || pausedVideoTick) {
            sourceEl = curVideo;
            srcW = curVideo.videoWidth;
            srcH = curVideo.videoHeight;
            smoothDtMs =
              srcMode === "video" &&
              lastVideoTime >= 0 &&
              curVideo.currentTime > lastVideoTime
                ? (curVideo.currentTime - lastVideoTime) * 1000
                : Math.max(16.67, now - lastImageRun);
            lastVideoTime = curVideo.currentTime;
            lastImageRun = now;
            shouldProcess = true;
          }
        }
      }

      if (shouldProcess && sourceEl) {
        const mpTimestamp = Math.max(
          lastMpTimestampRef.current + 1,
          Math.floor(now),
        );
        lastMpTimestampRef.current = mpTimestamp;

        const smoothTimestamp =
          lastSmoothTimestampRef.current > 0
            ? lastSmoothTimestampRef.current + clamp(smoothDtMs, 1, 250)
            : now;
        lastSmoothTimestampRef.current = smoothTimestamp;

        let handRes: GestureRecognizerResult | null = null;
        let poseRes: PoseLandmarkerResult | null = null;
        let faceRes: FaceLandmarkerResult | null = null;
        try {
          if (s.trackHands && handLm.current) {
            handRes = handLm.current.recognizeForVideo(sourceEl, mpTimestamp);
          }
          if (s.trackPose && poseLm.current) {
            poseRes = poseLm.current.detectForVideo(sourceEl, mpTimestamp);
          }
          if (s.trackFace && faceLm.current) {
            faceRes = faceLm.current.detectForVideo(sourceEl, mpTimestamp);
          }
        } catch (e) {
          setStats((p) => ({ ...p, lastError: (e as Error).message }));
        }

        // Draw preview onto whichever canvas is currently mounted
        const activeCanvas = canvasRef.current;
        if (activeCanvas) {
          const ctx = activeCanvas.getContext("2d");
          if (ctx) {
            if (activeCanvas.width !== srcW) activeCanvas.width = srcW;
            if (activeCanvas.height !== srcH) activeCanvas.height = srcH;
            ctx.save();
            if (isMirror) {
              ctx.translate(srcW, 0);
              ctx.scale(-1, 1);
            }
            ctx.drawImage(sourceEl, 0, 0, srcW, srcH);

            // Only draw fresh live tracking skeletons (never stale ghosts!)
            const rawHands = handRes?.landmarks ?? [];
            const rawPoses = poseRes?.landmarks ?? [];
            const rawFaces = faceRes?.faceLandmarks ?? [];
            for (const lm of rawHands) drawHand(ctx, lm as Landmark[], srcW, srcH);
            for (const lm of rawPoses) drawPose(ctx, lm as Landmark[], srcW, srcH);
            for (const lm of rawFaces) {
              drawFace(ctx, lm as Landmark[], srcW, srcH, FACE_TIERS[s.faceTier]);
            }
            ctx.restore();
          }
        }

        const handsRaw = handRes?.landmarks ?? [];
        const gestureResults = handRes?.gestures ?? [];
        const posesRaw = poseRes?.landmarks ?? [];
        const facesRaw = faceRes?.faceLandmarks ?? [];
        const blendshapesRaw = faceRes?.faceBlendshapes ?? [];

        const sendInterval = 1000 / Math.max(1, s.fps);
        const shouldSend = now - lastSend >= sendInterval;
        if (shouldSend) lastSend = now;
        const messages: OscMessage[] = [];

        // ── 1. POSE (process first so hands can anchor to pose wrists!) ──
        let screenPose: Landmark[] | null = null;
        if (posesRaw.length > 0) {
          const lm = posesRaw[0] as Landmark[];
          const smoothed = smoothLandmarks(smootherRef.current, "P", lm, smoothTimestamp);
          screenPose = smoothed.map((p, idx) => ({
            x: isMirror ? 1 - p.x : p.x,
            y: p.y,
            z: p.z,
            visibility: lm[idx]?.visibility ?? 1,
          }));
          poseCacheRef.current = { landmarks: screenPose, lastSeenMs: now };
          latestPoseRef.current = screenPose;

          if (shouldSend) {
            const mapped = smoothed.map((p) => mapCoord(p, { ...s, mirror: isMirror }));
            const base = "/pose";
            if (s.poseSendLandmarks) pushPerLandmark(messages, base, mapped);
            if (s.poseSendBundled) pushBundled(messages, base, mapped);
            if (s.poseSendAxisGrouped) pushAxisGrouped(messages, base, mapped);
          }
        }
        if (shouldSend && s.trackPose) {
          messages.push({ address: "/pose/present", args: [posesRaw.length > 0 ? 1 : 0] });
        }

        let finalPose: Landmark[] | null = screenPose;
        let poseReturnBlend = 0;
        if (!finalPose && poseCacheRef.current.landmarks) {
          const elapsed = now - poseCacheRef.current.lastSeenMs;
          if (elapsed <= POSE_HOLD_MS) {
            finalPose = poseCacheRef.current.landmarks;
            poseReturnBlend = 0;
          } else if (elapsed <= POSE_HOLD_MS + POSE_GLIDE_MS) {
            finalPose = poseCacheRef.current.landmarks;
            poseReturnBlend = (elapsed - POSE_HOLD_MS) / POSE_GLIDE_MS;
          } else {
            poseCacheRef.current.landmarks = null;
            finalPose = null;
            poseReturnBlend = 1;
          }
        }

        // ── 2. HANDS (skeleton-anchored screen-space L/R + smooth timeout) ──
        const gestures: { L?: string; R?: string } = {};
        const present = { L: false, R: false };
        const freshHands: TrackedHand[] = [];

        // Screen-space pose anchors: screen-left shoulder/wrist -> "L", screen-right -> "R"
        let poseLeftWrist: Landmark | null = null;
        let poseRightWrist: Landmark | null = null;
        let poseLeftShoulder: Landmark | null = null;
        let poseRightShoulder: Landmark | null = null;
        let poseShoulderSpanIso = 0;
        const aspect = srcW / Math.max(1, srcH);
        let bodyMidX = calibrationRef.current.anchorX || 0.5;
        if (finalPose && finalPose.length >= 17) {
          const p11 = finalPose[11];
          const p12 = finalPose[12];
          if ((p11.visibility ?? 1) >= 0.45 && (p12.visibility ?? 1) >= 0.45) {
            bodyMidX = (p11.x + p12.x) * 0.5;
            poseLeftShoulder = p11.x <= p12.x ? p11 : p12;
            poseRightShoulder = p11.x <= p12.x ? p12 : p11;
            poseShoulderSpanIso = Math.hypot(
              (poseRightShoulder.x - poseLeftShoulder.x) * aspect,
              poseRightShoulder.y - poseLeftShoulder.y,
            );
          }
          const leftWristIdx = p11.x <= p12.x ? 15 : 16;
          const rightWristIdx = leftWristIdx === 15 ? 16 : 15;
          const lw = finalPose[leftWristIdx];
          const rw = finalPose[rightWristIdx];
          if ((lw.visibility ?? 1) >= 0.5 && lw.y >= 0.01 && lw.y <= 0.98) {
            poseLeftWrist = lw;
          }
          if ((rw.visibility ?? 1) >= 0.5 && rw.y >= 0.01 && rw.y <= 0.98) {
            poseRightWrist = rw;
          }
        }

        // Candidate Hand Gating (matches HolisticTracker.swift & AGENTS.md):
        // Reject tiny background noise blobs & impossible floating hands far from shoulders!
        const gatedIndices: number[] = [];
        for (let hi = 0; hi < handsRaw.length; hi++) {
          const hLm = handsRaw[hi] as Landmark[];
          if (!hLm || hLm.length < 21) continue;
          const wx = isMirror ? 1 - hLm[0].x : hLm[0].x;
          const wy = hLm[0].y;
          if (wx < 0.004 || wx > 0.996 || wy < 0.004 || wy > 0.996) continue;
          const mx = isMirror ? 1 - hLm[9].x : hLm[9].x;
          const my = hLm[9].y;
          const palmIso = Math.hypot((mx - wx) * aspect, my - wy);
          if (palmIso < 0.028) continue;

          if (poseLeftShoulder && poseRightShoulder) {
            const dLS = Math.hypot(
              (wx - poseLeftShoulder.x) * aspect,
              wy - poseLeftShoulder.y,
            );
            const dRS = Math.hypot(
              (wx - poseRightShoulder.x) * aspect,
              wy - poseRightShoulder.y,
            );
            const maxReachIso = Math.max(0.76, poseShoulderSpanIso * 2.65);
            if (Math.min(dLS, dRS) > maxReachIso) continue;
          }
          gatedIndices.push(hi);
        }

        // Pure geometric screen-space L/R hand assignment (never relies on flipped MediaPipe
        // GestureRecognizer categoryName, so left screen side ALWAYS drives left puppet arm
        // and right screen side ALWAYS drives right puppet arm — impossible to cross!)
        const assignedLabels: ("L" | "R")[] = new Array(gatedIndices.length).fill("L");

        if (gatedIndices.length === 1) {
          const lm = handsRaw[gatedIndices[0]] as Landmark[];
          const wx = isMirror ? 1 - lm[0].x : lm[0].x;
          const wy = lm[0].y;
          const dL = poseLeftWrist ? dist2D(wx, wy, poseLeftWrist.x, poseLeftWrist.y) : Infinity;
          const dR = poseRightWrist ? dist2D(wx, wy, poseRightWrist.x, poseRightWrist.y) : Infinity;

          if (Math.min(dL, dR) < 0.24 && Math.abs(dL - dR) > 0.04) {
            assignedLabels[0] = dL <= dR ? "L" : "R";
          } else {
            assignedLabels[0] = wx <= bodyMidX ? "L" : "R";
          }
        } else if (gatedIndices.length >= 2) {
          const w0 = handsRaw[gatedIndices[0]][0];
          const w1 = handsRaw[gatedIndices[1]][0];
          const w0x = isMirror ? 1 - w0.x : w0.x;
          const w1x = isMirror ? 1 - w1.x : w1.x;

          let matchedByPose = false;
          if (poseLeftWrist && poseRightWrist) {
            const cost0L1R =
              dist2D(w0x, w0.y, poseLeftWrist.x, poseLeftWrist.y) +
              dist2D(w1x, w1.y, poseRightWrist.x, poseRightWrist.y);
            const cost0R1L =
              dist2D(w0x, w0.y, poseRightWrist.x, poseRightWrist.y) +
              dist2D(w1x, w1.y, poseLeftWrist.x, poseLeftWrist.y);
            if (Math.min(cost0L1R, cost0R1L) < 0.48) {
              if (cost0L1R <= cost0R1L) {
                assignedLabels[0] = "L";
                assignedLabels[1] = "R";
              } else {
                assignedLabels[0] = "R";
                assignedLabels[1] = "L";
              }
              matchedByPose = true;
            }
          }

          if (!matchedByPose) {
            if (w0x <= w1x) {
              assignedLabels[0] = "L";
              assignedLabels[1] = "R";
            } else {
              assignedLabels[0] = "R";
              assignedLabels[1] = "L";
            }
          }
        }

        for (let gi = 0; gi < gatedIndices.length; gi++) {
          const i = gatedIndices[gi];
          const lm = handsRaw[i] as Landmark[];
          let finalLabel: "L" | "R" = assignedLabels[gi] ?? "L";
          if (present[finalLabel]) {
            finalLabel = finalLabel === "L" ? "R" : "L";
          }
          present[finalLabel] = true;

          const smoothed = smoothLandmarks(
            smootherRef.current,
            `H_${finalLabel}`,
            lm,
            smoothTimestamp,
          );
          const screenLm = smoothed.map((p) => ({
            x: isMirror ? 1 - p.x : p.x,
            y: p.y,
            z: p.z,
          }));

          const gCat = gestureResults[i]?.[0];
          const g = gCat?.categoryName || "None";
          const gScore = gCat?.score ?? 0;
          const pinch = pinchAmount(smoothed);
          gestures[finalLabel] =
            g === "None" ? "None" : `${g} ${gScore.toFixed(2)}`;

          const wrist = screenLm[0];
          const midMcp = screenLm[9];
          const idxMcp = screenLm[5];
          const pkyMcp = screenLm[17];
          // Match HolisticTracker.swift line 1040: 0 rad = fingers pointing straight UP (-Y)
          const wristAngle = Math.atan2(
            (midMcp.x - wrist.x) * aspect,
            -(midMcp.y - wrist.y),
          );
          const palmLenIso = Math.max(
            0.02,
            Math.hypot((midMcp.x - wrist.x) * aspect, midMcp.y - wrist.y),
          );
          const handDepthScale = clamp(palmLenIso / 0.115, 0.88, 1.18);

          // Compute 5 finger curls 0..1 (0 = extended, 1 = curled into palm)
          const fingerTips = [4, 8, 12, 16, 20];
          const fingerMcps = [2, 5, 9, 13, 17];
          const fingerCurls = fingerTips.map((tipIdx, fIdx) => {
            const tip = screenLm[tipIdx];
            const mcp = screenLm[fingerMcps[fIdx]];
            const tipDist = Math.hypot((tip.x - wrist.x) * aspect, tip.y - wrist.y);
            const mcpDist = Math.max(
              0.015,
              Math.hypot((mcp.x - wrist.x) * aspect, mcp.y - wrist.y),
            );
            const ratio = tipDist / mcpDist;
            return clamp((1.85 - ratio) / 0.95, 0, 1);
          });

          // 2D cross product of (wrist->indexMCP) x (wrist->pinkyMCP) in screen Y-down coords:
          // Screen-left hand ("L") with palm facing camera has index toward center (+x) & pinky outer (-x) => cross < 0
          // Screen-right hand ("R") with palm facing camera has index toward center (-x) & pinky outer (+x) => cross > 0
          const v1x = idxMcp.x - wrist.x;
          const v1y = idxMcp.y - wrist.y;
          const v2x = pkyMcp.x - wrist.x;
          const v2y = pkyMcp.y - wrist.y;
          const cross = v1x * v2y - v1y * v2x;
          const palmFacingSign =
            finalLabel === "L" ? (cross <= 0 ? 1 : -1) : cross >= 0 ? 1 : -1;

          const trackedHand: TrackedHand = {
            label: finalLabel,
            landmarks: screenLm,
            wristAngle,
            palmFacingSign,
            scale: handDepthScale,
            fingerCurls,
            gesture: g,
            gestureScore: gScore,
            pinch,
            isGhost: false,
            returnToRestBlend: 0,
          };
          freshHands.push(trackedHand);
          handCacheRef.current[finalLabel] = {
            hand: trackedHand,
            lastSeenMs: now,
          };

          if (shouldSend) {
            const mapped = smoothed.map((p) => mapCoord(p, { ...s, mirror: isMirror }));
            const base = `/hand/${finalLabel}`;
            if (s.handsSendLandmarks) pushPerLandmark(messages, base, mapped);
            if (s.handsSendBundled) pushBundled(messages, base, mapped);
            if (s.handsSendAxisGrouped) pushAxisGrouped(messages, base, mapped);
            if (s.handsSendGesture) {
              messages.push({ address: `${base}/gesture`, args: [g] });
              messages.push({ address: `${base}/gesture_score`, args: [gScore] });
              messages.push({ address: `${base}/pinch`, args: [pinch] });
            }
          }
        }

        // Fill in smoothly gliding hands for recently-lost slots
        const finalHands: TrackedHand[] = [...freshHands];
        for (const side of ["L", "R"] as const) {
          if (present[side]) continue;
          const cached = handCacheRef.current[side];
          if (!cached) continue;
          const elapsed = now - cached.lastSeenMs;
          if (elapsed <= HAND_HOLD_MS) {
            finalHands.push({ ...cached.hand, isGhost: true, returnToRestBlend: 0 });
          } else if (elapsed <= HAND_HOLD_MS + HAND_GLIDE_MS) {
            const t = (elapsed - HAND_HOLD_MS) / HAND_GLIDE_MS;
            finalHands.push({ ...cached.hand, isGhost: true, returnToRestBlend: t });
          } else {
            delete handCacheRef.current[side];
          }
        }

        if (shouldSend && s.trackHands) {
          messages.push({ address: "/hand/L/present", args: [present.L ? 1 : 0] });
          messages.push({ address: "/hand/R/present", args: [present.R ? 1 : 0] });
        }

        // ── 3. FACE (478 landmarks + 52 ARKit blendshapes) ──
        let faceMetrics: TrackedFaceMetrics = faceCacheRef.current.metrics;

        if (facesRaw.length > 0 && s.faceTier !== "off") {
          const lm = facesRaw[0] as Landmark[];
          const cats = blendshapesRaw[0]?.categories ?? [];
          const bs: Record<string, number> = {};
          for (const c of cats) {
            if (c.categoryName) bs[c.categoryName] = c.score ?? 0;
          }

          const computed = computeFaceMetrics(
            lm,
            bs,
            isMirror,
            calibrationRef.current,
            faceCacheRef.current.lockedHeadScale,
            srcW / Math.max(1, srcH),
          );
          latestRawFaceRef.current = {
            anchorX: computed.rawAnchorX,
            anchorY: computed.rawAnchorY,
            iod: computed.rawIOD,
            verticalSkull: computed.rawVerticalSkull,
            roll: computed.roll + calibrationRef.current.rollOffset,
            yaw: computed.yaw + calibrationRef.current.yawOffset,
            pitch: computed.pitch + calibrationRef.current.pitchOffset,
          };

          // Auto-calibrate on very first clean face frame if not calibrated yet
          if (!calibrationRef.current.calibrated) {
            const autoCal: CalibrationBaseline = {
              ...calibrationRef.current,
              calibrated: true,
              anchorX: computed.rawAnchorX,
              anchorY: computed.rawAnchorY,
              iod: Math.max(0.03, computed.rawIOD),
              verticalSkull: Math.max(0.04, computed.rawVerticalSkull),
            };
            calibrationRef.current = autoCal;
            setCalibration(autoCal);
          }

          faceMetrics = computed;
          faceCacheRef.current = {
            metrics: computed,
            lastSeenMs: now,
            lockedHeadScale: computed.headScale,
          };

          // OSC face output
          const indices = FACE_TIERS[s.faceTier];
          const subset: Landmark[] = indices.map((i) => lm[i] ?? { x: 0, y: 0, z: 0 });
          const smoothed = smoothLandmarks(smootherRef.current, "F", subset, smoothTimestamp);
          const mapped = smoothed.map((p) => mapCoord(p, { ...s, mirror: isMirror }));
          if (shouldSend) {
            const base = "/face";
            if (s.faceSendLandmarks) pushPerLandmark(messages, base, mapped);
            if (s.faceSendBundled) pushBundled(messages, base, mapped);
            if (s.faceSendAxisGrouped) pushAxisGrouped(messages, base, mapped);

            if (s.faceSendBlendshapes && cats.length > 0) {
              const scores: number[] = [];
              for (const c of cats) {
                const score = c.score ?? 0;
                scores.push(score);
                if (c.categoryName) {
                  messages.push({
                    address: `/face/blendshape/${c.categoryName}`,
                    args: [score],
                  });
                }
              }
              messages.push({ address: "/face/blendshapes", args: scores });
            }
          }
        } else {
          // Smooth hold -> glide to neutral -> reset when face is lost
          const elapsed = now - faceCacheRef.current.lastSeenMs;
          if (faceCacheRef.current.metrics.present) {
            if (elapsed <= FACE_HOLD_MS) {
              faceMetrics = faceCacheRef.current.metrics;
            } else if (elapsed <= FACE_HOLD_MS + FACE_GLIDE_MS) {
              const t = (elapsed - FACE_HOLD_MS) / FACE_GLIDE_MS;
              const prev = faceCacheRef.current.metrics;
              faceMetrics = {
                ...prev,
                present: true,
                headX: lerp(prev.headX, 0, t),
                headY: lerp(prev.headY, 0, t),
                headScale: lerp(prev.headScale, 1, t),
                roll: lerp(prev.roll, 0, t),
                yaw: lerp(prev.yaw, 0, t),
                pitch: lerp(prev.pitch, 0, t),
                mouthOpen: lerp(prev.mouthOpen, 0, t),
                mouthSmile: lerp(prev.mouthSmile, 0, t),
                mouthPucker: lerp(prev.mouthPucker, 0, t),
                browRaise: lerp(prev.browRaise, 0, t),
                browFurrow: lerp(prev.browFurrow, 0, t),
                eyeBlinkL: lerp(prev.eyeBlinkL, 0, t),
                eyeBlinkR: lerp(prev.eyeBlinkR, 0, t),
                viseme: t > 0.45 ? "neutral" : prev.viseme,
              };
            } else {
              const empty = createEmptyFaceMetrics();
              faceCacheRef.current.metrics = empty;
              faceMetrics = empty;
            }
          }
        }

        if (shouldSend && s.trackFace) {
          messages.push({ address: "/face/present", args: [facesRaw.length > 0 ? 1 : 0] });
        }

        // Per-joint freshness & visibility gate for pose
        const poseJointFresh = finalPose
          ? finalPose.map(
              (p) =>
                Boolean(screenPose) &&
                (p.visibility ?? 1) >= 0.58 &&
                p.x >= 0.01 &&
                p.x <= 0.99 &&
                p.y >= 0.01 &&
                p.y <= 0.96,
            )
          : new Array(33).fill(false);

        // Publish live 60 FPS frame ref for PuppetStageCanvas
        frameRef.current = {
          timestamp: now,
          frameAspect: srcW / Math.max(1, srcH),
          isMirrored: isMirror,
          hands: finalHands,
          poseLandmarks: finalPose,
          poseJointFresh,
          posePresent: Boolean(finalPose),
          poseReturnBlend,
          face: faceMetrics,
          hasAnyTracking:
            finalHands.length > 0 || Boolean(finalPose) || faceMetrics.present,
        };

        if (shouldSend && messages.length && !oscInFlight) {
          msgCount += messages.length;
          oscInFlight = true;
          sendOsc(s.host, s.port, messages)
            .catch((e) => {
              if (!cancelled) {
                setStats((p) => ({ ...p, lastError: (e as Error).message }));
              }
            })
            .finally(() => {
              oscInFlight = false;
            });
        }

        frameCount++;
        if (now - lastStats > 250) {
          const elapsed = (now - lastStats) / 1000;
          setStats((p) => ({
            fps: Math.round(frameCount / elapsed),
            msgsPerSec: Math.round(msgCount / elapsed),
            hands: gatedIndices.length,
            poses: posesRaw.length,
            faces: facesRaw.length,
            gestures,
            viseme: faceMetrics.viseme,
            faceSummary: {
              mouthOpen: faceMetrics.mouthOpen,
              mouthSmile: faceMetrics.mouthSmile,
              mouthPucker: faceMetrics.mouthPucker,
              browRaise: faceMetrics.browRaise,
              eyeBlinkL: faceMetrics.eyeBlinkL,
              eyeBlinkR: faceMetrics.eyeBlinkR,
            },
            lastError: p.lastError,
          }));
          frameCount = 0;
          msgCount = 0;
          lastStats = now;
        }
      }

      if (!cancelled) {
        raf = requestAnimationFrame(loop);
      }
    };
    raf = requestAnimationFrame(loop);
  }, [deviceId, videoRef, canvasRef]);

  useEffect(() => {
    if (!running) {
      // Clear tracking & caches gracefully when stopped so nothing jitters
      handCacheRef.current = {};
      poseCacheRef.current = { landmarks: null, lastSeenMs: 0 };
      faceCacheRef.current = {
        metrics: createEmptyFaceMetrics(),
        lastSeenMs: 0,
        lockedHeadScale: 1,
      };
      frameRef.current = createEmptyTrackedFrame();
      setStats((p) => ({
        ...p,
        fps: 0,
        msgsPerSec: 0,
        hands: 0,
        poses: 0,
        faces: 0,
        gestures: {},
        viseme: "neutral",
        faceSummary: {
          mouthOpen: 0,
          mouthSmile: 0,
          mouthPucker: 0,
          browRaise: 0,
          eyeBlinkL: 0,
          eyeBlinkR: 0,
        },
      }));
      return;
    }
    start().catch((e) =>
      setStats((p) => ({ ...p, lastError: (e as Error).message })),
    );
    return () => {
      stopRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, deviceId, inputSource, mediaVersion]);

  return {
    stats,
    frameRef,
    calibration,
    countdownSeconds,
    inputSource,
    mediaFileName,
    videoPlaying,
    calibrateNow,
    startCountdownCalibration,
    resetCalibration,
    loadVideoFile,
    loadImageFile,
    switchToCamera,
    toggleVideoPlayPause,
  };
}

// ── Face metrics extraction (478 landmarks + 52 ARKit blendshapes) ────────

function computeFaceMetrics(
  lm: Landmark[],
  bs: Record<string, number>,
  isMirror: boolean,
  cal: CalibrationBaseline,
  prevHeadScale: number,
  aspect: number,
): TrackedFaceMetrics {
  const pt = (idx: number) => {
    const p = lm[idx] ?? { x: 0.5, y: 0.5, z: 0 };
    return { x: isMirror ? 1 - p.x : p.x, y: p.y, z: p.z };
  };

  // Eye centers (MediaPipe FaceMesh outer/inner corners)
  const leftOuter = pt(33);
  const leftInner = pt(133);
  const rightInner = pt(362);
  const rightOuter = pt(263);

  const eyeA = {
    x: (leftOuter.x + leftInner.x) * 0.5,
    y: (leftOuter.y + leftInner.y) * 0.5,
  };
  const eyeB = {
    x: (rightOuter.x + rightInner.x) * 0.5,
    y: (rightOuter.y + rightInner.y) * 0.5,
  };
  const screenLeftEye = eyeA.x <= eyeB.x ? eyeA : eyeB;
  const screenRightEye = eyeA.x <= eyeB.x ? eyeB : eyeA;

  const eyeMidX = (screenLeftEye.x + screenRightEye.x) * 0.5;
  const eyeMidY = (screenLeftEye.y + screenRightEye.y) * 0.5;
  const iod = Math.max(
    0.025,
    Math.hypot((screenRightEye.x - screenLeftEye.x) * aspect, screenRightEye.y - screenLeftEye.y),
  );

  // Forehead glabella (10) & upper-lip / nose base (2) for yaw-invariant vertical skull metric
  const forehead = pt(10);
  const noseTip = pt(1);
  const noseBase = pt(2);
  const chin = pt(152);
  const verticalSkull = Math.max(0.03, Math.hypot((noseBase.x - forehead.x) * aspect, noseBase.y - forehead.y));

  // Roll (head tilt)
  const rawRoll = Math.atan2(
    screenRightEye.y - screenLeftEye.y,
    (screenRightEye.x - screenLeftEye.x) * aspect,
  );
  const roll = clamp(rawRoll - cal.rollOffset, -0.75, 0.75);

  // Yaw: nose tip offset relative to eye midpoint normalized by IOD
  const noseDx = (noseTip.x - eyeMidX) * aspect;
  const rawYaw = clamp((noseDx / Math.max(0.03, iod)) * 2.1, -1.0, 1.0);
  const yaw = clamp(rawYaw - cal.yawOffset, -1.0, 1.0);

  // Pitch: vertical nose position between eye midpoint and chin
  const faceHeight = Math.max(0.04, chin.y - eyeMidY);
  const rawPitch = clamp(((noseTip.y - eyeMidY) / faceHeight - 0.36) * 2.6, -1.0, 1.0);
  const pitch = clamp(rawPitch - cal.pitchOffset, -1.0, 1.0);

  // Yaw-invariant depth scale with turn-lock when turning head > 0.22
  const calVSkull = Math.max(0.04, cal.verticalSkull);
  const rawScale = clamp(verticalSkull / calVSkull, 0.58, 1.55);
  const headScale = Math.abs(yaw) > 0.25 ? lerp(prevHeadScale, rawScale, 0.08) : lerp(prevHeadScale, rawScale, 0.35);

  // Orbit-compensated anchor (eye midpoint shifts slightly on yaw; cancel small orbit)
  const anchorX = eyeMidX - yaw * iod * 0.08;
  const anchorY = eyeMidY;
  const headX = clamp(anchorX - cal.anchorX, -0.45, 0.45);
  const headY = clamp(anchorY - cal.anchorY, -0.45, 0.45);

  // ARKit blendshapes (with landmark fallbacks)
  const jawOpen = bs.jawOpen ?? 0;
  const mouthOpen = clamp(jawOpen * 1.45, 0, 1);

  const smileL = bs.mouthSmileLeft ?? 0;
  const smileR = bs.mouthSmileRight ?? 0;
  const mouthSmile = clamp(((smileL + smileR) * 0.5) * 1.25, 0, 1);

  const pucker = bs.mouthPucker ?? 0;
  const funnel = bs.mouthFunnel ?? 0;
  const mouthPucker = clamp(Math.max(pucker, funnel * 0.9) * 1.2, 0, 1);

  const browInner = bs.browInnerUp ?? 0;
  const browOuterL = bs.browOuterUpLeft ?? 0;
  const browOuterR = bs.browOuterUpRight ?? 0;
  const browRaise = clamp((browInner * 0.5 + (browOuterL + browOuterR) * 0.35) * 1.35, 0, 1);

  const browDownL = bs.browDownLeft ?? 0;
  const browDownR = bs.browDownRight ?? 0;
  const browFurrow = clamp(((browDownL + browDownR) * 0.5) * 1.2, 0, 1);

  // Independent Wink / Blink mapping (mirror-aware!)
  // MediaPipe ARKit eyeBlinkLeft is the subject's anatomical LEFT eye.
  // In Mirror mode (isMirror=true), your left eye appears on the LEFT side of the screen
  // and must drive the puppet's screen-left eye (eyeBlinkL).
  // In Non-Mirrored mode (isMirror=false), the subject's right eye appears on screen-left.
  const rawBlinkAnatL = bs.eyeBlinkLeft ?? 0;
  const rawBlinkAnatR = bs.eyeBlinkRight ?? 0;
  let eyeBlinkL = isMirror ? rawBlinkAnatL : rawBlinkAnatR;
  let eyeBlinkR = isMirror ? rawBlinkAnatR : rawBlinkAnatL;

  // Suppress sympathetic blink on clear single-eye winks
  const asym = Math.abs(eyeBlinkL - eyeBlinkR);
  if (asym > 0.24) {
    if (eyeBlinkL > eyeBlinkR && eyeBlinkR < 0.48) {
      eyeBlinkR = 0;
    } else if (eyeBlinkR > eyeBlinkL && eyeBlinkL < 0.48) {
      eyeBlinkL = 0;
    }
  }

  // Classify speech viseme
  let viseme: SpeechViseme = "neutral";
  if (mouthOpen > 0.62) {
    viseme = "wide";
  } else if (mouthPucker > 0.34 && mouthOpen > 0.14) {
    viseme = "oh";
  } else if (mouthOpen > 0.22) {
    viseme = "ah";
  } else if (mouthPucker > 0.42) {
    viseme = "oh";
  } else if (mouthSmile > 0.34) {
    viseme = "smile";
  }

  return {
    present: true,
    rawAnchorX: anchorX,
    rawAnchorY: anchorY,
    rawIOD: iod,
    rawVerticalSkull: verticalSkull,
    headX,
    headY,
    headScale,
    roll,
    yaw,
    pitch,
    mouthOpen,
    mouthSmile,
    mouthPucker,
    browRaise,
    browFurrow,
    eyeBlinkL: clamp(eyeBlinkL, 0, 1),
    eyeBlinkR: clamp(eyeBlinkR, 0, 1),
    viseme,
  };
}

// ── helpers ────────────────────────────────────────────────────────────

function smoothLandmarks(
  smoother: LandmarkSmoother,
  prefix: string,
  lm: Landmark[],
  t: number,
): Landmark[] {
  return lm.map((p, idx) => ({
    x: smoother.filter(`${prefix}_${idx}_x`, p.x, t),
    y: smoother.filter(`${prefix}_${idx}_y`, p.y, t),
    z: smoother.filter(`${prefix}_${idx}_z`, p.z, t),
  }));
}

function pushPerLandmark(out: OscMessage[], base: string, mapped: Landmark[]) {
  for (let k = 0; k < mapped.length; k++) {
    out.push({
      address: `${base}/landmark/${k}`,
      args: [mapped[k].x, mapped[k].y, mapped[k].z],
    });
  }
}

function pushBundled(out: OscMessage[], base: string, mapped: Landmark[]) {
  const flat: number[] = [];
  for (const p of mapped) flat.push(p.x, p.y, p.z);
  out.push({ address: base, args: flat });
}

function pushAxisGrouped(out: OscMessage[], base: string, mapped: Landmark[]) {
  const xs: number[] = new Array(mapped.length);
  const ys: number[] = new Array(mapped.length);
  const zs: number[] = new Array(mapped.length);
  for (let k = 0; k < mapped.length; k++) {
    xs[k] = mapped[k].x;
    ys[k] = mapped[k].y;
    zs[k] = mapped[k].z;
  }
  out.push({ address: `${base}/x`, args: xs });
  out.push({ address: `${base}/y`, args: ys });
  out.push({ address: `${base}/z`, args: zs });
}

function mapCoord(p: Landmark, s: TrackerSettings) {
  if (s.mapping === "normalized") {
    return {
      x: s.mirror ? 1 - p.x : p.x,
      y: 1 - p.y,
      z: p.z,
    };
  }
  const x = (s.mirror ? 1 - p.x : p.x) * 2 - 1;
  const aspect = s.screenWidth / Math.max(1, s.screenHeight);
  const y = -(p.y * 2 - 1);
  return { x, y, z: p.z * aspect };
}

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
];

function drawHand(ctx: CanvasRenderingContext2D, lm: Landmark[], w: number, h: number) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(120, 255, 180, 0.9)";
  ctx.fillStyle = "rgba(255, 180, 80, 0.95)";
  for (const [a, b] of HAND_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawPose(ctx: CanvasRenderingContext2D, lm: Landmark[], w: number, h: number) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(140, 180, 255, 0.85)";
  ctx.fillStyle = "rgba(255, 120, 200, 0.9)";
  for (const [a, b] of POSE_CONNECTIONS) {
    if (!lm[a] || !lm[b]) continue;
    ctx.beginPath();
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
    ctx.stroke();
  }
  for (const p of lm) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  lm: Landmark[],
  w: number,
  h: number,
  indices: number[],
) {
  ctx.fillStyle = "rgba(180, 220, 255, 0.85)";
  for (const i of indices) {
    const p = lm[i];
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
