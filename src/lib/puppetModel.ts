import { useCallback, useEffect, useRef, useState } from "react";

export type PuppetCharacterPreset = "aurora_fox" | "human";

export type PuppetPartCategory =
  | "headAndExpressions"
  | "upperBodyAndArms"
  | "lowerBodyAndLegs";

export const PUPPET_CATEGORIES: {
  id: PuppetPartCategory;
  label: string;
  shortLabel: string;
}[] = [
  { id: "headAndExpressions", label: "Head, Eyes, Nose & Mouth", shortLabel: "Head & Face" },
  { id: "upperBodyAndArms", label: "Torso, Shoulders & Arms", shortLabel: "Torso & Arms" },
  { id: "lowerBodyAndLegs", label: "Pelvis, Tail & Legs", shortLabel: "Legs & Tail" },
];

export type EyeAnimationMode = "hybrid" | "sprite" | "squash";
export type MouthAnimationMode = "hybrid" | "sprites" | "warp";
export type PuppetStageBackground = "dark" | "white" | "green" | "blue";

export const STAGE_BACKGROUNDS: {
  id: PuppetStageBackground;
  label: string;
  cssColor: string;
}[] = [
  { id: "dark", label: "Dark Studio", cssColor: "#14171f" },
  { id: "white", label: "Solid White", cssColor: "#ffffff" },
  { id: "green", label: "Chroma Green", cssColor: "#00d926" },
  { id: "blue", label: "Chroma Blue", cssColor: "#0040e6" },
];

export type PuppetPartSlot =
  | "head"
  | "eyesOpen"
  | "rightEyeOpen"
  | "eyesClosed"
  | "rightEyeClosed"
  | "noseOverlay"
  | "browsOverlay"
  | "rightBrows"
  | "mouthNeutral"
  | "mouthAh"
  | "mouthOh"
  | "mouthSmile"
  | "torso"
  | "leftUpperArm"
  | "leftForearm"
  | "leftHand"
  | "leftHandBack"
  | "rightUpperArm"
  | "rightForearm"
  | "rightHand"
  | "rightHandBack"
  | "pelvis"
  | "tail"
  | "leftThigh"
  | "leftShin"
  | "leftFoot"
  | "rightThigh"
  | "rightShin"
  | "rightFoot";

export interface PuppetSlotMeta {
  slot: PuppetPartSlot;
  title: string;
  subtitle: string;
  category: PuppetPartCategory;
}

export const PUPPET_SLOT_META: PuppetSlotMeta[] = [
  // Head & Face
  { slot: "head", title: "Head", subtitle: "Main head graphic — tilts, turns in 2.5D & stretches lower jaw", category: "headAndExpressions" },
  { slot: "eyesOpen", title: "L Eye (Open)", subtitle: "Left open eye sprite (mirrors to Right Eye if R Eye is empty)", category: "headAndExpressions" },
  { slot: "rightEyeOpen", title: "R Eye (Open)", subtitle: "Right open eye sprite", category: "headAndExpressions" },
  { slot: "eyesClosed", title: "L Eye (Closed)", subtitle: "Left blink/wink sprite", category: "headAndExpressions" },
  { slot: "rightEyeClosed", title: "R Eye (Closed)", subtitle: "Right blink/wink sprite", category: "headAndExpressions" },
  { slot: "noseOverlay", title: "Nose", subtitle: "Attaches to Head Nose Pin with 2.5D parallax", category: "headAndExpressions" },
  { slot: "browsOverlay", title: "L Eyebrow", subtitle: "Left eyebrow graphic moving up/down with brow raises", category: "headAndExpressions" },
  { slot: "rightBrows", title: "R Eyebrow", subtitle: "Right eyebrow graphic moving up/down with brow raises", category: "headAndExpressions" },
  { slot: "mouthNeutral", title: "Mouth (Neutral)", subtitle: "Displayed when lips are resting", category: "headAndExpressions" },
  { slot: "mouthAh", title: "Mouth (Ah)", subtitle: "Swapped in for open vowels (Ah / Open)", category: "headAndExpressions" },
  { slot: "mouthOh", title: "Mouth (Oh)", subtitle: "Swapped in for rounded vowels (Oh / Ooo)", category: "headAndExpressions" },
  { slot: "mouthSmile", title: "Mouth (Smile)", subtitle: "Swapped in when smiling or wide vowels (Ee / Smile)", category: "headAndExpressions" },
  // Torso & Arms
  { slot: "torso", title: "Torso", subtitle: "Neck & torso — Head attaches to Neck Mount; Arms to Shoulders", category: "upperBodyAndArms" },
  { slot: "leftUpperArm", title: "L Upper Arm", subtitle: "Connects Left Shoulder to Elbow", category: "upperBodyAndArms" },
  { slot: "leftForearm", title: "L Forearm", subtitle: "Connects Left Elbow to Wrist", category: "upperBodyAndArms" },
  { slot: "leftHand", title: "L Hand", subtitle: "Follows tracked Left Hand position & wrist rotation", category: "upperBodyAndArms" },
  { slot: "leftHandBack", title: "L Hand (Back)", subtitle: "Swapped in when back of Left Hand faces camera", category: "upperBodyAndArms" },
  { slot: "rightUpperArm", title: "R Upper Arm", subtitle: "Connects Right Shoulder to Elbow", category: "upperBodyAndArms" },
  { slot: "rightForearm", title: "R Forearm", subtitle: "Connects Right Elbow to Wrist", category: "upperBodyAndArms" },
  { slot: "rightHand", title: "R Hand", subtitle: "Follows tracked Right Hand position & wrist rotation", category: "upperBodyAndArms" },
  { slot: "rightHandBack", title: "R Hand (Back)", subtitle: "Swapped in when back of Right Hand faces camera", category: "upperBodyAndArms" },
  // Pelvis, Tail & Legs
  { slot: "pelvis", title: "Pelvis", subtitle: "Attaches under Torso Waist Pivot; Legs attach to Hips", category: "lowerBodyAndLegs" },
  { slot: "tail", title: "Tail", subtitle: "Attaches behind lower torso/waist and sways with movement", category: "lowerBodyAndLegs" },
  { slot: "leftThigh", title: "L Thigh", subtitle: "Connects Left Hip to Knee", category: "lowerBodyAndLegs" },
  { slot: "leftShin", title: "L Shin", subtitle: "Connects Left Knee to Ankle", category: "lowerBodyAndLegs" },
  { slot: "leftFoot", title: "L Foot", subtitle: "Attaches to Left Ankle and rests on ground", category: "lowerBodyAndLegs" },
  { slot: "rightThigh", title: "R Thigh", subtitle: "Connects Right Hip to Knee", category: "lowerBodyAndLegs" },
  { slot: "rightShin", title: "R Shin", subtitle: "Connects Right Knee to Ankle", category: "lowerBodyAndLegs" },
  { slot: "rightFoot", title: "R Foot", subtitle: "Attaches to Right Ankle and rests on ground", category: "lowerBodyAndLegs" },
];

