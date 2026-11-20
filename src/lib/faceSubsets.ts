// Curated subsets of MediaPipe FaceLandmarker's 478 landmarks.
// Indices reference the canonical MediaPipe FaceMesh topology
// (https://github.com/google/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model_uv_visualization.png).
//
// Tier philosophy: each tier is a SUPERSET of the previous one's *meaning*,
// but indices are NOT preserved across tiers — index N in "essentials"
// is not the same point as index N in "detailed". Within a tier the
// indices are stable, so a Vuo patch can rely on "landmark 12 = upper lip
// center" as long as the tier doesn't change.

// ~50 essential points: face oval corners, eye corners, brow ends, nose, lip corners, irises.
const ESSENTIALS = [
  // Face oval (10): forehead center, temples, jaw corners, chin
  10, 338, 297, 332, 251, 389, 152, 162, 67, 109,
  // Right eye corners + lids (4)
  33, 133, 159, 145,
  // Left eye corners + lids (4)
  362, 263, 386, 374,
  // Right brow (3): inner, middle, outer
  55, 65, 70,
  // Left brow (3)
  285, 295, 300,
  // Nose (5): bridge top, bridge mid, tip, right ala, left ala
  6, 197, 1, 49, 279,
  // Lips (8): outer corners, upper top, upper mid-sides, lower bottom, lower mid-sides
  61, 291, 0, 37, 267, 17, 84, 314,
  // Irises (2): right center, left center
  468, 473,
  // Cheeks (2)
  234, 454,
  // Chin tip + jaw mids (3)
  175, 172, 397,
];

// ~120 curated points: full face oval, denser eye/brow contours, full lip outline, iris ring (5 pts each).
const CURATED = [
  // Face oval — full silhouette (36)
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397,
  365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58,
  132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
  // Right eye contour (8)
  33, 246, 161, 160, 159, 158, 157, 173,
  // Right eye lower (8)
  133, 155, 154, 153, 145, 144, 163, 7,
  // Left eye contour (8)
  362, 398, 384, 385, 386, 387, 388, 466,
  // Left eye lower (8)
  263, 249, 390, 373, 374, 380, 381, 382,
  // Right brow upper (5)
  70, 63, 105, 66, 107,
  // Left brow upper (5)
  336, 296, 334, 293, 300,
  // Nose bridge + tip + alae (9)
  168, 6, 197, 195, 5, 4, 1, 49, 279,
  // Outer lip (12)
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 146,
  // Inner lip (8)
  78, 81, 82, 13, 312, 311, 308, 14,
  // Right iris ring (5): center + 4 cardinal
  468, 469, 470, 471, 472,
  // Left iris ring (5)
  473, 474, 475, 476, 477,
];

// ~250 detailed: curated set plus secondary contours, full eye double-rings,
// nostril detail, and inner lip second ring.
const DETAILED = (() => {
  const set = new Set<number>(CURATED);
  // Inner face oval (forehead + cheek band)
  for (const i of [9, 8, 168, 122, 351, 419, 196, 3, 248, 456, 281, 363, 360, 279, 358, 423, 391, 327, 326, 2, 97, 98, 64, 235, 31, 228, 229, 230, 231, 232, 233, 244, 245, 188, 174, 217, 209, 49]) set.add(i);
  // Eye double-ring (sockets)
  for (const i of [225, 224, 223, 222, 221, 189, 190, 56, 28, 27, 29, 30, 247, 226, 113, 247, 130, 247, 247, 35, 143, 111, 117, 118, 119, 120, 121, 128, 245, 193, 217, 174]) set.add(i);
  for (const i of [445, 444, 443, 442, 441, 413, 414, 286, 258, 257, 259, 260, 467, 446, 342, 446, 359, 446, 446, 265, 372, 340, 346, 347, 348, 349, 350, 357, 465, 417, 437, 399]) set.add(i);
  // Lip second ring
  for (const i of [76, 77, 90, 180, 85, 16, 315, 404, 320, 307, 306, 408, 304, 303, 302, 11, 72, 73, 74, 184]) set.add(i);
  // Nose detail
  for (const i of [240, 99, 60, 75, 220, 305, 290, 460, 328, 326, 327, 294, 278]) set.add(i);
  return Array.from(set).sort((a, b) => a - b);
})();

const ALL = Array.from({ length: 478 }, (_, i) => i);

export type FaceTier = "off" | "essentials" | "curated" | "detailed" | "all";

export const FACE_TIERS: Record<FaceTier, number[]> = {
  off: [],
  essentials: ESSENTIALS,
  curated: CURATED,
  detailed: DETAILED,
  all: ALL,
};

export function faceTierLabel(t: FaceTier): string {
  const n = FACE_TIERS[t].length;
  switch (t) {
    case "off": return "Off";
    case "essentials": return `Essentials (~${n})`;
    case "curated": return `Curated (~${n})`;
    case "detailed": return `Detailed (~${n})`;
    case "all": return `All (${n})`;
  }
}