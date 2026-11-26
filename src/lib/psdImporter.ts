import {
  ALL_PUPPET_SLOTS,
  defaultLayerStack,
  defaultPins,
  type PuppetControlPin,
  type PuppetPartSlot,
  type PuppetRigState,
} from "@/lib/puppetModel";

export interface PSDLayer {
  id: string;
  name: string;
  orderIndex: number; // 0 = bottommost in PSD, higher = closer to front
  visible: boolean;
  opacity: number;
  /** Exact trimmed bounding box in full PSD canvas pixel coordinates (top-left origin) */
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
  /** Straight RGBA pixels matching width*height*4 */
  rgba: Uint8ClampedArray;
  suggestedSlot: PuppetPartSlot | null;
}

export interface ParsedPSD {
  fileName: string;
  canvasWidth: number;
  canvasHeight: number;
  layers: PSDLayer[]; // ordered front-to-back for UI display
}

interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function midX(f: FrameRect): number {
  return f.x + f.w * 0.5;
}
function midY(f: FrameRect): number {
  return f.y + f.h * 0.5;
}
function maxX(f: FrameRect): number {
  return f.x + f.w;
}
function maxY(f: FrameRect): number {
  return f.y + f.h;
}

function unionRect(a: FrameRect, b: FrameRect): FrameRect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(maxX(a), maxX(b));
  const y1 = Math.max(maxY(a), maxY(b));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

function readAscii(view: DataView, offset: number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

function decodeUTF16BE(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = (bytes[i] << 8) | bytes[i + 1];
    if (code === 0) break;
    s += String.fromCharCode(code);
  }
  return s;
}