export const ALL_PUPPET_SLOTS: PuppetPartSlot[] = PUPPET_SLOT_META.map((m) => m.slot);
export const SLOT_META_BY_ID: Record<PuppetPartSlot, PuppetSlotMeta> = Object.fromEntries(
  PUPPET_SLOT_META.map((m) => [m.slot, m]),
) as Record<PuppetPartSlot, PuppetSlotMeta>;

export const STAGE_LAYER_SLOTS: PuppetPartSlot[] = [
  "leftHand",
  "rightHand",
  "head",
  "leftForearm",
  "rightForearm",
  "leftUpperArm",
  "rightUpperArm",
  "torso",
  "pelvis",
  "leftThigh",
  "rightThigh",
  "leftShin",
  "rightShin",
  "leftFoot",
  "rightFoot",
  "tail",
];

export interface PuppetControlPin {
  id: string;
  name: string;
  trackedSourceLabel: string;
  /** Normalized 0..1 coordinates on the part's image (top-left origin) */
  x: number;
  y: number;
}

/** Exact JSON schema compatible with macOS native PuppetPersistedRigState (.puppet.json) */
export interface PuppetPersistedRigState {
  preset: PuppetCharacterPreset;
  pinsBySlot: Record<string, PuppetControlPin[]>;
  partEnabled: Record<string, boolean>;
  partLayerOrder: Record<string, number>;
  customImagePaths: Record<string, string>;
  partFileNames: Record<string, string>;

  eyeAnimationMode: EyeAnimationMode;
  mouthAnimationMode: MouthAnimationMode;
  blinkThreshold: number;
  autoBlinkEnabled: boolean;

  headMoveAmount: number;
  headTiltAmount: number;
  headTurnParallax: number;
  bodyTurnAmount: number;
  headScaleAmount: number;
  jawWarpAmount: number;
  browWarpAmount: number;
  eyeSpriteScale: number;
  noseSpriteScale: number;
  mouthSpriteScale: number;
  characterScale: number;
  handScale: number;
  armLengthScale: number;
  armThicknessScale: number;
  legLengthScale: number;
  legThicknessScale: number;
  showFullBodyLegs: boolean;
  stageBackground: PuppetStageBackground;

  partWidthScale?: Record<string, number>;
  partHeightScale?: Record<string, number>;
  partRotationOffset?: Record<string, number>;
  partFlipH?: Record<string, boolean>;
  partFlipV?: Record<string, boolean>;
  partOffsetX?: Record<string, number>;
  partOffsetY?: Record<string, number>;
  layerStack?: string[];

  embeddedImagesBase64?: Record<string, string>;
  puppetStageOffsetX?: number;
  puppetStageOffsetY?: number;
  idleMotionAmount?: number;
  characterName?: string;
  humanAnatomyConstraints?: number;
  dynamicPalmFlip?: boolean;
  jawWarpEnabled?: boolean;
  followChildrenOnMove?: boolean;
  followChildrenOnRotate?: boolean;
  armReachExaggeration?: number;
}

export interface PuppetRigState {
  preset: PuppetCharacterPreset;
  characterName: string;
  pinsBySlot: Record<PuppetPartSlot, PuppetControlPin[]>;
  partDataUrls: Partial<Record<PuppetPartSlot, string>>;
  partFileNames: Partial<Record<PuppetPartSlot, string>>;
  partEnabled: Record<PuppetPartSlot, boolean>;
  layerStack: PuppetPartSlot[];

  partWidthScale: Partial<Record<PuppetPartSlot, number>>;
  partHeightScale: Partial<Record<PuppetPartSlot, number>>;
  partRotationOffset: Partial<Record<PuppetPartSlot, number>>;
  partFlipH: Partial<Record<PuppetPartSlot, boolean>>;
  partFlipV: Partial<Record<PuppetPartSlot, boolean>>;
  partOffsetX: Partial<Record<PuppetPartSlot, number>>;
  partOffsetY: Partial<Record<PuppetPartSlot, number>>;

  eyeAnimationMode: EyeAnimationMode;
  mouthAnimationMode: MouthAnimationMode;
  blinkThreshold: number;
  autoBlinkEnabled: boolean;

  headMoveAmount: number;
  headTiltAmount: number;
  headTurnParallax: number;
  bodyTurnAmount: number;
  headScaleAmount: number;
  jawWarpAmount: number;
  browWarpAmount: number;
  eyeSpriteScale: number;
  noseSpriteScale: number;
  mouthSpriteScale: number;

  characterScale: number;
  handScale: number;
  armLengthScale: number;
  armThicknessScale: number;
  armReachExaggeration: number;
  legLengthScale: number;
  legThicknessScale: number;
  showFullBodyLegs: boolean;
  stageBackground: PuppetStageBackground;

  stageOffsetX: number;
  stageOffsetY: number;
  idleMotionAmount: number;
  humanAnatomyConstraints: number;
  dynamicPalmFlip: boolean;
  jawWarpEnabled: boolean;
  followChildrenOnMove: boolean;
  followChildrenOnRotate: boolean;
}

export function defaultLayerStack(): PuppetPartSlot[] {
  return [...STAGE_LAYER_SLOTS];
}

export function normalizeLayerStack(raw?: string[]): PuppetPartSlot[] {
  const allowed = new Set<string>(STAGE_LAYER_SLOTS);
  const out: PuppetPartSlot[] = [];
  const seen = new Set<string>();
  if (raw) {
    for (const s of raw) {
      if (allowed.has(s) && !seen.has(s)) {
        out.push(s as PuppetPartSlot);
        seen.add(s);
      }
    }
  }
  for (const s of STAGE_LAYER_SLOTS) {
    if (!seen.has(s)) {
      out.push(s);
      seen.add(s);
    }
  }
  return out;
}

