// Continuous pinch amount derived from MediaPipe Hand landmarks (21 points).
// Discrete gesture classification is now provided directly by MediaPipe's
// GestureRecognizer task (see useHandTracker.ts), so the old hand-rolled
// classifier was removed.

export type Landmark = { x: number; y: number; z: number; visibility?: number };

function dist(a: Landmark, b: Landmark) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

export function pinchAmount(lm: Landmark[]): number {
  if (!lm || lm.length < 21) return 0;
  const palmSize = dist(lm[0], lm[9]);
  const d = dist(lm[4], lm[8]) / Math.max(palmSize, 1e-6);
  // 0 = fully pinched, 1 = open
  return Math.max(0, Math.min(1, d / 1.2));
}