function decodeLayerPascalName(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

/** Exact port of PSDImporter.swift decompressPackBits */
function decompressPackBits(rleData: Uint8Array, expectedBytes: number): Uint8Array {
  const out = new Uint8Array(expectedBytes);
  let i = 0;
  let outPos = 0;
  const count = rleData.length;
  while (i < count && outPos < expectedBytes) {
    const raw = rleData[i];
    const b = raw > 127 ? raw - 256 : raw;
    i += 1;
    if (b >= 0) {
      const n = b + 1;
      const end = Math.min(i + n, count);
      for (let k = i; k < end && outPos < expectedBytes; k++) {
        out[outPos++] = rleData[k];
      }
      i += n;
    } else if (b > -128) {
      const n = 1 - b;
      if (i < count) {
        const val = rleData[i++];
        for (let k = 0; k < n && outPos < expectedBytes; k++) {
          out[outPos++] = val;
        }
      }
    }
  }
  return out;
}

/**
 * Exact port of PSDImporter.swift matchSlot(for:frame:bodyMidX:).
 * Screen-left (`midX < bodyMidX`) maps to `left*` and screen-right (`midX >= bodyMidX`) maps to `right*`,
 * overriding artist anatomical naming ("Oikea" in Finnish art is character's right = screen-left!).
 */
export function matchSlotForLayer(
  layerName: string,
  frame: FrameRect,
  bodyMidXVal: number,
): PuppetPartSlot | null {
  const lower = layerName.toLowerCase().trim();

  if (
    lower.includes("background") ||
    lower.includes("tausta") ||
    lower.includes("layer group") ||
    lower.includes("ryhmä")
  ) {
    return null;
  }
  if (
    lower === "kädet" ||
    lower === "jalat" ||
    (lower === "pää" && layerName.includes("/"))
  ) {
    return null;
  }

  const isScreenRight: boolean =
    frame.w > 0 && bodyMidXVal > 0
      ? midX(frame) >= bodyMidXVal
      : lower.includes("vasen") ||
        lower.includes("vaaen") ||
        lower.includes("right") ||
        lower.endsWith("_r") ||
        lower.endsWith("-r");

  // Ears composite into Head
  if (lower.includes("korva") || lower.includes("ear")) {
    return "head";
  }

  // Eyebrows
  if (lower.includes("kulmakarva") || lower.includes("kulma") || lower.includes("brow")) {
    return isScreenRight ? "rightBrows" : "browsOverlay";
  }

  // Eyes (Open vs Closed)
  if (lower.includes("silmä") || lower.includes("silma") || lower.includes("eye")) {
    const isClosed =
      lower.includes("kiinni") ||
      lower.includes("close") ||
      lower.includes("blink") ||
      lower.includes("wink") ||
      lower.includes("closed");
    if (isClosed) {
      return isScreenRight ? "rightEyeClosed" : "eyesClosed";
    }
    return isScreenRight ? "rightEyeOpen" : "eyesOpen";
  }

  // Mouth Visemes
  if (lower.includes("suu") || lower.includes("mouth") || lower.includes("viseme")) {
    if (
      lower.includes("neutraali") ||
      lower.includes("neutral") ||
      lower.includes("closed") ||
      lower.includes("norm")
    ) {
      return "mouthNeutral";
    }
    if (
      lower.includes("iloinen") ||
      lower.includes("smile") ||
      lower.includes("happy") ||
      lower.includes("hymy") ||
      lower.includes("ee")
    ) {
      return "mouthSmile";
    }
    if (
      lower.includes("hämmästynyt") ||
      lower.includes("hammastynyt") ||
      lower.includes("surprised") ||
      lower.includes("ah") ||
      lower.includes("auki") ||
      lower.includes("open")
    ) {
      return "mouthAh";
    }
    if (
      lower.includes("pyöreä") ||
      lower.includes("pyorea") ||
      lower.includes("round") ||
      lower.includes("oh") ||
      lower.includes("ooo")
    ) {
      return "mouthOh";
    }
    return "mouthNeutral";
  }

  // Nose
  if (lower.includes("nenä") || lower.includes("nena") || lower.includes("nose")) {
    return "noseOverlay";
  }

  // Head
  if (lower.includes("pää") || lower.includes("paa") || lower.includes("head")) {
    return "head";
  }

  // Torso / Body
  if (
    lower.includes("vartalo") ||
    lower.includes("torso") ||
    lower.includes("body") ||
    lower.includes("chest") ||
    lower.includes("ruumis")
  ) {
    return "torso";
  }

  // Pelvis / Hips
  if (
    lower.includes("lantio") ||
    lower.includes("pelvis") ||
    lower.includes("hips") ||
    lower.includes("waist")
  ) {
    return "pelvis";
  }

  // Tail
  if (lower.includes("häntä") || lower.includes("hanta") || lower.includes("tail")) {
    return "tail";
  }

  // Upper Arms
  if (
    lower.includes("olkavarsi") ||
    lower.includes("upperarm") ||
    lower.includes("upper arm") ||
    lower.includes("bicep") ||
    lower.includes("upper_arm")
  ) {
    return isScreenRight ? "rightUpperArm" : "leftUpperArm";
  }

  // Forearms
  if (
    lower.includes("kyynärvarsi") ||
    lower.includes("kyynarvarsi") ||
    lower.includes("forearm") ||
    lower.includes("lowerarm") ||
    lower.includes("lower arm") ||
    lower.includes("lower_arm")
  ) {
    return isScreenRight ? "rightForearm" : "leftForearm";
  }

  // Back of Hands ("Kämmenselkä" / "Hand back")
  if (
    lower.includes("kämmenselkä") ||
    lower.includes("kammenselka") ||
    lower.includes("hand_back") ||
    lower.includes("hand back") ||
    lower.includes("back of hand") ||
    lower.includes("backhand") ||
    lower.includes("dorsal")
  ) {
    return isScreenRight ? "rightHandBack" : "leftHandBack";
  }

  // Hands & Palms
  if (
    lower.includes("kämmen") ||
    lower.includes("kammen") ||
    lower.includes("käsi") ||
    lower.includes("kasi") ||
    lower.includes("hand") ||
    lower.includes("palm") ||
    lower.includes("fist") ||
    lower.includes("claw")
  ) {
    return isScreenRight ? "rightHand" : "leftHand";
  }

  // Thighs / Upper Legs
  if (
    lower.includes("reisi") ||
    lower.includes("thigh") ||
    lower.includes("upperleg") ||
    lower.includes("upper leg") ||
    lower.includes("upper_leg")
  ) {
    return isScreenRight ? "rightThigh" : "leftThigh";
  }

  // Shins / Lower Legs
  if (
    lower.includes("sääri") ||
    lower.includes("saari") ||
    lower.includes("shin") ||
    lower.includes("lowerleg") ||
    lower.includes("lower leg") ||
    lower.includes("lower_leg")
  ) {
    return isScreenRight ? "rightShin" : "leftShin";
  }

  // Feet / Shoes / Paws
  if (
    lower.includes("jalkaterä") ||
    lower.includes("jalkatera") ||
    lower.includes("foot") ||
    lower.includes("shoe") ||
    lower.includes("boot") ||
    lower.includes("tassu") ||
    lower.includes("paw")
  ) {
    return isScreenRight ? "rightFoot" : "leftFoot";
  }

  return null;
}

export function parsePSD(buffer: ArrayBuffer, fileName: string): ParsedPSD {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  if (buffer.byteLength < 26 || readAscii(view, 0, 4) !== "8BPS") {
    throw new Error("Not a valid Photoshop (.psd) file.");
  }
  const version = view.getUint16(4, false);
  if (version !== 1) {
    throw new Error("Only standard PSD (v1) files are supported (not PSB).");
  }
  const canvasHeight = view.getUint32(14, false);
  const canvasWidth = view.getUint32(18, false);
  const depth = view.getUint16(22, false);
  const colorMode = view.getUint16(24, false);
  if (depth !== 8 || (colorMode !== 3 && colorMode !== 1)) {
    throw new Error("Only 8-bit RGB Photoshop (.psd) documents are supported.");
  }

  let offset = 26;
  offset += 4 + view.getUint32(offset, false); // Color Mode Data
  offset += 4 + view.getUint32(offset, false); // Image Resources

  const layerMaskLen = view.getUint32(offset, false);
  offset += 4;
  if (layerMaskLen === 0) throw new Error("This PSD contains no layers.");

  const layerInfoLen = view.getUint32(offset, false);
  offset += 4;
  if (layerInfoLen === 0) throw new Error("This PSD layer info section is empty.");

  const layerCount = Math.abs(view.getInt16(offset, false));
  offset += 2;

  interface RawLayerRecord {
    top: number;
    left: number;
    bottom: number;
    right: number;
    channels: { id: number; dataLen: number }[];
    opacity: number;
    visible: boolean;
    name: string;
    isFolderMarker: boolean;
  }

  const records: RawLayerRecord[] = [];
  for (let i = 0; i < layerCount; i++) {
    if (offset + 16 > bytes.length) break;
    const top = view.getInt32(offset, false);
    const left = view.getInt32(offset + 4, false);
    const bottom = view.getInt32(offset + 8, false);
    const right = view.getInt32(offset + 12, false);
    offset += 16;

    const numChannels = view.getUint16(offset, false);
    offset += 2;
    const channels: { id: number; dataLen: number }[] = [];
    for (let c = 0; c < numChannels; c++) {
      const id = view.getInt16(offset, false);
      const dataLen = view.getUint32(offset + 2, false);
      offset += 6;
      channels.push({ id, dataLen });
    }

    offset += 8; // 8BIM + blend mode key
    const opacity = view.getUint8(offset) / 255;
    const flags = view.getUint8(offset + 2);
    const visible = (flags & 0x02) === 0;
    offset += 4;

    const extraLen = view.getUint32(offset, false);
    offset += 4;
    const extraEnd = offset + extraLen;

    if (offset + 4 <= extraEnd) {
      offset += 4 + view.getUint32(offset, false); // mask
    }
    if (offset + 4 <= extraEnd) {
      offset += 4 + view.getUint32(offset, false); // blending ranges
    }

    let layerName = `Layer ${i + 1}`;
    if (offset < extraEnd) {
      const nameLen = view.getUint8(offset);
      if (offset + 1 + nameLen <= bytes.length) {
        layerName = decodeLayerPascalName(bytes.subarray(offset + 1, offset + 1 + nameLen));
      }
      const paddedNameLen = Math.ceil((nameLen + 1) / 4) * 4;
      offset += paddedNameLen;
    }

    let isFolderMarker = false;
    while (offset + 12 <= extraEnd) {
      const sig = readAscii(view, offset, 4);
      if (sig !== "8BIM" && sig !== "8B64") break;
      const key = readAscii(view, offset + 4, 4);
      const blockLen = view.getUint32(offset + 8, false);
      const blockStart = offset + 12;
      if (key === "luni" && blockLen >= 4) {
        const charCount = view.getUint32(blockStart, false);
        const u16 = bytes.subarray(blockStart + 4, blockStart + 4 + charCount * 2);
        const decoded = decodeUTF16BE(u16).trim();
        if (decoded) layerName = decoded;
      } else if (key === "lsct" || key === "lsdk") {
        if (blockLen >= 4) {
          const dividerType = view.getUint32(blockStart, false);
          if (dividerType === 1 || dividerType === 2 || dividerType === 3) {
            isFolderMarker = true;
          }
        }
      }
      offset = blockStart + ((blockLen + 1) & ~1);
    }

    offset = extraEnd;
    records.push({
      top,
      left,
      bottom,
      right,
      channels,
      opacity,
      visible,
      name: layerName,
      isFolderMarker,
    });
  }

  const extracted: PSDLayer[] = [];
  for (let zIdx = 0; zIdx < records.length; zIdx++) {
    const rec = records[zIdx];
    const w = rec.right - rec.left;
    const h = rec.bottom - rec.top;
    if (w <= 0 || h <= 0) {
      for (const ch of rec.channels) offset += ch.dataLen;
      continue;
    }

    const chanData = new Map<number, Uint8Array>();
    for (const ch of rec.channels) {
      const chStart = offset;
      const chEnd = chStart + ch.dataLen;
      if (ch.dataLen >= 2 && chEnd <= bytes.length) {
        const comp = view.getUint16(chStart, false);
        const payload = bytes.subarray(chStart + 2, chEnd);
        if (comp === 0) {
          chanData.set(ch.id, payload);
        } else if (comp === 1) {
          const scanlineHeader = h * 2;
          if (payload.length >= scanlineHeader) {
            chanData.set(
              ch.id,
              decompressPackBits(payload.subarray(scanlineHeader), w * h),
            );
          }
        }
      }
      offset = chEnd;
    }

    if (rec.isFolderMarker) continue;
    const lowerName = rec.name.toLowerCase().trim();
    if (lowerName === "background" || lowerName === "tausta") continue;

    const rCh = chanData.get(0);
    const gCh = colorMode === 1 ? rCh : chanData.get(1);
    const bCh = colorMode === 1 ? rCh : chanData.get(2);
    const aCh = chanData.get(-1);
    if (!rCh || !gCh || !bCh || rCh.length < w * h) continue;

    // Trim transparent borders (ignore stray alpha <= 8 brush haze, matching PSDImporter.swift)
    let minX = w, maxXVal = -1, minY = h, maxYVal = -1;
    for (let y = 0; y < h; y++) {
      const rowStart = y * w;
      for (let x = 0; x < w; x++) {
        const a = aCh ? aCh[rowStart + x] : 255;
        if (a > 8) {
          if (x < minX) minX = x;
          if (x > maxXVal) maxXVal = x;
          if (y < minY) minY = y;
          if (y > maxYVal) maxYVal = y;
        }
      }
    }
    if (maxXVal < minX || maxYVal < minY) continue;

    const trimW = maxXVal - minX + 1;
    const trimH = maxYVal - minY + 1;
    const rgba = new Uint8ClampedArray(trimW * trimH * 4);
    for (let y = 0; y < trimH; y++) {
      const srcRow = (y + minY) * w;
      for (let x = 0; x < trimW; x++) {
        const srcIdx = srcRow + (x + minX);
        const dstIdx = (y * trimW + x) * 4;
        const rawA = aCh && srcIdx < aCh.length ? aCh[srcIdx] : 255;
        const cleanA = rawA <= 6 ? 0 : rawA;
        rgba[dstIdx] = cleanA > 0 ? rCh[srcIdx] : 0;
        rgba[dstIdx + 1] = cleanA > 0 ? gCh[srcIdx] : 0;
        rgba[dstIdx + 2] = cleanA > 0 ? bCh[srcIdx] : 0;
        rgba[dstIdx + 3] = cleanA;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = trimW;
    canvas.height = trimH;
    canvas.getContext("2d")!.putImageData(new ImageData(rgba, trimW, trimH), 0, 0);

    extracted.push({
      id: `psd_${zIdx}_${rec.name}`,
      name: rec.name,
      orderIndex: zIdx,
      visible: rec.visible,
      opacity: rec.opacity,
      x: rec.left + minX,
      y: rec.top + minY,
      width: trimW,
      height: trimH,
      dataUrl: canvas.toDataURL("image/png"),
      rgba,
      suggestedSlot: null,
    });
  }

  // Determine character horizontal midline from Vartalo/Torso or Pää/Head (exact match to PSDImporter.swift)
  let bodyMidXVal = canvasWidth * 0.5;
  const torsoLayer = extracted.find((l) => {
    const n = l.name.toLowerCase().trim();
    return n === "vartalo" || n === "torso" || n === "body" || n === "ruumis";
  });
  if (torsoLayer) {
    bodyMidXVal = torsoLayer.x + torsoLayer.width * 0.5;
  } else {
    const headLayer = extracted.find((l) => {
      const n = l.name.toLowerCase().trim();
      return (n === "pää" || n === "paa" || n === "head") && !l.name.includes("/");
    });
    if (headLayer) {
      bodyMidXVal = headLayer.x + headLayer.width * 0.5;
    }
  }

  for (const layer of extracted) {
    layer.suggestedSlot = matchSlotForLayer(
      layer.name,
      { x: layer.x, y: layer.y, w: layer.width, h: layer.height },
      bodyMidXVal,
    );
  }

  // Return front-to-back for intuitive UI listing
  const frontToBack = [...extracted].reverse();
  return {
    fileName,
    canvasWidth,
    canvasHeight,
    layers: frontToBack,
  };
}

// ── Exact 1:1 Port of PSDParser.assemblePuppet (Compositing, Opaque Overlap Pins & Scales) ──

interface CompositeBuffer {
  frame: FrameRect;
  rgba: Uint8ClampedArray;
  dataUrl: string;
}

function layerFrame(l: PSDLayer): FrameRect {
  return { x: l.x, y: l.y, w: l.width, h: l.height };
}

function makeCanvasFromRgba(rgba: Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  return c;
}

function compositeLayers(layers: PSDLayer[]): CompositeBuffer | null {
  if (layers.length === 0) return null;
  const sorted = [...layers].sort((a, b) => a.orderIndex - b.orderIndex);
  if (sorted.length === 1) {
    const l = sorted[0];
    return { frame: layerFrame(l), rgba: l.rgba, dataUrl: l.dataUrl };
  }
  let u = layerFrame(sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    u = unionRect(u, layerFrame(sorted[i]));
  }
  const w = Math.max(1, Math.round(u.w));
  const h = Math.max(1, Math.round(u.h));
  const ux = Math.round(u.x);
  const uy = Math.round(u.y);

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  for (const l of sorted) {
    ctx.globalAlpha = l.opacity;
    ctx.drawImage(
      makeCanvasFromRgba(l.rgba, l.width, l.height),
      Math.round(l.x) - ux,
      Math.round(l.y) - uy,
    );
  }
  ctx.globalAlpha = 1;
  const imgData = ctx.getImageData(0, 0, w, h);
  return {
    frame: { x: ux, y: uy, w, h },
    rgba: imgData.data,
    dataUrl: c.toDataURL("image/png"),
  };
}

function renderAlignedToRect(layer: PSDLayer, target: FrameRect): CompositeBuffer {
  const w = Math.max(1, Math.round(target.w));
  const h = Math.max(1, Math.round(target.h));
  const tx = Math.round(target.x);
  const ty = Math.round(target.y);
  const lx = Math.round(layer.x) - tx;
  const ly = Math.round(layer.y) - ty;
  if (w === layer.width && h === layer.height && lx === 0 && ly === 0) {
    return { frame: { x: tx, y: ty, w, h }, rgba: layer.rgba, dataUrl: layer.dataUrl };
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(makeCanvasFromRgba(layer.rgba, layer.width, layer.height), lx, ly);
  const imgData = ctx.getImageData(0, 0, w, h);
  return {
    frame: { x: tx, y: ty, w, h },
    rgba: imgData.data,
    dataUrl: c.toDataURL("image/png"),
  };
}

/** Weighted centroid of overlapping opaque pixels (alpha > 48 in both buffers) */
function opaqueOverlapCentroid(
  a: CompositeBuffer,
  b: CompositeBuffer,
): { x: number; y: number } | null {
  const x0 = Math.max(Math.round(a.frame.x), Math.round(b.frame.x));
  const y0 = Math.max(Math.round(a.frame.y), Math.round(b.frame.y));
  const x1 = Math.min(Math.round(maxX(a.frame)), Math.round(maxX(b.frame)));
  const y1 = Math.min(Math.round(maxY(a.frame)), Math.round(maxY(b.frame)));
  if (x1 <= x0 || y1 <= y0) return null;

  const ax0 = Math.round(a.frame.x);
  const ay0 = Math.round(a.frame.y);
  const aw = Math.round(a.frame.w);
  const bx0 = Math.round(b.frame.x);
  const by0 = Math.round(b.frame.y);
  const bw = Math.round(b.frame.w);

  let sumX = 0;
  let sumY = 0;
  let weightSum = 0;

  for (let y = y0; y < y1; y++) {
    const ay = y - ay0;
    const by = y - by0;
    for (let x = x0; x < x1; x++) {
      const ax = x - ax0;
      const bx = x - bx0;
      const aIdx = (ay * aw + ax) * 4 + 3;
      const bIdx = (by * bw + bx) * 4 + 3;
      const aa = a.rgba[aIdx] ?? 0;
      const ab = b.rgba[bIdx] ?? 0;
      if (aa > 48 && ab > 48) {
        const w = Math.min(aa, ab);
        sumX += x * w;
        sumY += y * w;
        weightSum += w;
      }
    }
  }
  if (weightSum <= 0) return null;
  return { x: sumX / weightSum, y: sumY / weightSum };
}

function farthestOpaquePoint(
  buf: CompositeBuffer,
  origin: { x: number; y: number },
): { x: number; y: number } {
  const w = Math.round(buf.frame.w);
  const h = Math.round(buf.frame.h);
  const ox = Math.round(buf.frame.x);
  const oy = Math.round(buf.frame.y);
  let bestDist = -1;
  let bestPt = { x: midX(buf.frame), y: midY(buf.frame) };
  const step = Math.max(1, Math.floor(Math.min(w, h) / 64));

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const a = buf.rgba[(y * w + x) * 4 + 3] ?? 0;
      if (a <= 96) continue;
      const cx = ox + x;
      const cy = oy + y;
      const d = Math.hypot(cx - origin.x, cy - origin.y);
      if (d > bestDist) {
        bestDist = d;
        bestPt = { x: cx, y: cy };
      }
    }
  }
  return bestPt;
}

function relUV(
  pt: { x: number; y: number },
  frame: FrameRect,
  lo = 0.04,
  hi = 0.96,
): { x: number; y: number } {
  const u = Math.max(lo, Math.min(hi, (pt.x - frame.x) / Math.max(1, frame.w)));
  const v = Math.max(lo, Math.min(hi, (pt.y - frame.y) / Math.max(1, frame.h)));
  return { x: u, y: v };
}

export function applyPSDLayersToRig(
  prevRig: PuppetRigState,
  psd: ParsedPSD,
  slotsByLayerId: Record<string, PuppetPartSlot[]>,
  enabledByLayerId: Record<string, boolean>,
  clearUnmappedSlots: boolean,
): PuppetRigState {
  // Sort ascending by PSD orderIndex (0 = backmost, higher = frontmost) matching PSDImporter.swift
  const orderedLayers = [...psd.layers].sort((a, b) => a.orderIndex - b.orderIndex);
  const layersBySlot = new Map<PuppetPartSlot, PSDLayer[]>();

  for (const l of orderedLayers) {
    if (!enabledByLayerId[l.id]) continue;
    const assigned = slotsByLayerId[l.id] ?? [];
    for (const slot of assigned) {
      const list = layersBySlot.get(slot) ?? [];
      list.push(l);
      layersBySlot.set(slot, list);
    }
  }

  // 1. Build composited/aligned image buffers per slot
  const buffers = new Map<PuppetPartSlot, CompositeBuffer>();

  // Head composites all layers mapped to .head (e.g. Korva Oikea + Korva Vasen + Pää) in PSD z-order
  const headLayers = layersBySlot.get("head");
  if (headLayers && headLayers.length > 0) {
    const hb = compositeLayers(headLayers);
    if (hb) buffers.set("head", hb);
  }

  // Align mouth viseme sprites onto a shared union canvas rect
  const mouthSlots: PuppetPartSlot[] = ["mouthNeutral", "mouthSmile", "mouthAh", "mouthOh"];
  const mouthLayers = mouthSlots
    .map((s) => {
      const arr = layersBySlot.get(s);
      return arr && arr.length > 0 ? arr[arr.length - 1] : null;
    })
    .filter((x): x is PSDLayer => x !== null);
  if (mouthLayers.length > 0) {
    let mUnion = layerFrame(mouthLayers[0]);
    for (let i = 1; i < mouthLayers.length; i++) {
      mUnion = unionRect(mUnion, layerFrame(mouthLayers[i]));
    }
    for (const s of mouthSlots) {
      const arr = layersBySlot.get(s);
      const last = arr && arr.length > 0 ? arr[arr.length - 1] : null;
      if (last) buffers.set(s, renderAlignedToRect(last, mUnion));
    }
  }

  // Align open/closed eye pairs onto shared union rects per side
  for (const eyePair of [
    ["eyesOpen", "eyesClosed"] as PuppetPartSlot[],
    ["rightEyeOpen", "rightEyeClosed"] as PuppetPartSlot[],
  ]) {
    const pairLayers = eyePair
      .map((s) => {
        const arr = layersBySlot.get(s);
        return arr && arr.length > 0 ? arr[arr.length - 1] : null;
      })
      .filter((x): x is PSDLayer => x !== null);
    if (pairLayers.length > 0) {
      let eUnion = layerFrame(pairLayers[0]);
      for (let i = 1; i < pairLayers.length; i++) {
        eUnion = unionRect(eUnion, layerFrame(pairLayers[i]));
      }
      for (const s of eyePair) {
        const arr = layersBySlot.get(s);
        const last = arr && arr.length > 0 ? arr[arr.length - 1] : null;
        if (last) buffers.set(s, renderAlignedToRect(last, eUnion));
      }
    }
  }

  // Remaining slots (composite if multiple layers assigned to same slot)
  for (const [slot, list] of layersBySlot.entries()) {
    if (buffers.has(slot)) continue;
    const comp = compositeLayers(list);
    if (comp) buffers.set(slot, comp);
  }

  const nextUrls: Partial<Record<PuppetPartSlot, string>> = clearUnmappedSlots
    ? {}
    : { ...prevRig.partDataUrls };
  const nextNames: Partial<Record<PuppetPartSlot, string>> = clearUnmappedSlots
    ? {}
    : { ...prevRig.partFileNames };
  const nextEnabled: Record<PuppetPartSlot, boolean> = { ...prevRig.partEnabled };
  if (clearUnmappedSlots) {
    for (const s of ALL_PUPPET_SLOTS) nextEnabled[s] = false;
  }

  const nextWidthScale: Partial<Record<PuppetPartSlot, number>> = {};
  const nextHeightScale: Partial<Record<PuppetPartSlot, number>> = {};
  const nextRotOffset: Partial<Record<PuppetPartSlot, number>> = {};
  const nextFlipH: Partial<Record<PuppetPartSlot, boolean>> = {};
  const nextFlipV: Partial<Record<PuppetPartSlot, boolean>> = {};
  const nextOffsetX: Partial<Record<PuppetPartSlot, number>> = {};
  const nextOffsetY: Partial<Record<PuppetPartSlot, number>> = {};
  for (const s of ALL_PUPPET_SLOTS) {
    nextWidthScale[s] = 1.0;
    nextHeightScale[s] = 1.0;
    nextRotOffset[s] = 0.0;
    nextFlipH[s] = false;
    nextFlipV[s] = false;
    nextOffsetX[s] = 0.0;
    nextOffsetY[s] = 0.0;
  }

  for (const [slot, buf] of buffers.entries()) {
    const list = layersBySlot.get(slot);
    const label = ((list && list[list.length - 1]?.name) || slot) + ".png";
    nextUrls[slot] = buf.dataUrl;
    nextNames[slot] = label;
    nextEnabled[slot] = true;
  }

  // 2. Compute exact joint points on PSD canvas via opaque-pixel overlap
  const headBuf = buffers.get("head");
  const torsoBuf = buffers.get("torso");
  const pelvisBuf = buffers.get("pelvis");
  const tailBuf = buffers.get("tail");

  const neckCanvasPt =
    headBuf && torsoBuf
      ? opaqueOverlapCentroid(headBuf, torsoBuf) ?? {
          x: midX(headBuf.frame),
          y: torsoBuf.frame.y,
        }
      : null;

  const computeArmJoints = (
    upper: PuppetPartSlot,
    fore: PuppetPartSlot,
    hand: PuppetPartSlot,
  ) => {
    const uBuf = buffers.get(upper);
    const fBuf = buffers.get(fore);
    const hBuf = buffers.get(hand);

    const shoulder =
      torsoBuf && uBuf
        ? opaqueOverlapCentroid(torsoBuf, uBuf) ?? {
            x: midX(uBuf.frame),
            y: uBuf.frame.y + uBuf.frame.h * 0.16,
          }
        : uBuf
          ? { x: midX(uBuf.frame), y: uBuf.frame.y + uBuf.frame.h * 0.16 }
          : null;

    const elbow =
      uBuf && fBuf
        ? opaqueOverlapCentroid(uBuf, fBuf) ?? {
            x: midX(fBuf.frame),
            y: fBuf.frame.y + fBuf.frame.h * 0.16,
          }
        : uBuf
          ? { x: midX(uBuf.frame), y: maxY(uBuf.frame) - uBuf.frame.h * 0.16 }
          : null;

    const wrist =
      fBuf && hBuf
        ? opaqueOverlapCentroid(fBuf, hBuf) ?? {
            x: midX(hBuf.frame),
            y: hBuf.frame.y + hBuf.frame.h * 0.25,
          }
        : fBuf
          ? { x: midX(fBuf.frame), y: maxY(fBuf.frame) - fBuf.frame.h * 0.16 }
          : null;

    const fingerTip = hBuf && wrist ? farthestOpaquePoint(hBuf, wrist) : null;
    return { shoulder, elbow, wrist, fingerTip };
  };

  const computeLegJoints = (
    thigh: PuppetPartSlot,
    shin: PuppetPartSlot,
    foot: PuppetPartSlot,
  ) => {
    const tBuf = buffers.get(thigh);
    const sBuf = buffers.get(shin);
    const fBuf = buffers.get(foot);
    const hipOwner = pelvisBuf ?? torsoBuf;

    const hip =
      hipOwner && tBuf
        ? opaqueOverlapCentroid(hipOwner, tBuf) ?? {
            x: midX(tBuf.frame),
            y: tBuf.frame.y + tBuf.frame.h * 0.16,
          }
        : tBuf
          ? { x: midX(tBuf.frame), y: tBuf.frame.y + tBuf.frame.h * 0.16 }
          : null;

    const knee =
      tBuf && sBuf
        ? opaqueOverlapCentroid(tBuf, sBuf) ?? {
            x: midX(sBuf.frame),
            y: sBuf.frame.y + sBuf.frame.h * 0.16,
          }
        : tBuf
          ? { x: midX(tBuf.frame), y: maxY(tBuf.frame) - tBuf.frame.h * 0.16 }
          : null;

    const ankle =
      sBuf && fBuf
        ? opaqueOverlapCentroid(sBuf, fBuf) ?? {
            x: midX(fBuf.frame),
            y: fBuf.frame.y + fBuf.frame.h * 0.22,
          }
        : sBuf
          ? { x: midX(sBuf.frame), y: maxY(sBuf.frame) - sBuf.frame.h * 0.14 }
          : null;

    return { hip, knee, ankle };
  };

  const leftArmJ = computeArmJoints("leftUpperArm", "leftForearm", "leftHand");
  const rightArmJ = computeArmJoints("rightUpperArm", "rightForearm", "rightHand");
  const leftLegJ = computeLegJoints("leftThigh", "leftShin", "leftFoot");
  const rightLegJ = computeLegJoints("rightThigh", "rightShin", "rightFoot");

  const tailBasePt =
    torsoBuf && tailBuf
      ? opaqueOverlapCentroid(torsoBuf, tailBuf) ?? {
          x: maxX(tailBuf.frame) - tailBuf.frame.w * 0.2,
          y: tailBuf.frame.y + tailBuf.frame.h * 0.25,
        }
      : null;

  // 3. Populate Pins (exact match to PSDImporter.swift)
  const nextPins: Record<PuppetPartSlot, PuppetControlPin[]> = defaultPins();

  if (headBuf) {
    const lEyeBuf = buffers.get("eyesOpen") ?? buffers.get("eyesClosed");
    const rEyeBuf = buffers.get("rightEyeOpen") ?? buffers.get("rightEyeClosed");
    const lEyeUV = lEyeBuf
      ? relUV({ x: midX(lEyeBuf.frame), y: midY(lEyeBuf.frame) }, headBuf.frame)
      : { x: 0.35, y: 0.48 };
    const rEyeUV = rEyeBuf
      ? relUV({ x: midX(rEyeBuf.frame), y: midY(rEyeBuf.frame) }, headBuf.frame)
      : { x: 0.65, y: 0.48 };

    const lBrowBuf = buffers.get("browsOverlay");
    const rBrowBuf = buffers.get("rightBrows");
    const lBrowUV = lBrowBuf
      ? relUV({ x: midX(lBrowBuf.frame), y: midY(lBrowBuf.frame) }, headBuf.frame)
      : { x: lEyeUV.x, y: Math.max(0.1, lEyeUV.y - 0.14) };
    const rBrowUV = rBrowBuf
      ? relUV({ x: midX(rBrowBuf.frame), y: midY(rBrowBuf.frame) }, headBuf.frame)
      : { x: rEyeUV.x, y: Math.max(0.1, rEyeUV.y - 0.14) };

    const mouthBuf =
      buffers.get("mouthNeutral") ??
      buffers.get("mouthSmile") ??
      buffers.get("mouthAh") ??
      buffers.get("mouthOh");
    const mouthUV = mouthBuf
      ? relUV({ x: midX(mouthBuf.frame), y: midY(mouthBuf.frame) }, headBuf.frame)
      : { x: 0.5, y: 0.74 };

    const noseBuf = buffers.get("noseOverlay");
    const noseUV = noseBuf
      ? relUV({ x: midX(noseBuf.frame), y: midY(noseBuf.frame) }, headBuf.frame)
      : { x: (lEyeUV.x + rEyeUV.x) * 0.5, y: (lEyeUV.y + mouthUV.y) * 0.5 };
    const neckUV = neckCanvasPt
      ? relUV(neckCanvasPt, headBuf.frame)
      : { x: 0.5, y: 0.8 };

    nextPins.head = [
      { id: "neckPivot", name: "Head Base / Neck Joint", trackedSourceLabel: "Attaches to Torso Neck Mount", x: neckUV.x, y: neckUV.y },
      { id: "leftBrow", name: "Left Brow", trackedSourceLabel: "Face Left Eyebrow", x: lBrowUV.x, y: lBrowUV.y },
      { id: "rightBrow", name: "Right Brow", trackedSourceLabel: "Face Right Eyebrow", x: rBrowUV.x, y: rBrowUV.y },
      { id: "leftEye", name: "Left Eye", trackedSourceLabel: "Left Eye Sprite & Wink Anchor", x: lEyeUV.x, y: lEyeUV.y },
      { id: "rightEye", name: "Right Eye", trackedSourceLabel: "Right Eye Sprite & Wink Anchor", x: rEyeUV.x, y: rEyeUV.y },
      { id: "noseCenter", name: "Nose Tip", trackedSourceLabel: "Nose Layer & 2.5D Turn Center", x: noseUV.x, y: noseUV.y },
      { id: "mouthCenter", name: "Mouth Pin", trackedSourceLabel: "Mouth Viseme Sprite & Jaw Split", x: mouthUV.x, y: mouthUV.y },
      { id: "jawChin", name: "Lower Jaw / Chin", trackedSourceLabel: "Stretches Down When Mouth Opens", x: mouthUV.x, y: Math.min(0.96, mouthUV.y + 0.16) },
    ];
  }

  if (torsoBuf) {
    const neckMountUV = neckCanvasPt
      ? relUV(neckCanvasPt, torsoBuf.frame)
      : { x: 0.5, y: 0.12 };
    const lShUV = leftArmJ.shoulder
      ? relUV(leftArmJ.shoulder, torsoBuf.frame)
      : { x: 0.2, y: 0.34 };
    const rShUV = rightArmJ.shoulder
      ? relUV(rightArmJ.shoulder, torsoBuf.frame)
      : { x: 0.8, y: 0.34 };
    const waistUV = tailBasePt
      ? relUV(tailBasePt, torsoBuf.frame)
      : leftLegJ.hip
        ? { x: 0.5, y: relUV(leftLegJ.hip, torsoBuf.frame).y }
        : { x: 0.5, y: 0.85 };

    const torsoPins: PuppetControlPin[] = [
      { id: "neckMount", name: "Neck Top (Head Mount)", trackedSourceLabel: "Where Head Attaches", x: neckMountUV.x, y: neckMountUV.y },
      { id: "leftShoulder", name: "Left Shoulder", trackedSourceLabel: "Pose Left Shoulder / L Arm Mount", x: lShUV.x, y: lShUV.y },
      { id: "rightShoulder", name: "Right Shoulder", trackedSourceLabel: "Pose Right Shoulder / R Arm Mount", x: rShUV.x, y: rShUV.y },
      { id: "waistPivot", name: "Waist / Pelvis Mount", trackedSourceLabel: "Attaches to Pelvis / Tail", x: waistUV.x, y: waistUV.y },
    ];
    if (leftLegJ.hip && !pelvisBuf) {
      const lHipUV = relUV(leftLegJ.hip, torsoBuf.frame);
      torsoPins.push({ id: "leftHip", name: "Left Hip Mount", trackedSourceLabel: "L Leg Mount on Torso", x: lHipUV.x, y: lHipUV.y });
    }
    if (rightLegJ.hip && !pelvisBuf) {
      const rHipUV = relUV(rightLegJ.hip, torsoBuf.frame);
      torsoPins.push({ id: "rightHip", name: "Right Hip Mount", trackedSourceLabel: "R Leg Mount on Torso", x: rHipUV.x, y: rHipUV.y });
    }
    nextPins.torso = torsoPins;
  }

  if (pelvisBuf) {
    const waistJ = tailBasePt ?? {
      x: midX(pelvisBuf.frame),
      y: pelvisBuf.frame.y + pelvisBuf.frame.h * 0.2,
    };
    const lHipUV = leftLegJ.hip ? relUV(leftLegJ.hip, pelvisBuf.frame) : { x: 0.3, y: 0.72 };
    const rHipUV = rightLegJ.hip ? relUV(rightLegJ.hip, pelvisBuf.frame) : { x: 0.7, y: 0.72 };
    const wUV = relUV(waistJ, pelvisBuf.frame);
    nextPins.pelvis = [
      { id: "waistJoint", name: "Waist Joint", trackedSourceLabel: "Supports Torso Waist Pivot", x: wUV.x, y: wUV.y },
      { id: "leftHip", name: "Left Hip", trackedSourceLabel: "Pose Left Hip / L Leg Mount", x: lHipUV.x, y: lHipUV.y },
      { id: "rightHip", name: "Right Hip", trackedSourceLabel: "Pose Right Hip / R Leg Mount", x: rHipUV.x, y: rHipUV.y },
    ];
  }

  const assignSegmentPins = (
    slot: PuppetPartSlot,
    startId: string,
    startName: string,
    startPt: { x: number; y: number } | null,
    endId: string,
    endName: string,
    endPt: { x: number; y: number } | null,
  ) => {
    const buf = buffers.get(slot);
    if (!buf || !startPt || !endPt) return;
    const sUV = relUV(startPt, buf.frame);
    const eUV = relUV(endPt, buf.frame);
    nextPins[slot] = [
      { id: startId, name: startName, trackedSourceLabel: startName, x: sUV.x, y: sUV.y },
      { id: endId, name: endName, trackedSourceLabel: endName, x: eUV.x, y: eUV.y },
    ];
  };

  assignSegmentPins("leftUpperArm", "shoulderJoint", "Shoulder Joint", leftArmJ.shoulder, "elbowJoint", "Elbow Joint", leftArmJ.elbow);
  assignSegmentPins("rightUpperArm", "shoulderJoint", "Shoulder Joint", rightArmJ.shoulder, "elbowJoint", "Elbow Joint", rightArmJ.elbow);
  assignSegmentPins("leftForearm", "elbowJoint", "Elbow Joint", leftArmJ.elbow, "wristJoint", "Wrist Joint", leftArmJ.wrist);
  assignSegmentPins("rightForearm", "elbowJoint", "Elbow Joint", rightArmJ.elbow, "wristJoint", "Wrist Joint", rightArmJ.wrist);

  const assignHandPins = (
    slot: PuppetPartSlot,
    wristPt: { x: number; y: number } | null,
    tipPt: { x: number; y: number } | null,
    isLeftSide: boolean,
  ) => {
    const buf = buffers.get(slot);
    if (!buf || !wristPt) return;
    const wUV = relUV(wristPt, buf.frame);
    const kPt = tipPt ?? {
      x: midX(buf.frame),
      y: maxY(buf.frame) - buf.frame.h * 0.18,
    };
    const midPt = {
      x: wristPt.x + (kPt.x - wristPt.x) * 0.72,
      y: wristPt.y + (kPt.y - wristPt.y) * 0.72,
    };
    const kUV = relUV(midPt, buf.frame);
    const thumbUV = {
      x: isLeftSide ? Math.min(0.85, wUV.x + 0.18) : Math.max(0.15, wUV.x - 0.18),
      y: (wUV.y + kUV.y) * 0.5,
    };
    nextPins[slot] = [
      { id: "wristPivot", name: "Wrist Pivot", trackedSourceLabel: "Hand Wrist (Landmark 0)", x: wUV.x, y: wUV.y },
      { id: "middleKnuckle", name: "Finger Direction", trackedSourceLabel: "Middle MCP (Landmark 9)", x: kUV.x, y: kUV.y },
      { id: "thumbPin", name: "Thumb Direction", trackedSourceLabel: "Thumb Tip (Landmark 4)", x: thumbUV.x, y: thumbUV.y },
    ];
  };

  assignHandPins("leftHand", leftArmJ.wrist, leftArmJ.fingerTip, true);
  assignHandPins("rightHand", rightArmJ.wrist, rightArmJ.fingerTip, false);

  const lbBuf = buffers.get("leftHandBack");
  if (lbBuf) {
    const f = buffers.get("leftForearm");
    const lbWrist =
      (f && opaqueOverlapCentroid(f, lbBuf)) ||
      leftArmJ.wrist || { x: midX(lbBuf.frame), y: lbBuf.frame.y + lbBuf.frame.h * 0.25 };
    const lbTip = farthestOpaquePoint(lbBuf, lbWrist);
    assignHandPins("leftHandBack", lbWrist, lbTip, true);
  }
  const rbBuf = buffers.get("rightHandBack");
  if (rbBuf) {
    const f = buffers.get("rightForearm");
    const rbWrist =
      (f && opaqueOverlapCentroid(f, rbBuf)) ||
      rightArmJ.wrist || { x: midX(rbBuf.frame), y: rbBuf.frame.y + rbBuf.frame.h * 0.25 };
    const rbTip = farthestOpaquePoint(rbBuf, rbWrist);
    assignHandPins("rightHandBack", rbWrist, rbTip, false);
  }

  assignSegmentPins("leftThigh", "hipJoint", "Hip Joint", leftLegJ.hip, "kneeJoint", "Knee Joint", leftLegJ.knee);
  assignSegmentPins("rightThigh", "hipJoint", "Hip Joint", rightLegJ.hip, "kneeJoint", "Knee Joint", rightLegJ.knee);
  assignSegmentPins("leftShin", "kneeJoint", "Knee Joint", leftLegJ.knee, "ankleJoint", "Ankle Joint", leftLegJ.ankle);
  assignSegmentPins("rightShin", "kneeJoint", "Knee Joint", rightLegJ.knee, "ankleJoint", "Ankle Joint", rightLegJ.ankle);

  const assignFootPins = (
    slot: PuppetPartSlot,
    anklePt: { x: number; y: number } | null,
    isLeftSide: boolean,
  ) => {
    const buf = buffers.get(slot);
    if (!buf || !anklePt) return;
    const aUV = relUV(anklePt, buf.frame);
    nextPins[slot] = [
      { id: "ankleJoint", name: "Ankle Joint", trackedSourceLabel: "Attaches to Shin Ankle", x: aUV.x, y: aUV.y },
      { id: "toeTip", name: "Toe Tip", trackedSourceLabel: "Toe Tip / Ground Level", x: isLeftSide ? 0.2 : 0.8, y: 0.85 },
    ];
  };
  assignFootPins("leftFoot", leftLegJ.ankle, true);
  assignFootPins("rightFoot", rightLegJ.ankle, false);

  if (tailBuf) {
    const basePt = tailBasePt ?? {
      x: maxX(tailBuf.frame) - tailBuf.frame.w * 0.15,
      y: tailBuf.frame.y + tailBuf.frame.h * 0.25,
    };
    const tipPt = farthestOpaquePoint(tailBuf, basePt);
    const baseUV = relUV(basePt, tailBuf.frame);
    const tipUV = relUV(tipPt, tailBuf.frame);
    nextPins.tail = [
      { id: "tailBase", name: "Tail Base Pivot", trackedSourceLabel: "Attaches behind Torso Waist", x: baseUV.x, y: baseUV.y },
      { id: "tailTip", name: "Tail Tip", trackedSourceLabel: "Sways with Body & 2.5D Turn", x: tipUV.x, y: tipUV.y },
    ];
  }

  // 4. Calibrate 1:1 PSD Proportions across every stage builder formula (exact match to PSDImporter.swift!)
  const refHeadH_psd = Math.max(
    100,
    headBuf?.frame.h ?? (torsoBuf ? torsoBuf.frame.h * 0.55 : 500),
  );
  const refHeadW_psd = Math.max(100, headBuf?.frame.w ?? refHeadH_psd);
  const refTorsoBase_psd = refHeadH_psd * 0.9;

  const characterScale = 0.24;
  const estUpperPSD =
    leftArmJ.shoulder && leftArmJ.elbow
      ? Math.hypot(leftArmJ.elbow.x - leftArmJ.shoulder.x, leftArmJ.elbow.y - leftArmJ.shoulder.y)
      : refTorsoBase_psd * 0.45;
  const estForePSD =
    leftArmJ.elbow && leftArmJ.wrist
      ? Math.hypot(leftArmJ.wrist.x - leftArmJ.elbow.x, leftArmJ.wrist.y - leftArmJ.elbow.y)
      : refTorsoBase_psd * 0.4;
  const armToHeadRatio = (estUpperPSD + estForePSD) / Math.max(1, refHeadW_psd);
  const armReachExaggeration = armToHeadRatio < 0.85 ? 0.65 : 0.35;

  if (torsoBuf) {
    nextHeightScale.torso = torsoBuf.frame.h / refTorsoBase_psd;
    nextWidthScale.torso = 1.0;
  }
  if (pelvisBuf) {
    nextHeightScale.pelvis = pelvisBuf.frame.h / (refTorsoBase_psd * 0.44);
    nextWidthScale.pelvis = 1.0;
  }
  if (tailBuf) {
    nextHeightScale.tail = tailBuf.frame.h / (refTorsoBase_psd * 0.72);
    nextWidthScale.tail = 1.0;
  }

  const calibrateLimbScale = (
    slot: PuppetPartSlot,
    pA: { x: number; y: number } | null,
    pB: { x: number; y: number } | null,
    refFactor: number,
  ) => {
    if (!buffers.has(slot) || !pA || !pB) return;
    const boneLen = Math.max(12, Math.hypot(pB.x - pA.x, pB.y - pA.y));
    const s = boneLen / (refTorsoBase_psd * refFactor);
    nextHeightScale[slot] = s;
    nextWidthScale[slot] = s;
  };

  calibrateLimbScale("leftUpperArm", leftArmJ.shoulder, leftArmJ.elbow, 0.52);
  calibrateLimbScale("rightUpperArm", rightArmJ.shoulder, rightArmJ.elbow, 0.52);
  calibrateLimbScale("leftForearm", leftArmJ.elbow, leftArmJ.wrist, 0.5);
  calibrateLimbScale("rightForearm", rightArmJ.elbow, rightArmJ.wrist, 0.5);
  calibrateLimbScale("leftThigh", leftLegJ.hip, leftLegJ.knee, 0.5);
  calibrateLimbScale("rightThigh", rightLegJ.hip, rightLegJ.knee, 0.5);
  calibrateLimbScale("leftShin", leftLegJ.knee, leftLegJ.ankle, 0.5);
  calibrateLimbScale("rightShin", rightLegJ.knee, rightLegJ.ankle, 0.5);

  const lfBuf = buffers.get("leftFoot");
  if (lfBuf) {
    const s = lfBuf.frame.h / (refTorsoBase_psd * 0.38);
    nextHeightScale.leftFoot = s;
    nextWidthScale.leftFoot = s;
  }
  const rfBuf = buffers.get("rightFoot");
  if (rfBuf) {
    const s = rfBuf.frame.h / (refTorsoBase_psd * 0.38);
    nextHeightScale.rightFoot = s;
    nextWidthScale.rightFoot = s;
  }

  let nextHandScale = prevRig.handScale;
  const primaryHandBuf =
    buffers.get("leftHand") ??
    buffers.get("rightHand") ??
    buffers.get("leftHandBack") ??
    buffers.get("rightHandBack");
  if (primaryHandBuf) {
    const refHandH = Math.max(1, primaryHandBuf.frame.h);
    nextHandScale = characterScale * 0.92 * (refHandH / refHeadH_psd);
    for (const hSlot of [
      "leftHand",
      "rightHand",
      "leftHandBack",
      "rightHandBack",
    ] as PuppetPartSlot[]) {
      const hb = buffers.get(hSlot);
      if (hb) {
        const rel = hb.frame.h / refHandH;
        nextHeightScale[hSlot] = rel;
        nextWidthScale[hSlot] = rel;
      }
    }
  }

  const hasHandBack = buffers.has("leftHandBack") || buffers.has("rightHandBack");

  let nextEyeScale = prevRig.eyeSpriteScale;
  const eyeBuf = buffers.get("eyesOpen") ?? buffers.get("rightEyeOpen");
  if (eyeBuf) {
    nextEyeScale = eyeBuf.frame.w / refHeadW_psd / 0.195;
  }
  const lBrowBuf = buffers.get("browsOverlay");
  if (lBrowBuf) {
    const s = lBrowBuf.frame.w / refHeadW_psd / 0.26;
    nextWidthScale.browsOverlay = s;
    nextHeightScale.browsOverlay = s;
  }
  const rBrowBuf = buffers.get("rightBrows");
  if (rBrowBuf) {
    const s = rBrowBuf.frame.w / refHeadW_psd / 0.26;
    nextWidthScale.rightBrows = s;
    nextHeightScale.rightBrows = s;
  }
  let nextMouthScale = prevRig.mouthSpriteScale;
  const mBuf =
    buffers.get("mouthNeutral") ??
    buffers.get("mouthSmile") ??
    buffers.get("mouthAh") ??
    buffers.get("mouthOh");
  if (mBuf) {
    nextMouthScale = mBuf.frame.w / refHeadW_psd / 0.29;
  }
  let nextNoseScale = prevRig.noseSpriteScale;
  const nBuf = buffers.get("noseOverlay");
  if (nBuf) {
    nextNoseScale = nBuf.frame.w / refHeadW_psd / 0.145;
  }

  // 5. Layer Stack & Expression Modes (derive z-order from PSD orderIndex, falling back to defaultLayerStack)
  const baseStack = defaultLayerStack();
  const nextLayerStack = [...baseStack].sort((a, b) => {
    const la = layersBySlot.get(a);
    const lb = layersBySlot.get(b);
    if (la && lb && la.length > 0 && lb.length > 0) {
      const maxA = Math.max(...la.map((x) => x.orderIndex));
      const maxB = Math.max(...lb.map((x) => x.orderIndex));
      return maxB - maxA;
    }
    return baseStack.indexOf(a) - baseStack.indexOf(b);
  });

  const hasVisemes =
    buffers.has("mouthSmile") || buffers.has("mouthAh") || buffers.has("mouthOh");
  const hasClosedEyes = buffers.has("eyesClosed") || buffers.has("rightEyeClosed");
  const hasLegs =
    buffers.has("leftThigh") ||
    buffers.has("rightThigh") ||
    buffers.has("leftShin") ||
    buffers.has("rightShin") ||
    buffers.has("leftFoot") ||
    buffers.has("rightFoot");

  const baseName = psd.fileName.replace(/\.psd$/i, "").trim();

  return {
    ...prevRig,
    characterName: baseName || prevRig.characterName,
    partDataUrls: nextUrls,
    partFileNames: nextNames,
    partEnabled: nextEnabled,
    pinsBySlot: nextPins,
    layerStack: nextLayerStack,
    partWidthScale: nextWidthScale,
    partHeightScale: nextHeightScale,
    partRotationOffset: nextRotOffset,
    partFlipH: nextFlipH,
    partFlipV: nextFlipV,
    partOffsetX: nextOffsetX,
    partOffsetY: nextOffsetY,
    stageOffsetX: 0,
    stageOffsetY: 0,
    characterScale,
    armLengthScale: 1.0,
    armThicknessScale: 1.0,
    armReachExaggeration,
    legLengthScale: 1.0,
    legThicknessScale: 1.0,
    handScale: nextHandScale,
    eyeSpriteScale: nextEyeScale,
    noseSpriteScale: nextNoseScale,
    mouthSpriteScale: nextMouthScale,
    dynamicPalmFlip: hasHandBack ? true : prevRig.dynamicPalmFlip,
    mouthAnimationMode: hasVisemes ? "sprites" : prevRig.mouthAnimationMode,
    eyeAnimationMode: hasClosedEyes ? "sprite" : prevRig.eyeAnimationMode,
    showFullBodyLegs: hasLegs,
    headScaleAmount: hasLegs ? 0.0 : prevRig.headScaleAmount,
  };
}
