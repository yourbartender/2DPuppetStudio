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
  lastError?: string;
};

const GESTURE_MODEL = "./mediapipe/gesture_recognizer.task";
const POSE_MODEL = "./mediapipe/pose_landmarker_full.task";
const FACE_MODEL = "./mediapipe/face_landmarker.task";
const WASM_URL = "./mediapipe/wasm";

export function useHolisticTracker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  deviceId: string | null,
  settings: TrackerSettings,
  running: boolean,
) {
  const [stats, setStats] = useState<TrackerStats>({
    fps: 0,
    msgsPerSec: 0,
    hands: 0,
    poses: 0,
    faces: 0,
    gestures: {},
  });
  const handLm = useRef<GestureRecognizer | null>(null);
  const poseLm = useRef<PoseLandmarker | null>(null);
  const faceLm = useRef<FaceLandmarker | null>(null);
  const lastMpTimestampRef = useRef<number>(0);
  const lastSmoothTimestampRef = useRef<number>(0);

  const smootherRef = useRef(
    new LandmarkSmoother(settings.smoothMinCutoff, settings.smoothBeta),
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    smootherRef.current.setParams(settings.smoothMinCutoff, settings.smoothBeta);
  }, [settings.smoothMinCutoff, settings.smoothBeta]);

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
      smootherRef.current.reset();
    };

    setStats((p) => ({ ...p, lastError: undefined }));

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
    if (cancelled) {
      stopRef.current();
      return;
    }

    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    if (cancelled) {
      stopRef.current();
      return;
    }

    const loading = { hands: false, pose: false, face: false };
    const failed = { hands: false, pose: false, face: false };

    const ensureModels = (s: TrackerSettings) => {
      if (
        s.trackHands &&
        !handLm.current &&
        !loading.hands &&
        !failed.hands
      ) {
        loading.hands = true;
        GestureRecognizer.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: GESTURE_MODEL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
        })
          .then((lm) => {
            if (!cancelled) handLm.current = lm;
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
        PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: POSE_MODEL, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 1,
        })
          .then((lm) => {
            if (!cancelled) poseLm.current = lm;
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
        FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
        })
          .then((lm) => {
            if (!cancelled) faceLm.current = lm;
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

    const ctx = canvas.getContext("2d")!;
    let lastSend = 0;
    let lastVideoTime = -1;
    let frameCount = 0;
    let msgCount = 0;
    let lastStats = performance.now();
    let oscInFlight = false;

    const loop = () => {
      if (cancelled) return;
      const s = settingsRef.current;
      const now = performance.now();

      // Trigger background lazy-init when a tracker is toggled on at runtime
      ensureModels(s);

      if (
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        video.currentTime !== lastVideoTime
      ) {
        const videoTimeDeltaMs =
          lastVideoTime >= 0 && video.currentTime > lastVideoTime
            ? (video.currentTime - lastVideoTime) * 1000
            : 16.67;
        lastVideoTime = video.currentTime;

        // Strictly monotonic timestamp in ms for MediaPipe VIDEO mode
        const mpTimestamp = Math.max(
          lastMpTimestampRef.current + 1,
          Math.floor(now),
        );
        lastMpTimestampRef.current = mpTimestamp;

        // Hardware camera frame clock for 1€ filter (avoids RAF vs camera clock jitter)
        const smoothTimestamp =
          lastSmoothTimestampRef.current > 0
            ? lastSmoothTimestampRef.current + Math.min(Math.max(videoTimeDeltaMs, 1), 250)
            : now;
        lastSmoothTimestampRef.current = smoothTimestamp;

        let handRes: GestureRecognizerResult | null = null;
        let poseRes: PoseLandmarkerResult | null = null;
        let faceRes: FaceLandmarkerResult | null = null;
        try {
          if (s.trackHands && handLm.current) {
            handRes = handLm.current.recognizeForVideo(video, mpTimestamp);
          }
          if (s.trackPose && poseLm.current) {
            poseRes = poseLm.current.detectForVideo(video, mpTimestamp);
          }
          if (s.trackFace && faceLm.current) {
            faceRes = faceLm.current.detectForVideo(video, mpTimestamp);
          }
        } catch (e) {
          setStats((p) => ({ ...p, lastError: (e as Error).message }));
        }

        // draw preview
        const w = (canvas.width = video.videoWidth || 1280);
        const h = (canvas.height = video.videoHeight || 720);
        ctx.save();
        if (s.mirror) {
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, w, h);
        ctx.restore();

        if (s.mirror) {
          ctx.save();
          ctx.translate(w, 0);
          ctx.scale(-1, 1);
        }

        const hands = handRes?.landmarks ?? [];
        const handed = handRes?.handednesses ?? [];
        const gestureResults = handRes?.gestures ?? [];
        const poses = poseRes?.landmarks ?? [];
        const faces = faceRes?.faceLandmarks ?? [];
        const blendshapes = faceRes?.faceBlendshapes ?? [];

        for (const lm of hands) drawHand(ctx, lm as Landmark[], w, h);
        for (const lm of poses) drawPose(ctx, lm as Landmark[], w, h);
        for (const lm of faces) {
          drawFace(ctx, lm as Landmark[], w, h, FACE_TIERS[s.faceTier]);
        }

        if (s.mirror) ctx.restore();

        const gestures: { L?: string; R?: string } = {};
        const present = { L: false, R: false };

        const sendInterval = 1000 / Math.max(1, s.fps);
        const shouldSend = now - lastSend >= sendInterval;
        if (shouldSend) lastSend = now;

        const messages: OscMessage[] = [];

        // ── HANDS ──────────────────────────────────────────────────────
        for (let i = 0; i < hands.length; i++) {
          const lm = hands[i] as Landmark[];
          const label = handed[i]?.[0]?.categoryName === "Left" ? "L" : "R";
          const finalLabel = s.mirror ? (label === "L" ? "R" : "L") : label;
          present[finalLabel as "L" | "R"] = true;

          const smoothed = smoothLandmarks(
            smootherRef.current,
            `H_${finalLabel}`,
            lm,
            smoothTimestamp,
          );
          const mapped = smoothed.map((p) => mapCoord(p, s));
          const gCat = gestureResults[i]?.[0];
          const g = gCat?.categoryName || "None";
          const gScore = gCat?.score ?? 0;
          const pinch = pinchAmount(smoothed);
          gestures[finalLabel as "L" | "R"] =
            g === "None" ? "None" : `${g} ${gScore.toFixed(2)}`;

          if (shouldSend) {
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
        if (shouldSend && s.trackHands) {
          messages.push({ address: `/hand/L/present`, args: [present.L ? 1 : 0] });
          messages.push({ address: `/hand/R/present`, args: [present.R ? 1 : 0] });
        }

        // ── POSE ───────────────────────────────────────────────────────
        if (poses.length > 0) {
          const lm = poses[0] as Landmark[];
          const smoothed = smoothLandmarks(
            smootherRef.current,
            "P",
            lm,
            smoothTimestamp,
          );
          const mapped = smoothed.map((p) => mapCoord(p, s));
          if (shouldSend) {
            const base = `/pose`;
            if (s.poseSendLandmarks) pushPerLandmark(messages, base, mapped);
            if (s.poseSendBundled) pushBundled(messages, base, mapped);
            if (s.poseSendAxisGrouped) pushAxisGrouped(messages, base, mapped);
          }
        }
        if (shouldSend && s.trackPose) {
          messages.push({ address: `/pose/present`, args: [poses.length > 0 ? 1 : 0] });
        }

        // ── FACE ───────────────────────────────────────────────────────
        if (faces.length > 0 && s.faceTier !== "off") {
          const lm = faces[0] as Landmark[];
          const indices = FACE_TIERS[s.faceTier];
          const subset: Landmark[] = indices.map((i) => lm[i] ?? { x: 0, y: 0, z: 0 });
          const smoothed = smoothLandmarks(
            smootherRef.current,
            "F",
            subset,
            smoothTimestamp,
          );
          const mapped = smoothed.map((p) => mapCoord(p, s));
          if (shouldSend) {
            const base = `/face`;
            if (s.faceSendLandmarks) pushPerLandmark(messages, base, mapped);
            if (s.faceSendBundled) pushBundled(messages, base, mapped);
            if (s.faceSendAxisGrouped) pushAxisGrouped(messages, base, mapped);

            if (s.faceSendBlendshapes && blendshapes[0]?.categories) {
              const cats = blendshapes[0].categories;
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
              messages.push({ address: `/face/blendshapes`, args: scores });
            }
          }
        }
        if (shouldSend && s.trackFace) {
          messages.push({ address: `/face/present`, args: [faces.length > 0 ? 1 : 0] });
        }

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
        if (now - lastStats > 500) {
          const elapsed = (now - lastStats) / 1000;
          setStats((p) => ({
            fps: Math.round(frameCount / elapsed),
            msgsPerSec: Math.round(msgCount / elapsed),
            hands: hands.length,
            poses: poses.length,
            faces: faces.length,
            gestures,
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
    if (!running) return;
    start().catch((e) =>
      setStats((p) => ({ ...p, lastError: (e as Error).message })),
    );
    return () => {
      stopRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, deviceId]);

  return stats;
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
  // torso
  [11, 12], [11, 23], [12, 24], [23, 24],
  // right arm
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  // left arm
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  // right leg
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
  // left leg
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  // face/shoulders
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