export function defaultPins(): Record<PuppetPartSlot, PuppetControlPin[]> {
  const centerEye: PuppetControlPin[] = [
    { id: "eyeCenter", name: "Eye Center", trackedSourceLabel: "Aligns with Head Eye Pin", x: 0.5, y: 0.5 },
  ];
  const centerBrow: PuppetControlPin[] = [
    { id: "browsAnchor", name: "Brows Center", trackedSourceLabel: "Attaches to Head Brow Pin", x: 0.5, y: 0.5 },
  ];
  const centerMouth: PuppetControlPin[] = [
    { id: "mouthAnchor", name: "Mouth Center", trackedSourceLabel: "Aligns with Head Mouth Pin", x: 0.5, y: 0.5 },
  ];
  const upperArmPins: PuppetControlPin[] = [
    { id: "shoulderJoint", name: "Shoulder Joint", trackedSourceLabel: "Attaches to Torso Shoulder", x: 0.5, y: 0.15 },
    { id: "elbowJoint", name: "Elbow Joint", trackedSourceLabel: "2-Bone IK Elbow", x: 0.5, y: 0.85 },
  ];
  const forearmPins: PuppetControlPin[] = [
    { id: "elbowJoint", name: "Elbow Joint", trackedSourceLabel: "Attaches to Upper Arm Elbow", x: 0.5, y: 0.15 },
    { id: "wristJoint", name: "Wrist Joint", trackedSourceLabel: "Hand Wrist / Pose Wrist", x: 0.5, y: 0.85 },
  ];
  const leftHandPins: PuppetControlPin[] = [
    { id: "wristPivot", name: "Wrist Pivot", trackedSourceLabel: "Hand Wrist (Landmark 0)", x: 0.5, y: 0.16 },
    { id: "middleKnuckle", name: "Finger Direction", trackedSourceLabel: "Middle MCP (Landmark 9)", x: 0.5, y: 0.82 },
    { id: "thumbPin", name: "Thumb Direction", trackedSourceLabel: "Thumb Tip (Landmark 4)", x: 0.28, y: 0.52 },
  ];
  const rightHandPins: PuppetControlPin[] = [
    { id: "wristPivot", name: "Wrist Pivot", trackedSourceLabel: "Hand Wrist (Landmark 0)", x: 0.5, y: 0.16 },
    { id: "middleKnuckle", name: "Finger Direction", trackedSourceLabel: "Middle MCP (Landmark 9)", x: 0.5, y: 0.82 },
    { id: "thumbPin", name: "Thumb Direction", trackedSourceLabel: "Thumb Tip (Landmark 4)", x: 0.72, y: 0.52 },
  ];
  const thighPins: PuppetControlPin[] = [
    { id: "hipJoint", name: "Hip Joint", trackedSourceLabel: "Attaches to Pelvis Hip", x: 0.5, y: 0.14 },
    { id: "kneeJoint", name: "Knee Joint", trackedSourceLabel: "Pose Knee (25 / 26)", x: 0.5, y: 0.86 },
  ];
  const shinPins: PuppetControlPin[] = [
    { id: "kneeJoint", name: "Knee Joint", trackedSourceLabel: "Attaches to Thigh Knee", x: 0.5, y: 0.12 },
    { id: "ankleJoint", name: "Ankle / Foot", trackedSourceLabel: "Pose Ankle (27 / 28)", x: 0.5, y: 0.88 },
  ];

  const clone = (arr: PuppetControlPin[]) => arr.map((p) => ({ ...p }));

  return {
    head: [
      { id: "neckPivot", name: "Head Base / Neck Joint", trackedSourceLabel: "Attaches to Torso Neck Mount", x: 0.5, y: 0.78 },
      { id: "leftBrow", name: "Left Brow", trackedSourceLabel: "Face Left Eyebrow", x: 0.35, y: 0.36 },
      { id: "rightBrow", name: "Right Brow", trackedSourceLabel: "Face Right Eyebrow", x: 0.65, y: 0.36 },
      { id: "leftEye", name: "Left Eye", trackedSourceLabel: "Left Eye Sprite & Wink Anchor", x: 0.35, y: 0.48 },
      { id: "rightEye", name: "Right Eye", trackedSourceLabel: "Right Eye Sprite & Wink Anchor", x: 0.65, y: 0.48 },
      { id: "noseCenter", name: "Nose Tip", trackedSourceLabel: "Nose Layer & 2.5D Turn Center", x: 0.5, y: 0.58 },
      { id: "mouthCenter", name: "Mouth Pin", trackedSourceLabel: "Mouth Viseme Sprite & Jaw Split", x: 0.5, y: 0.72 },
      { id: "jawChin", name: "Lower Jaw / Chin", trackedSourceLabel: "Stretches Down When Mouth Opens", x: 0.5, y: 0.88 },
    ],
    eyesOpen: clone(centerEye),
    rightEyeOpen: clone(centerEye),
    eyesClosed: clone(centerEye),
    rightEyeClosed: clone(centerEye),
    noseOverlay: [{ id: "noseAnchor", name: "Nose Center", trackedSourceLabel: "Aligns with Head Nose Pin", x: 0.5, y: 0.5 }],
    browsOverlay: clone(centerBrow),
    rightBrows: clone(centerBrow),
    mouthNeutral: clone(centerMouth),
    mouthAh: clone(centerMouth),
    mouthOh: clone(centerMouth),
    mouthSmile: clone(centerMouth),

    torso: [
      { id: "neckMount", name: "Neck Top (Head Mount)", trackedSourceLabel: "Where Head Attaches", x: 0.5, y: 0.12 },
      { id: "leftShoulder", name: "Left Shoulder", trackedSourceLabel: "Pose Left Shoulder / L Arm Mount", x: 0.2, y: 0.34 },
      { id: "rightShoulder", name: "Right Shoulder", trackedSourceLabel: "Pose Right Shoulder / R Arm Mount", x: 0.8, y: 0.34 },
      { id: "waistPivot", name: "Waist / Pelvis Mount", trackedSourceLabel: "Attaches to Pelvis Waist Joint", x: 0.5, y: 0.88 },
    ],
    leftUpperArm: clone(upperArmPins),
    rightUpperArm: clone(upperArmPins),
    leftForearm: clone(forearmPins),
    rightForearm: clone(forearmPins),
    leftHand: clone(leftHandPins),
    leftHandBack: clone(leftHandPins),
    rightHand: clone(rightHandPins),
    rightHandBack: clone(rightHandPins),

    pelvis: [
      { id: "waistJoint", name: "Waist Joint", trackedSourceLabel: "Supports Torso Waist Pivot", x: 0.5, y: 0.22 },
      { id: "leftHip", name: "Left Hip", trackedSourceLabel: "Pose Left Hip / L Leg Mount", x: 0.3, y: 0.72 },
      { id: "rightHip", name: "Right Hip", trackedSourceLabel: "Pose Right Hip / R Leg Mount", x: 0.7, y: 0.72 },
    ],
    tail: [
      { id: "tailBase", name: "Tail Base Pivot", trackedSourceLabel: "Attaches behind Torso Waist", x: 0.5, y: 0.18 },
      { id: "tailTip", name: "Tail Tip", trackedSourceLabel: "Sways with Body & 2.5D Turn", x: 0.5, y: 0.85 },
    ],
    leftThigh: clone(thighPins),
    rightThigh: clone(thighPins),
    leftShin: clone(shinPins),
    rightShin: clone(shinPins),
    leftFoot: [
      { id: "ankleJoint", name: "Ankle Joint", trackedSourceLabel: "Attaches to Left Shin Ankle", x: 0.5, y: 0.2 },
      { id: "toeTip", name: "Toe Tip", trackedSourceLabel: "Toe Tip / Ground Level", x: 0.2, y: 0.85 },
    ],
    rightFoot: [
      { id: "ankleJoint", name: "Ankle Joint", trackedSourceLabel: "Attaches to Right Shin Ankle", x: 0.5, y: 0.2 },
      { id: "toeTip", name: "Toe Tip", trackedSourceLabel: "Toe Tip / Ground Level", x: 0.8, y: 0.85 },
    ],
  };
}

