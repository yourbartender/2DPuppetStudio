import type { Landmark } from "@/lib/gestures";

export type InputSourceMode = "camera" | "video" | "image";

export type SpeechViseme =
  | "neutral"
  | "ah"
  | "oh"
  | "smile"
  | "wide";

export const VISEME_LABELS: Record<SpeechViseme, string> = {
  neutral: "Neutral (M/B/P)",
  ah: "Ah (Open)",
  oh: "Oh / Ooo (Round)",
  smile: "Smile / Ee (Wide)",
  wide: "Wide Open (Shout)",
};

export interface TrackedHand {
  label: "L" | "R";
  landmarks: Landmark[]; // 21 smoothed normalized landmarks (top-left origin, mirrored if mirror=true)
  wristAngle: number; // radians, angle from wrist(0) to middle MCP(9)
  palmFacingSign: number; // +1 = palm facing camera, -1 = back of hand facing camera
  scale: number; // normalized hand size (wrist to middle MCP distance)
  gesture: string;
  gestureScore: number;
  pinch: number;
  isGhost: boolean;
  /** 0 = freshly tracked, 0..1 = smoothly returning toward resting A-pose */
  returnToRestBlend: number;
}

export interface TrackedFaceMetrics {
  present: boolean;
  rawAnchorX: number;
  rawAnchorY: number;
  rawIOD: number;
  rawVerticalSkull: number;
  /** Orbit-compensated normalized head offset from calibrated neutral (-0.5..+0.5) */
  headX: number;
  headY: number;
  /** Yaw-invariant head depth scale (1.0 = neutral calibrated distance) */
  headScale: number;
  /** Radians: positive tilts clockwise on screen */
  roll: number;
  /** -1..+1 left/right yaw turn */
  yaw: number;
  /** -1..+1 up/down nod pitch */
  pitch: number;
  /** 0..1 expression intensities */
  mouthOpen: number;
  mouthSmile: number;
  mouthPucker: number;
  browRaise: number;
  eyeBlinkL: number;
  eyeBlinkR: number;
  viseme: SpeechViseme;
}

export interface CalibrationBaseline {
  calibrated: boolean;
  anchorX: number;
  anchorY: number;
  iod: number;
  verticalSkull: number;
  rollOffset: number;
  yawOffset: number;
  pitchOffset: number;
  shoulderSpan: number;
  armSpan: number;
  hipCenterX: number;
  hipCenterY: number;
  leftShoulderX: number;
  leftShoulderY: number;
  rightShoulderX: number;
  rightShoulderY: number;
}

export interface TrackedFrame {
  timestamp: number;
  frameAspect: number;
  isMirrored: boolean;
  hands: TrackedHand[];
  /** 33 MediaPipe Pose landmarks in screen-normalized coords (0..1, top-left origin, mirror applied) */
  poseLandmarks: Landmark[] | null;
  poseJointFresh: boolean[];
  posePresent: boolean;
  poseReturnBlend: number;
  face: TrackedFaceMetrics;
  hasAnyTracking: boolean;
}

export function createEmptyFaceMetrics(): TrackedFaceMetrics {
  return {
    present: false,
    rawAnchorX: 0.5,
    rawAnchorY: 0.42,
    rawIOD: 0.12,
    rawVerticalSkull: 0.16,
    headX: 0,
    headY: 0,
    headScale: 1,
    roll: 0,
    yaw: 0,
    pitch: 0,
    mouthOpen: 0,
    mouthSmile: 0,
    mouthPucker: 0,
    browRaise: 0,
    eyeBlinkL: 0,
    eyeBlinkR: 0,
    viseme: "neutral",
  };
}

export function createEmptyTrackedFrame(): TrackedFrame {
  return {
    timestamp: 0,
    frameAspect: 16 / 9,
    isMirrored: true,
    hands: [],
    poseLandmarks: null,
    poseJointFresh: new Array(33).fill(false),
    posePresent: false,
    poseReturnBlend: 1,
    face: createEmptyFaceMetrics(),
    hasAnyTracking: false,
  };
}

export function createDefaultCalibration(): CalibrationBaseline {
  return {
    calibrated: false,
    anchorX: 0.5,
    anchorY: 0.42,
    iod: 0.12,
    verticalSkull: 0.16,
    rollOffset: 0,
    yawOffset: 0,
    pitchOffset: 0,
    shoulderSpan: 0.24,
    armSpan: 0.34,
    hipCenterX: 0.5,
    hipCenterY: 0.78,
    leftShoulderX: 0.38,
    leftShoulderY: 0.55,
    rightShoulderX: 0.62,
    rightShoulderY: 0.55,
  };
}