export function getPin(
  state: PuppetRigState,
  slot: PuppetPartSlot,
  pinId: string,
): { x: number; y: number } {
  const found = state.pinsBySlot[slot]?.find((p) => p.id === pinId);
  if (found) return { x: found.x, y: found.y };
  const def = defaultPins()[slot]?.find((p) => p.id === pinId);
  return def ? { x: def.x, y: def.y } : { x: 0.5, y: 0.5 };
}

// ── Procedural Demo Human Graphics (matches macOS Native demo character) ───

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  return [c, ctx];
}

function makeDemoHead(): string {
  const [c, ctx] = makeCanvas(512, 512);
  const hair = "#3d3833";
  const outline = "#292420";
  const skin = "#ebbfa0";
  const skinShadow = "#dfb090";

  // Top knot bun
  ctx.fillStyle = hair;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(198, 18, 116, 76, 38);
  ctx.fill();
  ctx.stroke();

  // Hair tie
  ctx.fillStyle = "#2eb8a8";
  ctx.beginPath();
  ctx.roundRect(212, 76, 88, 16, 8);
  ctx.fill();

  // Ears
  ctx.fillStyle = skinShadow;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(104, 265, 24, 38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(408, 265, 24, 38, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Main hair dome
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.ellipse(256, 228, 152, 148, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Face oval
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(256, 276, 134, 154, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Soft blush cheeks
  ctx.fillStyle = "rgba(235, 130, 125, 0.25)";
  ctx.beginPath();
  ctx.ellipse(174, 304, 26, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(338, 304, 26, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  // Bangs fringe
  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.moveTo(116, 232);
  ctx.quadraticCurveTo(160, 128, 256, 126);
  ctx.quadraticCurveTo(352, 128, 396, 232);
  ctx.quadraticCurveTo(340, 182, 272, 198);
  ctx.quadraticCurveTo(212, 178, 116, 232);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  return c.toDataURL("image/png");
}

function makeDemoEye(closed: boolean): string {
  const [c, ctx] = makeCanvas(160, 120);
  if (closed) {
    ctx.strokeStyle = "#221e1b";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(22, 62);
    ctx.quadraticCurveTo(80, 94, 138, 62);
    ctx.stroke();
  } else {
    // Sclera
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#221e1b";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(80, 62, 54, 36, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Iris
    ctx.fillStyle = "#2c6b75";
    ctx.beginPath();
    ctx.arc(80, 62, 24, 0, Math.PI * 2);
    ctx.fill();
    // Pupil
    ctx.fillStyle = "#12161a";
    ctx.beginPath();
    ctx.arc(80, 62, 13, 0, Math.PI * 2);
    ctx.fill();
    // Catchlight
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(71, 52, 6, 0, Math.PI * 2);
    ctx.fill();
    // Upper lash
    ctx.strokeStyle = "#221e1b";
    ctx.lineWidth = 8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(24, 58);
    ctx.quadraticCurveTo(80, 16, 136, 58);
    ctx.stroke();
  }
  return c.toDataURL("image/png");
}

function makeDemoNose(): string {
  const [c, ctx] = makeCanvas(96, 96);
  ctx.strokeStyle = "#9c6e52";
  ctx.fillStyle = "rgba(210, 150, 120, 0.35)";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(48, 22);
  ctx.quadraticCurveTo(38, 56, 42, 64);
  ctx.quadraticCurveTo(48, 72, 58, 62);
  ctx.stroke();
  return c.toDataURL("image/png");
}

function makeDemoBrow(): string {
  const [c, ctx] = makeCanvas(160, 72);
  ctx.strokeStyle = "#332c28";
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(22, 46);
  ctx.quadraticCurveTo(80, 20, 138, 42);
  ctx.stroke();
  return c.toDataURL("image/png");
}

function makeDemoMouth(kind: "neutral" | "ah" | "oh" | "smile"): string {
  const [c, ctx] = makeCanvas(180, 120);
  ctx.strokeStyle = "#2b1d1a";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  if (kind === "neutral") {
    ctx.beginPath();
    ctx.moveTo(42, 62);
    ctx.quadraticCurveTo(90, 76, 138, 62);
    ctx.stroke();
  } else if (kind === "smile") {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(32, 46);
    ctx.quadraticCurveTo(90, 56, 148, 46);
    ctx.quadraticCurveTo(138, 92, 90, 94);
    ctx.quadraticCurveTo(42, 92, 32, 46);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === "ah") {
    ctx.fillStyle = "#7a232b";
    ctx.beginPath();
    ctx.ellipse(90, 62, 42, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Tongue
    ctx.fillStyle = "#d95f6a";
    ctx.beginPath();
    ctx.ellipse(90, 80, 26, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    // Top teeth
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(60, 32, 60, 14, 5);
    ctx.fill();
  } else {
    // oh
    ctx.fillStyle = "#7a232b";
    ctx.beginPath();
    ctx.ellipse(90, 62, 24, 30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  return c.toDataURL("image/png");
}

function makeDemoTorso(): string {
  const [c, ctx] = makeCanvas(340, 400);
  const outline = "#24222c";
  // Neck
  ctx.fillStyle = "#e3b494";
  ctx.strokeStyle = outline;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(138, 16, 64, 92, 24);
  ctx.fill();
  ctx.stroke();

  // Shirt torso
  const grad = ctx.createLinearGradient(0, 86, 0, 380);
  grad.addColorStop(0, "#463d5c");
  grad.addColorStop(1, "#332c45");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(86, 108);
  ctx.quadraticCurveTo(170, 74, 254, 108);
  ctx.quadraticCurveTo(288, 130, 274, 240);
  ctx.lineTo(256, 366);
  ctx.quadraticCurveTo(170, 390, 84, 366);
  ctx.lineTo(66, 240);
  ctx.quadraticCurveTo(52, 130, 86, 108);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Teal collar trim
  ctx.strokeStyle = "#31c4b2";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(170, 96, 44, 0.25, Math.PI - 0.25);
  ctx.stroke();

  return c.toDataURL("image/png");
}

function makeDemoLimb(topColor: string, bottomColor: string, widthPx: number): string {
  const [c, ctx] = makeCanvas(128, 280);
  const x = (128 - widthPx) / 2;
  const grad = ctx.createLinearGradient(0, 18, 0, 262);
  grad.addColorStop(0, topColor);
  grad.addColorStop(0.65, topColor);
  grad.addColorStop(1, bottomColor);
  ctx.fillStyle = grad;
  ctx.strokeStyle = "#22202a";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(x, 18, widthPx, 244, widthPx / 2);
  ctx.fill();
  ctx.stroke();
  return c.toDataURL("image/png");
}

function makeDemoHand(isLeft: boolean): string {
  const [c, ctx] = makeCanvas(160, 190);
  ctx.fillStyle = "#ebbfa0";
  ctx.strokeStyle = "#292420";
  ctx.lineWidth = 5;

  // Palm
  ctx.beginPath();
  ctx.roundRect(42, 24, 76, 86, 28);
  ctx.fill();
  ctx.stroke();

  // Four fingers pointing downward (matches wristPivot y=0.16 -> middleKnuckle y=0.82)
  const fx = [46, 65, 84, 102];
  const fl = [54, 66, 62, 48];
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.roundRect(fx[i] - 7, 94, 18, fl[i], 9);
    ctx.fill();
    ctx.stroke();
  }

  // Thumb on inner side
  ctx.save();
  const thumbX = isLeft ? 34 : 126;
  ctx.translate(thumbX, 74);
  ctx.rotate(isLeft ? 0.55 : -0.55);
  ctx.beginPath();
  ctx.roundRect(-10, -8, 20, 48, 10);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  return c.toDataURL("image/png");
}

function makeDemoPelvis(): string {
  const [c, ctx] = makeCanvas(280, 160);
  ctx.fillStyle = "#2b3d54";
  ctx.strokeStyle = "#1c2430";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(38, 18, 204, 118, 42);
  ctx.fill();
  ctx.stroke();
  // Belt line
  ctx.fillStyle = "#1f2733";
  ctx.fillRect(42, 22, 196, 22);
  ctx.fillStyle = "#31c4b2";
  ctx.beginPath();
  ctx.roundRect(124, 20, 32, 26, 6);
  ctx.fill();
  return c.toDataURL("image/png");
}

function makeDemoShinWithShoe(isLeft: boolean): string {
  const [c, ctx] = makeCanvas(160, 290);
  // Shin leg
  ctx.fillStyle = "#2b3d54";
  ctx.strokeStyle = "#1c2430";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(52, 14, 56, 210, 26);
  ctx.fill();
  ctx.stroke();

  // Sneaker
  ctx.fillStyle = "#2eb8a8";
  ctx.beginPath();
  if (isLeft) {
    ctx.roundRect(22, 216, 98, 52, 22);
  } else {
    ctx.roundRect(40, 216, 98, 52, 22);
  }
  ctx.fill();
  ctx.stroke();

  // Sole
  ctx.fillStyle = "#f2f5f7";
  ctx.fillRect(isLeft ? 28 : 46, 254, 86, 12);
  return c.toDataURL("image/png");
}

export function createDemoHumanState(): PuppetRigState {
  const forearmUrl = makeDemoLimb("#463d5c", "#ebbfa0", 56);
  const upperArmUrl = makeDemoLimb("#463d5c", "#463d5c", 64);
  const thighUrl = makeDemoLimb("#2b3d54", "#2b3d54", 72);
  const eyeOpenUrl = makeDemoEye(false);
  const eyeClosedUrl = makeDemoEye(true);
  const browUrl = makeDemoBrow();

  const partDataUrls: Partial<Record<PuppetPartSlot, string>> = {
    head: makeDemoHead(),
    eyesOpen: eyeOpenUrl,
    rightEyeOpen: eyeOpenUrl,
    eyesClosed: eyeClosedUrl,
    rightEyeClosed: eyeClosedUrl,
    noseOverlay: makeDemoNose(),
    browsOverlay: browUrl,
    rightBrows: browUrl,
    mouthNeutral: makeDemoMouth("neutral"),
    mouthAh: makeDemoMouth("ah"),
    mouthOh: makeDemoMouth("oh"),
    mouthSmile: makeDemoMouth("smile"),
    torso: makeDemoTorso(),
    leftUpperArm: upperArmUrl,
    rightUpperArm: upperArmUrl,
    leftForearm: forearmUrl,
    rightForearm: forearmUrl,
    leftHand: makeDemoHand(true),
    rightHand: makeDemoHand(false),
    pelvis: makeDemoPelvis(),
    leftThigh: thighUrl,
    rightThigh: thighUrl,
    leftShin: makeDemoShinWithShoe(true),
    rightShin: makeDemoShinWithShoe(false),
  };

  const partEnabled = {} as Record<PuppetPartSlot, boolean>;
  const partFileNames: Partial<Record<PuppetPartSlot, string>> = {};
  for (const slot of ALL_PUPPET_SLOTS) {
    partEnabled[slot] =
      slot !== "browsOverlay" &&
      slot !== "rightBrows" &&
      slot !== "tail" &&
      slot !== "leftHandBack" &&
      slot !== "rightHandBack" &&
      slot !== "leftFoot" &&
      slot !== "rightFoot";
    if (partDataUrls[slot]) {
      partFileNames[slot] = `Demo ${SLOT_META_BY_ID[slot].title}`;
    }
  }

  return {
    preset: "human",
    characterName: "Demo Character",
    pinsBySlot: defaultPins(),
    partDataUrls,
    partFileNames,
    partEnabled,
    layerStack: defaultLayerStack(),

    partWidthScale: {},
    partHeightScale: {},
    partRotationOffset: {},
    partFlipH: {},
    partFlipV: {},
    partOffsetX: {},
    partOffsetY: {},

    eyeAnimationMode: "hybrid",
    mouthAnimationMode: "hybrid",
    blinkThreshold: 0.34,
    autoBlinkEnabled: true,

    headMoveAmount: 1.0,
    headTiltAmount: 1.0,
    headTurnParallax: 0.9,
    bodyTurnAmount: 0.65,
    headScaleAmount: 0.35,
    jawWarpAmount: 0.45,
    browWarpAmount: 0.45,
    eyeSpriteScale: 1.0,
    noseSpriteScale: 1.0,
    mouthSpriteScale: 1.0,

    characterScale: 0.34,
    handScale: 0.16,
    armLengthScale: 1.0,
    armThicknessScale: 1.0,
    armReachExaggeration: 0.35,
    legLengthScale: 1.0,
    legThicknessScale: 1.0,
    showFullBodyLegs: true,
    stageBackground: "dark",

    stageOffsetX: 0,
    stageOffsetY: 0,
    idleMotionAmount: 0.5,
    humanAnatomyConstraints: 0.85,
    dynamicPalmFlip: false,
    jawWarpEnabled: true,
    followChildrenOnMove: true,
    followChildrenOnRotate: true,
  };
}

export function createBlankPuppetState(name = "New Puppet"): PuppetRigState {
  const base = createDemoHumanState();
  const partEnabled = {} as Record<PuppetPartSlot, boolean>;
  for (const slot of ALL_PUPPET_SLOTS) partEnabled[slot] = false;
  return {
    ...base,
    characterName: name,
    partDataUrls: {},
    partFileNames: {},
    partEnabled,
    pinsBySlot: defaultPins(),
    layerStack: defaultLayerStack(),
  };
}

// ── Serialization (.puppet.json 100% compatible with macOS Native) ─────────

export function serializeToPersistedState(
  state: PuppetRigState,
  includeImages = true,
): PuppetPersistedRigState {
  const embeddedImagesBase64: Record<string, string> = {};
  if (includeImages) {
    for (const [slot, url] of Object.entries(state.partDataUrls)) {
      if (!url) continue;
      const comma = url.indexOf(",");
      embeddedImagesBase64[slot] = comma >= 0 ? url.slice(comma + 1) : url;
    }
  }

  return {
    preset: state.preset,
    characterName: state.characterName,
    pinsBySlot: state.pinsBySlot,
    partEnabled: state.partEnabled,
    partLayerOrder: {},
    customImagePaths: {},
    partFileNames: state.partFileNames as Record<string, string>,

    eyeAnimationMode: state.eyeAnimationMode,
    mouthAnimationMode: state.mouthAnimationMode,
    blinkThreshold: state.blinkThreshold,
    autoBlinkEnabled: state.autoBlinkEnabled,

    headMoveAmount: state.headMoveAmount,
    headTiltAmount: state.headTiltAmount,
    headTurnParallax: state.headTurnParallax,
    bodyTurnAmount: state.bodyTurnAmount,
    headScaleAmount: state.headScaleAmount,
    jawWarpAmount: state.jawWarpAmount,
    browWarpAmount: state.browWarpAmount,
    eyeSpriteScale: state.eyeSpriteScale,
    noseSpriteScale: state.noseSpriteScale,
    mouthSpriteScale: state.mouthSpriteScale,
    characterScale: state.characterScale,
    handScale: state.handScale,
    armLengthScale: state.armLengthScale,
    armThicknessScale: state.armThicknessScale,
    armReachExaggeration: state.armReachExaggeration,
    legLengthScale: state.legLengthScale,
    legThicknessScale: state.legThicknessScale,
    showFullBodyLegs: state.showFullBodyLegs,
    stageBackground: state.stageBackground,

    partWidthScale: state.partWidthScale as Record<string, number>,
    partHeightScale: state.partHeightScale as Record<string, number>,
    partRotationOffset: state.partRotationOffset as Record<string, number>,
    partFlipH: state.partFlipH as Record<string, boolean>,
    partFlipV: state.partFlipV as Record<string, boolean>,
    partOffsetX: state.partOffsetX as Record<string, number>,
    partOffsetY: state.partOffsetY as Record<string, number>,
    layerStack: state.layerStack,

    embeddedImagesBase64:
      includeImages && Object.keys(embeddedImagesBase64).length > 0
        ? embeddedImagesBase64
        : undefined,
    puppetStageOffsetX: state.stageOffsetX,
    puppetStageOffsetY: state.stageOffsetY,
    idleMotionAmount: state.idleMotionAmount,
    humanAnatomyConstraints: state.humanAnatomyConstraints,
    dynamicPalmFlip: state.dynamicPalmFlip,
    jawWarpEnabled: state.jawWarpEnabled,
    followChildrenOnMove: state.followChildrenOnMove,
    followChildrenOnRotate: state.followChildrenOnRotate,
  };
}

export function deserializePersistedState(
  raw: PuppetPersistedRigState,
  fallbackBase?: PuppetRigState,
): PuppetRigState {
  const base = fallbackBase ?? createBlankPuppetState("Imported Character");
  const pins = defaultPins();
  if (raw.pinsBySlot) {
    for (const slot of ALL_PUPPET_SLOTS) {
      const incoming = raw.pinsBySlot[slot];
      if (Array.isArray(incoming) && incoming.length > 0) {
        // Merge incoming coordinates onto default pins so any newly added pins still exist
        const merged = pins[slot].map((defPin) => {
          const match = incoming.find((p) => p.id === defPin.id);
          return match ? { ...defPin, x: match.x, y: match.y } : defPin;
        });
        pins[slot] = merged;
      }
    }
  }

  const partDataUrls: Partial<Record<PuppetPartSlot, string>> = raw.embeddedImagesBase64
    ? {}
    : { ...base.partDataUrls };
  if (raw.embeddedImagesBase64) {
    for (const [slot, b64] of Object.entries(raw.embeddedImagesBase64)) {
      if (!b64) continue;
      partDataUrls[slot as PuppetPartSlot] = b64.startsWith("data:")
        ? b64
        : `data:image/png;base64,${b64}`;
    }
  }

  const partEnabled = { ...base.partEnabled };
  for (const slot of ALL_PUPPET_SLOTS) {
    if (raw.partEnabled && slot in raw.partEnabled) {
      partEnabled[slot] = Boolean(raw.partEnabled[slot]);
    } else if (raw.embeddedImagesBase64) {
      partEnabled[slot] = Boolean(partDataUrls[slot]);
    }
  }

  return {
    preset: raw.preset ?? "human",
    characterName: raw.characterName || base.characterName || "Character",
    pinsBySlot: pins,
    partDataUrls,
    partFileNames: (raw.partFileNames as Partial<Record<PuppetPartSlot, string>>) ?? {},
    partEnabled,
    layerStack: normalizeLayerStack(raw.layerStack),

    partWidthScale: (raw.partWidthScale as Partial<Record<PuppetPartSlot, number>>) ?? {},
    partHeightScale: (raw.partHeightScale as Partial<Record<PuppetPartSlot, number>>) ?? {},
    partRotationOffset: (raw.partRotationOffset as Partial<Record<PuppetPartSlot, number>>) ?? {},
    partFlipH: (raw.partFlipH as Partial<Record<PuppetPartSlot, boolean>>) ?? {},
    partFlipV: (raw.partFlipV as Partial<Record<PuppetPartSlot, boolean>>) ?? {},
    partOffsetX: (raw.partOffsetX as Partial<Record<PuppetPartSlot, number>>) ?? {},
    partOffsetY: (raw.partOffsetY as Partial<Record<PuppetPartSlot, number>>) ?? {},

    eyeAnimationMode: raw.eyeAnimationMode ?? "hybrid",
    mouthAnimationMode: raw.mouthAnimationMode ?? "hybrid",
    blinkThreshold: raw.blinkThreshold ?? 0.34,
    autoBlinkEnabled: raw.autoBlinkEnabled ?? true,

    headMoveAmount: raw.headMoveAmount ?? 1.0,
    headTiltAmount: raw.headTiltAmount ?? 1.0,
    headTurnParallax: raw.headTurnParallax ?? 0.9,
    bodyTurnAmount: raw.bodyTurnAmount ?? 0.65,
    headScaleAmount: raw.headScaleAmount ?? 0.35,
    jawWarpAmount: raw.jawWarpAmount ?? 0.45,
    browWarpAmount: raw.browWarpAmount ?? 0.45,
    eyeSpriteScale: raw.eyeSpriteScale ?? 1.0,
    noseSpriteScale: raw.noseSpriteScale ?? 1.0,
    mouthSpriteScale: raw.mouthSpriteScale ?? 1.0,

    characterScale: raw.characterScale ?? 0.34,
    handScale: raw.handScale ?? 0.16,
    armLengthScale: raw.armLengthScale ?? 1.0,
    armThicknessScale: raw.armThicknessScale ?? 1.0,
    armReachExaggeration: raw.armReachExaggeration ?? 0.35,
    legLengthScale: raw.legLengthScale ?? 1.0,
    legThicknessScale: raw.legThicknessScale ?? 1.0,
    showFullBodyLegs: raw.showFullBodyLegs ?? true,
    stageBackground: raw.stageBackground ?? "dark",

    stageOffsetX: raw.puppetStageOffsetX ?? 0,
    stageOffsetY: raw.puppetStageOffsetY ?? 0,
    idleMotionAmount: raw.idleMotionAmount ?? 0.5,
    humanAnatomyConstraints: raw.humanAnatomyConstraints ?? 0.85,
    dynamicPalmFlip: raw.dynamicPalmFlip ?? false,
    jawWarpEnabled: raw.jawWarpEnabled ?? true,
    followChildrenOnMove: raw.followChildrenOnMove ?? true,
    followChildrenOnRotate: raw.followChildrenOnRotate ?? true,
  };
}

// ── IndexedDB Autosave (handles large base64 PNG rigs cleanly) ─────────────

const IDB_NAME = "PuppetStudioDB";
const IDB_STORE = "rigs";
const IDB_KEY = "activeRig";

function openRigDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveRigToIDB(state: PuppetPersistedRigState): Promise<void> {
  try {
    const db = await openRigDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(state, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Ignore storage quota or private-mode errors
  }
}

async function loadRigFromIDB(): Promise<PuppetPersistedRigState | null> {
  try {
    const db = await openRigDB();
    const res = await new Promise<PuppetPersistedRigState | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve((req.result as PuppetPersistedRigState) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return res;
  } catch {
    return null;
  }
}

// ── React Store Hook (with Undo/Redo, Image Cache & Autosave) ──────────────

export interface PuppetStore {
  rig: PuppetRigState;
  images: Partial<Record<PuppetPartSlot, HTMLImageElement>>;
  imageVersion: number;
  selectedCategory: PuppetPartCategory;
  setSelectedCategory: (cat: PuppetPartCategory) => void;
  selectedSlot: PuppetPartSlot;
  setSelectedSlot: (slot: PuppetPartSlot) => void;
  selectedPinId: string | null;
  setSelectedPinId: (id: string | null) => void;
  canUndo: boolean;
  canRedo: boolean;
  statusMessage: string;
  undo: () => void;
  redo: () => void;
  updateRig: (updater: (prev: PuppetRigState) => PuppetRigState, recordUndo?: boolean) => void;
  setPartImage: (slot: PuppetPartSlot, dataUrl: string, fileName: string) => void;
  copyPartImage: (fromSlot: PuppetPartSlot, toSlot: PuppetPartSlot) => void;
  clearPartImage: (slot: PuppetPartSlot) => void;
  updatePin: (slot: PuppetPartSlot, pinId: string, x: number, y: number, recordUndo?: boolean) => void;
  resetSinglePin: (slot: PuppetPartSlot, pinId: string) => void;
  resetAllPins: () => void;
  moveLayerForward: (slot: PuppetPartSlot) => void;
  moveLayerBackward: (slot: PuppetPartSlot) => void;
  resetToDemoHuman: () => void;
  resetToBlankPuppet: (name?: string) => void;
  exportCharacterPackage: (includeImages?: boolean) => void;
  importCharacterFile: (file: File) => Promise<void>;
}

const MAX_UNDO = 30;

export function usePuppetStore(): PuppetStore {
  const [rig, setRig] = useState<PuppetRigState>(() => createDemoHumanState());
  const [selectedCategory, setSelectedCategory] =
    useState<PuppetPartCategory>("headAndExpressions");
  const [selectedSlot, setSelectedSlot] = useState<PuppetPartSlot>("head");
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("Ready");

  const undoStackRef = useRef<PuppetRigState[]>([]);
  const redoStackRef = useRef<PuppetRigState[]>([]);
  const [undoRedoVer, setUndoRedoVer] = useState(0);

  // Decoded HTMLImageElement cache for 60 FPS canvas rendering
  const imagesRef = useRef<Partial<Record<PuppetPartSlot, HTMLImageElement>>>({});
  const loadedUrlsRef = useRef<Partial<Record<PuppetPartSlot, string>>>({});
  const [imageVersion, setImageVersion] = useState(0);
  const hydratedRef = useRef(false);

  // Hydrate autosaved character from IndexedDB on startup
  useEffect(() => {
    let active = true;
    loadRigFromIDB().then((saved) => {
      if (!active) return;
      hydratedRef.current = true;
      if (saved) {
        setRig(deserializePersistedState(saved, createDemoHumanState()));
        setStatusMessage(`Restored ${saved.characterName || "Saved Rig"}`);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  // Decode any changed dataUrls into HTMLImageElement objects
  useEffect(() => {
    let mounted = true;
    for (const slot of ALL_PUPPET_SLOTS) {
      const url = rig.partDataUrls[slot];
      if (!url) {
        if (imagesRef.current[slot]) {
          delete imagesRef.current[slot];
          delete loadedUrlsRef.current[slot];
          setImageVersion((v) => v + 1);
        }
        continue;
      }
      if (loadedUrlsRef.current[slot] === url && imagesRef.current[slot]) {
        continue;
      }
      loadedUrlsRef.current[slot] = url;
      const img = new Image();
      img.onload = () => {
        if (!mounted) return;
        if (loadedUrlsRef.current[slot] === url) {
          imagesRef.current[slot] = img;
          setImageVersion((v) => v + 1);
        }
      };
      img.src = url;
    }
    return () => {
      mounted = false;
    };
  }, [rig.partDataUrls]);

  // Debounced autosave to IndexedDB (400ms)
  useEffect(() => {
    if (!hydratedRef.current) return;
    const t = window.setTimeout(() => {
      saveRigToIDB(serializeToPersistedState(rig, true));
    }, 400);
    return () => window.clearTimeout(t);
  }, [rig]);

  const updateRig = useCallback(
    (updater: (prev: PuppetRigState) => PuppetRigState, recordUndo = false) => {
      setRig((prev) => {
        const next = updater(prev);
        if (recordUndo && next !== prev) {
          undoStackRef.current.push(prev);
          if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
          redoStackRef.current = [];
          setUndoRedoVer((v) => v + 1);
        }
        return next;
      });
    },
    [],
  );

  const undo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    setRig((current) => {
      redoStackRef.current.push(current);
      return prev;
    });
    setUndoRedoVer((v) => v + 1);
    setStatusMessage("Undone");
  }, []);

  const redo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    setRig((current) => {
      undoStackRef.current.push(current);
      return next;
    });
    setUndoRedoVer((v) => v + 1);
    setStatusMessage("Redone");
  }, []);

  const setPartImage = useCallback(
    (slot: PuppetPartSlot, dataUrl: string, fileName: string) => {
      updateRig(
        (prev) => ({
          ...prev,
          partDataUrls: { ...prev.partDataUrls, [slot]: dataUrl },
          partFileNames: { ...prev.partFileNames, [slot]: fileName },
          partEnabled: { ...prev.partEnabled, [slot]: true },
        }),
        true,
      );
      setStatusMessage(`Updated ${SLOT_META_BY_ID[slot].title}`);
    },
    [updateRig],
  );

  const copyPartImage = useCallback(
    (fromSlot: PuppetPartSlot, toSlot: PuppetPartSlot) => {
      updateRig((prev) => {
        const srcUrl = prev.partDataUrls[fromSlot];
        if (!srcUrl) return prev;
        const srcName = prev.partFileNames[fromSlot] || SLOT_META_BY_ID[fromSlot].title;
        return {
          ...prev,
          partDataUrls: { ...prev.partDataUrls, [toSlot]: srcUrl },
          partFileNames: { ...prev.partFileNames, [toSlot]: `${srcName} (Copy)` },
          partEnabled: { ...prev.partEnabled, [toSlot]: true },
        };
      }, true);
      setStatusMessage(
        `Copied ${SLOT_META_BY_ID[fromSlot].title} → ${SLOT_META_BY_ID[toSlot].title}`,
      );
    },
    [updateRig],
  );

  const clearPartImage = useCallback(
    (slot: PuppetPartSlot) => {
      updateRig((prev) => {
        const nextUrls = { ...prev.partDataUrls };
        const nextNames = { ...prev.partFileNames };
        delete nextUrls[slot];
        delete nextNames[slot];
        return {
          ...prev,
          partDataUrls: nextUrls,
          partFileNames: nextNames,
          partEnabled: { ...prev.partEnabled, [slot]: false },
        };
      }, true);
      setStatusMessage(`Cleared ${SLOT_META_BY_ID[slot].title}`);
    },
    [updateRig],
  );

  const updatePin = useCallback(
    (slot: PuppetPartSlot, pinId: string, x: number, y: number, recordUndo = false) => {
      const cx = Math.max(0.02, Math.min(0.98, x));
      const cy = Math.max(0.02, Math.min(0.98, y));
      updateRig((prev) => {
        const list = prev.pinsBySlot[slot];
        if (!list) return prev;
        return {
          ...prev,
          pinsBySlot: {
            ...prev.pinsBySlot,
            [slot]: list.map((p) => (p.id === pinId ? { ...p, x: cx, y: cy } : p)),
          },
        };
      }, recordUndo);
    },
    [updateRig],
  );

  const resetSinglePin = useCallback(
    (slot: PuppetPartSlot, pinId: string) => {
      const def = defaultPins()[slot]?.find((p) => p.id === pinId);
      if (!def) return;
      updatePin(slot, pinId, def.x, def.y, true);
      setStatusMessage(`Reset ${def.name} pin`);
    },
    [updatePin],
  );

  const resetAllPins = useCallback(() => {
    updateRig(
      (prev) => ({
        ...prev,
        pinsBySlot: defaultPins(),
        stageOffsetX: 0,
        stageOffsetY: 0,
      }),
      true,
    );
    setStatusMessage("Reset all pins to defaults");
  }, [updateRig]);

  const moveLayerForward = useCallback(
    (slot: PuppetPartSlot) => {
      updateRig((prev) => {
        const idx = prev.layerStack.indexOf(slot);
        if (idx <= 0) return prev;
        const next = [...prev.layerStack];
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
        return { ...prev, layerStack: next };
      }, true);
    },
    [updateRig],
  );

  const moveLayerBackward = useCallback(
    (slot: PuppetPartSlot) => {
      updateRig((prev) => {
        const idx = prev.layerStack.indexOf(slot);
        if (idx < 0 || idx >= prev.layerStack.length - 1) return prev;
        const next = [...prev.layerStack];
        [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
        return { ...prev, layerStack: next };
      }, true);
    },
    [updateRig],
  );

  const resetToDemoHuman = useCallback(() => {
    updateRig(() => createDemoHumanState(), true);
    setStatusMessage("Loaded Demo Character");
  }, [updateRig]);

  const resetToBlankPuppet = useCallback(
    (name = "New Puppet") => {
      updateRig(() => createBlankPuppetState(name), true);
      setStatusMessage(`Created blank puppet "${name}"`);
    },
    [updateRig],
  );

  const exportCharacterPackage = useCallback(
    (includeImages = true) => {
      const persisted = serializeToPersistedState(rig, includeImages);
      const json = JSON.stringify(persisted, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const safeName = (rig.characterName || "character")
        .replace(/[^a-zA-Z0-9_\- ]/g, "")
        .trim() || "character";
      a.href = url;
      a.download = includeImages
        ? `${safeName}.puppet.json`
        : `${safeName}_rig_only.puppet.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatusMessage(`Exported ${a.download}`);
    },
    [rig],
  );

  const importCharacterFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const parsed = JSON.parse(text) as PuppetPersistedRigState;
      const baseName = file.name.replace(/\.puppet\.json$/i, "").replace(/\.json$/i, "");
      updateRig((prev) => {
        const next = deserializePersistedState(parsed, prev);
        if (!parsed.characterName) next.characterName = baseName;
        return next;
      }, true);
      setStatusMessage(`Loaded ${file.name}`);
    },
    [updateRig],
  );

  // Reference undoRedoVer so TypeScript keeps reactive flags fresh
  void undoRedoVer;

  return {
    rig,
    images: imagesRef.current,
    imageVersion,
    selectedCategory,
    setSelectedCategory,
    selectedSlot,
    setSelectedSlot,
    selectedPinId,
    setSelectedPinId,
    canUndo: undoStackRef.current.length > 0,
    canRedo: redoStackRef.current.length > 0,
    statusMessage,
    undo,
    redo,
    updateRig,
    setPartImage,
    copyPartImage,
    clearPartImage,
    updatePin,
    resetSinglePin,
    resetAllPins,
    moveLayerForward,
    moveLayerBackward,
    resetToDemoHuman,
    resetToBlankPuppet,
    exportCharacterPackage,
    importCharacterFile,
  };
}
