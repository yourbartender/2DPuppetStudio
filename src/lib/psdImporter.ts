import {
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
  /** Exact bounding box in full PSD canvas pixel coordinates (top-left origin) */
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

function decodeMacRoman(bytes: Uint8Array): string {
  // Handle basic ASCII + Finnish/Nordic characters cleanly
  try {
    return new TextDecoder("macintosh").decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

function decodePackBits(
  src: Uint8Array,
  offset: number,
  expectedLen: number,
  height: number,
): { data: Uint8Array; nextOffset: number } {
  // First height * 2 bytes are row byte counts (uint16 BE)
  const view = new DataView(src.buffer, src.byteOffset + offset, height * 2);
  let totalPacked = 0;
  const rowLengths: number[] = new Array(height);
  for (let r = 0; r < height; r++) {
    const rl = view.getUint16(r * 2, false);
    rowLengths[r] = rl;
    totalPacked += rl;
  }

  let pos = offset + height * 2;
  const out = new Uint8Array(expectedLen);
  let outPos = 0;
  const rowWidth = height > 0 ? Math.floor(expectedLen / height) : 0;

  for (let r = 0; r < height; r++) {
    const rowEnd = pos + rowLengths[r];
    const outRowEnd = Math.min(expectedLen, (r + 1) * rowWidth);
    while (pos < rowEnd && outPos < outRowEnd) {
      const header = src[pos] > 127 ? src[pos] - 256 : src[pos];
      pos += 1;
      if (header >= 0) {
        const count = header + 1;
        for (let i = 0; i < count && pos < src.length && outPos < outRowEnd; i++) {
          out[outPos++] = src[pos++];
        }
      } else if (header !== -128) {
        const count = 1 - header;
        const val = pos < src.length ? src[pos++] : 0;
        for (let i = 0; i < count && outPos < outRowEnd; i++) {
          out[outPos++] = val;
        }
      }
    }
    pos = rowEnd;
    outPos = outRowEnd;
  }

  return { data: out, nextOffset: offset + height * 2 + totalPacked };
}

export function suggestSlotForLayerName(
  name: string,
  centerXNorm: number,
): PuppetPartSlot | null {
  const n = name.toLowerCase().replace(/[_\-.]+/g, " ").trim();
  const isLeft =
    /\b(left|vasen|vas|l)\b/.test(n) ||
    n.includes("left") ||
    n.includes("vasen");
  const isRight =
    /\b(right|oikea|oik|r)\b/.test(n) ||
    n.includes("right") ||
    n.includes("oikea");
  const sideLeft = isLeft ? true : isRight ? false : centerXNorm < 0.5;

  // Back of hand (Kämmenselkä / hand back)
  if (
    n.includes("kammenselka") ||
    n.includes("kämmenselkä") ||
    n.includes("hand back") ||
    n.includes("back hand") ||
    n.includes("backofhand") ||
    (n.includes("selka") && (n.includes("kasi") || n.includes("käsi") || n.includes("hand")))
  ) {
    return sideLeft ? "leftHandBack" : "rightHandBack";
  }

  // Mouth visemes
  if (n.includes("mouth") || n.includes("suu") || n.includes("huul")) {
    if (n.includes("ah") || n.includes("open") || n.includes("auki") || n.includes("aa")) {
      return "mouthAh";
    }
    if (n.includes("oh") || n.includes("oo") || n.includes("pyorea") || n.includes("round")) {
      return "mouthOh";
    }
    if (n.includes("smile") || n.includes("hymy") || n.includes("ee") || n.includes("happy")) {
      return "mouthSmile";
    }
    return "mouthNeutral";
  }

  // Eyebrows
  if (n.includes("brow") || n.includes("kulma")) {
    return sideLeft ? "browsOverlay" : "rightBrows";
  }

  // Eyes
  if (n.includes("eye") || n.includes("silm")) {
    const closed =
      n.includes("closed") ||
      n.includes("kiinni") ||
      n.includes("blink") ||
      n.includes("wink") ||
      n.includes("shut");
    if (closed) return sideLeft ? "eyesClosed" : "rightEyeClosed";
    return sideLeft ? "eyesOpen" : "rightEyeOpen";
  }

  // Nose
  if (n.includes("nose") || n.includes("nena") || n.includes("nenä") || n.includes("kuono")) {
    return "noseOverlay";
  }

  // Head / Ears
  if (
    n.includes("head") ||
    n.includes("paa") ||
    n.includes("pää") ||
    n.includes("face") ||
    n.includes("kasvo") ||
    n.includes("ear") ||
    n.includes("korva")
  ) {
    return "head";
  }

  // Tail
  if (n.includes("tail") || n.includes("hanta") || n.includes("häntä")) {
    return "tail";
  }

  // Pelvis / Hips
  if (n.includes("pelvis") || n.includes("hip") || n.includes("lantio") || n.includes("vyotaro")) {
    return "pelvis";
  }

  // Torso / Body
  if (
    n.includes("torso") ||
    n.includes("body") ||
    n.includes("chest") ||
    n.includes("vartalo") ||
    n.includes("keho") ||
    n.includes("neck") ||
    n.includes("kaula")
  ) {
    return "torso";
  }

  // Arms & Hands
  if (n.includes("forearm") || n.includes("lower arm") || n.includes("kyynar") || n.includes("kyynär")) {
    return sideLeft ? "leftForearm" : "rightForearm";
  }
  if (n.includes("upper arm") || n.includes("upperarm") || n.includes("olkavarsi") || n.includes("olka")) {
    return sideLeft ? "leftUpperArm" : "rightUpperArm";
  }
  if (
    n.includes("hand") ||
    n.includes("paw") ||
    n.includes("kasi") ||
    n.includes("käsi") ||
    n.includes("tassu") ||
    n.includes("kämmen") ||
    n.includes("kammen")
  ) {
    return sideLeft ? "leftHand" : "rightHand";
  }
  if (n.includes("arm") || n.includes("käsivarsi") || n.includes("kasivarsi")) {
    return sideLeft ? "leftUpperArm" : "rightUpperArm";
  }

  // Legs & Feet
  if (n.includes("thigh") || n.includes("upper leg") || n.includes("reisi")) {
    return sideLeft ? "leftThigh" : "rightThigh";
  }
  if (n.includes("shin") || n.includes("calf") || n.includes("lower leg") || n.includes("saari") || n.includes("sääri")) {
    return sideLeft ? "leftShin" : "rightShin";
  }
  if (n.includes("foot") || n.includes("shoe") || n.includes("jalkater") || n.includes("kenka") || n.includes("kenkä")) {
    return sideLeft ? "leftFoot" : "rightFoot";
  }
  if (n.includes("leg") || n.includes("jalka")) {
    return sideLeft ? "leftThigh" : "rightThigh";
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
  if (depth !== 8) {
    throw new Error(`Unsupported PSD bit depth (${depth}-bit). Please save as 8-bit RGB.`);
  }
  if (colorMode !== 3 && colorMode !== 1) {
    throw new Error("Unsupported PSD color mode. Please convert to RGB (8-bit) in Photoshop.");
  }

  let offset = 26;
  // Color Mode Data section
  const colorModeLen = view.getUint32(offset, false);
  offset += 4 + colorModeLen;

  // Image Resources section
  const imgResLen = view.getUint32(offset, false);
  offset += 4 + imgResLen;

  // Layer and Mask Information section
  const layerMaskLen = view.getUint32(offset, false);
  offset += 4;
  if (layerMaskLen === 0) {
    throw new Error("This PSD contains no layers.");
  }

  const layerInfoLen = view.getUint32(offset, false);
  offset += 4;
  if (layerInfoLen === 0) {
    throw new Error("This PSD layer info section is empty.");
  }

  let rawLayerCount = view.getInt16(offset, false);
  offset += 2;
  const layerCount = Math.abs(rawLayerCount);

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

    // Blend mode signature "8BIM" + key (4)
    offset += 8;
    const opacity = view.getUint8(offset) / 255;
    const flags = view.getUint8(offset + 2);
    const visible = (flags & 0x02) === 0;
    offset += 4;

    const extraLen = view.getUint32(offset, false);
    offset += 4;
    const extraEnd = offset + extraLen;

    // Layer mask data
    const maskLen = view.getUint32(offset, false);
    offset += 4 + maskLen;
    // Blending ranges
    const rangesLen = view.getUint32(offset, false);
    offset += 4 + rangesLen;
    // Pascal layer name padded to multiple of 4
    const nameLen = view.getUint8(offset);
    let layerName = decodeMacRoman(bytes.subarray(offset + 1, offset + 1 + nameLen));
    const paddedNameLen = Math.ceil((nameLen + 1) / 4) * 4;
    offset += paddedNameLen;

    let isFolderMarker = false;
    // Parse Additional Layer Information blocks (luni Unicode name, lsct folder divider)
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
      name: layerName || `Layer ${i + 1}`,
      isFolderMarker,
    });
  }

  // Decode channel image data for each layer record
  const layers: PSDLayer[] = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const w = Math.max(0, rec.right - rec.left);
    const h = Math.max(0, rec.bottom - rec.top);
    const pixelCount = w * h;

    const chanData = new Map<number, Uint8Array>();
    for (const ch of rec.channels) {
      const chStart = offset;
      const chEnd = chStart + ch.dataLen;
      if (pixelCount > 0 && ch.dataLen >= 2 && chEnd <= bytes.length) {
        const compression = view.getUint16(chStart, false);
        if (compression === 0) {
          chanData.set(
            ch.id,
            bytes.subarray(chStart + 2, Math.min(chEnd, chStart + 2 + pixelCount)),
          );
        } else if (compression === 1) {
          const decoded = decodePackBits(bytes, chStart + 2, pixelCount, h);
          chanData.set(ch.id, decoded.data);
        }
      }
      offset = chEnd;
    }

    if (rec.isFolderMarker || w === 0 || h === 0) continue;

    const rCh = chanData.get(0);
    const gCh = colorMode === 1 ? rCh : chanData.get(1);
    const bCh = colorMode === 1 ? rCh : chanData.get(2);
    const aCh = chanData.get(-1);
    if (!rCh) continue;

    // Trim transparent margins & extract straight RGBA
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const a = aCh ? aCh[idx] : 255;
        if (a > 6) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) continue;

    const tw = maxX - minX + 1;
    const th = maxY - minY + 1;
    const rgba = new Uint8ClampedArray(tw * th * 4);
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const srcIdx = (y + minY) * w + (x + minX);
        const dstIdx = (y * tw + x) * 4;
        const a = aCh ? aCh[srcIdx] : 255;
        rgba[dstIdx] = a > 0 ? rCh[srcIdx] : 0;
        rgba[dstIdx + 1] = a > 0 ? (gCh ? gCh[srcIdx] : rCh[srcIdx]) : 0;
        rgba[dstIdx + 2] = a > 0 ? (bCh ? bCh[srcIdx] : rCh[srcIdx]) : 0;
        rgba[dstIdx + 3] = a;
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(new ImageData(rgba, tw, th), 0, 0);

    const worldX = rec.left + minX;
    const worldY = rec.top + minY;
    const centerXNorm = (worldX + tw * 0.5) / Math.max(1, canvasWidth);

    layers.push({
      id: `psd_${i}_${rec.name}`,
      name: rec.name,
      orderIndex: i,
      visible: rec.visible,
      opacity: rec.opacity,
      x: worldX,
      y: worldY,
      width: tw,
      height: th,
      dataUrl: canvas.toDataURL("image/png"),
      rgba,
      suggestedSlot: suggestSlotForLayerName(rec.name, centerXNorm),
    });
  }

  // Return front-to-back for intuitive Photoshop layer list ordering
  layers.reverse();
  return {
    fileName,
    canvasWidth,
    canvasHeight,
    layers,
  };
}

// ── Composite mapped PSD layers into PuppetRigState with exact 1:1 scale & pins ──

interface SlotBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function compositeLayersToBox(layers: PSDLayer[], box: SlotBox): string {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(box.w));
  c.height = Math.max(1, Math.round(box.h));
  const ctx = c.getContext("2d")!;
  // Sort bottom-to-top (ascending orderIndex)
  const ordered = [...layers].sort((a, b) => a.orderIndex - b.orderIndex);
  for (const layer of ordered) {
    const tmp = document.createElement("canvas");
    tmp.width = layer.width;
    tmp.height = layer.height;
    tmp.getContext("2d")!.putImageData(
      new ImageData(new Uint8ClampedArray(layer.rgba), layer.width, layer.height),
      0,
      0,
    );
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(tmp, layer.x - box.x, layer.y - box.y);
  }
  ctx.globalAlpha = 1;
  return c.toDataURL("image/png");
}

function unionBox(layers: PSDLayer[]): SlotBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const l of layers) {
    if (l.x < minX) minX = l.x;
    if (l.y < minY) minY = l.y;
    if (l.x + l.width > maxX) maxX = l.x + l.width;
    if (l.y + l.height > maxY) maxY = l.y + l.height;
  }
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

function overlapPoint(a: SlotBox, b: SlotBox): { x: number; y: number } {
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.w, b.x + b.w);
  const iy2 = Math.min(a.y + a.h, b.y + b.h);
  if (ix2 > ix1 && iy2 > iy1) {
    return { x: (ix1 + ix2) * 0.5, y: (iy1 + iy2) * 0.5 };
  }
  // Nearest edge midpoint if non-overlapping
  const cxA = a.x + a.w * 0.5;
  const cyA = a.y + a.h * 0.5;
  const cxB = b.x + b.w * 0.5;
  const cyB = b.y + b.h * 0.5;
  return { x: (cxA + cxB) * 0.5, y: (cyA + cyB) * 0.5 };
}

function toUV(box: SlotBox, pt: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.max(0.03, Math.min(0.97, (pt.x - box.x) / Math.max(1, box.w))),
    y: Math.max(0.03, Math.min(0.97, (pt.y - box.y) / Math.max(1, box.h))),
  };
}

export function applyPSDLayersToRig(
  prevRig: PuppetRigState,
  psd: ParsedPSD,
  slotsByLayerId: Record<string, PuppetPartSlot[]>,
  enabledByLayerId: Record<string, boolean>,
  clearUnmappedSlots: boolean,
): PuppetRigState {
  // Group enabled layers by target PuppetPartSlot (supports multi-slot sharing!)
  const layersForSlot = new Map<PuppetPartSlot, PSDLayer[]>();
  for (const layer of psd.layers) {
    if (!enabledByLayerId[layer.id]) continue;
    const assigned = slotsByLayerId[layer.id] ?? [];
    for (const slot of assigned) {
      const list = layersForSlot.get(slot) ?? [];
      list.push(layer);
      layersForSlot.set(slot, list);
    }
  }

  const slotBoxes = new Map<PuppetPartSlot, SlotBox>();
  for (const [slot, list] of layersForSlot.entries()) {
    slotBoxes.set(slot, unionBox(list));
  }

  // Align mouth viseme slots & eye open/closed pairs to shared union boxes so swaps never jump!
  const alignGroups: PuppetPartSlot[][] = [
    ["mouthNeutral", "mouthAh", "mouthOh", "mouthSmile"],
    ["eyesOpen", "eyesClosed"],
    ["rightEyeOpen", "rightEyeClosed"],
  ];
  for (const group of alignGroups) {
    const presentLayers: PSDLayer[] = [];
    for (const s of group) {
      const list = layersForSlot.get(s);
      if (list) presentLayers.push(...list);
    }
    if (presentLayers.length > 1) {
      const shared = unionBox(presentLayers);
      for (const s of group) {
        if (layersForSlot.has(s)) slotBoxes.set(s, shared);
      }
    }
  }

  const nextUrls = clearUnmappedSlots ? {} : { ...prevRig.partDataUrls };
  const nextNames = clearUnmappedSlots ? {} : { ...prevRig.partFileNames };
  const nextEnabled = { ...prevRig.partEnabled };
  if (clearUnmappedSlots) {
    for (const k of Object.keys(nextEnabled) as PuppetPartSlot[]) {
      nextEnabled[k] = false;
    }
  }

  for (const [slot, list] of layersForSlot.entries()) {
    const box = slotBoxes.get(slot)!;
    nextUrls[slot] = compositeLayersToBox(list, box);
    nextNames[slot] = list.map((l) => l.name).join(" + ");
    nextEnabled[slot] = true;
  }

  // Auto-rig pins from exact PSD spatial overlaps
  const nextPins: Record<PuppetPartSlot, PuppetControlPin[]> = clearUnmappedSlots
    ? defaultPins()
    : Object.fromEntries(
        Object.entries(prevRig.pinsBySlot).map(([k, v]) => [k, v.map((p) => ({ ...p }))]),
      ) as Record<PuppetPartSlot, PuppetControlPin[]>;

  const setPinUV = (slot: PuppetPartSlot, pinId: string, uv: { x: number; y: number }) => {
    const arr = nextPins[slot];
    if (!arr) return;
    const p = arr.find((item) => item.id === pinId);
    if (p) {
      p.x = uv.x;
      p.y = uv.y;
    }
  };

  const headBox = slotBoxes.get("head");
  const torsoBox = slotBoxes.get("torso");
  const pelvisBox = slotBoxes.get("pelvis");

  if (headBox && torsoBox) {
    const neckPt = overlapPoint(headBox, torsoBox);
    setPinUV("head", "neckPivot", toUV(headBox, neckPt));
    setPinUV("torso", "neckMount", toUV(torsoBox, neckPt));
  }

  if (headBox) {
    const lEyeBox = slotBoxes.get("eyesOpen") ?? slotBoxes.get("eyesClosed");
    if (lEyeBox) {
      setPinUV("head", "leftEye", toUV(headBox, { x: lEyeBox.x + lEyeBox.w * 0.5, y: lEyeBox.y + lEyeBox.h * 0.5 }));
    }
    const rEyeBox = slotBoxes.get("rightEyeOpen") ?? slotBoxes.get("rightEyeClosed");
    if (rEyeBox) {
      setPinUV("head", "rightEye", toUV(headBox, { x: rEyeBox.x + rEyeBox.w * 0.5, y: rEyeBox.y + rEyeBox.h * 0.5 }));
    }
    const noseBox = slotBoxes.get("noseOverlay");
    if (noseBox) {
      setPinUV("head", "noseCenter", toUV(headBox, { x: noseBox.x + noseBox.w * 0.5, y: noseBox.y + noseBox.h * 0.5 }));
    }
    const mouthBox =
      slotBoxes.get("mouthNeutral") ??
      slotBoxes.get("mouthAh") ??
      slotBoxes.get("mouthSmile") ??
      slotBoxes.get("mouthOh");
    if (mouthBox) {
      setPinUV("head", "mouthCenter", toUV(headBox, { x: mouthBox.x + mouthBox.w * 0.5, y: mouthBox.y + mouthBox.h * 0.5 }));
    }
    const lBrowBox = slotBoxes.get("browsOverlay");
    if (lBrowBox) {
      setPinUV("head", "leftBrow", toUV(headBox, { x: lBrowBox.x + lBrowBox.w * 0.5, y: lBrowBox.y + lBrowBox.h * 0.5 }));
    }
    const rBrowBox = slotBoxes.get("rightBrows");
    if (rBrowBox) {
      setPinUV("head", "rightBrow", toUV(headBox, { x: rBrowBox.x + rBrowBox.w * 0.5, y: rBrowBox.y + rBrowBox.h * 0.5 }));
    }
  }

  // Arms auto-rigging
  for (const side of ["left", "right"] as const) {
    const upSlot: PuppetPartSlot = side === "left" ? "leftUpperArm" : "rightUpperArm";
    const foSlot: PuppetPartSlot = side === "left" ? "leftForearm" : "rightForearm";
    const haSlot: PuppetPartSlot = side === "left" ? "leftHand" : "rightHand";
    const shPinId = side === "left" ? "leftShoulder" : "rightShoulder";

    const upBox = slotBoxes.get(upSlot);
    const foBox = slotBoxes.get(foSlot);
    const haBox = slotBoxes.get(haSlot);

    if (torsoBox && upBox) {
      const shPt = overlapPoint(torsoBox, upBox);
      setPinUV("torso", shPinId, toUV(torsoBox, shPt));
      setPinUV(upSlot, "shoulderJoint", toUV(upBox, shPt));
    }
    if (upBox && foBox) {
      const elPt = overlapPoint(upBox, foBox);
      setPinUV(upSlot, "elbowJoint", toUV(upBox, elPt));
      setPinUV(foSlot, "elbowJoint", toUV(foBox, elPt));
    }
    if (foBox && haBox) {
      const wrPt = overlapPoint(foBox, haBox);
      setPinUV(foSlot, "wristJoint", toUV(foBox, wrPt));
      setPinUV(haSlot, "wristPivot", toUV(haBox, wrPt));
      // Opposite edge of hand box from wrist is finger direction
      const wrUV = toUV(haBox, wrPt);
      setPinUV(haSlot, "middleKnuckle", {
        x: Math.max(0.08, Math.min(0.92, 1 - wrUV.x)),
        y: Math.max(0.08, Math.min(0.92, 1 - wrUV.y)),
      });
    }
  }

  // Pelvis, Tail & Legs auto-rigging
  if (torsoBox && pelvisBox) {
    const wPt = overlapPoint(torsoBox, pelvisBox);
    setPinUV("torso", "waistPivot", toUV(torsoBox, wPt));
    setPinUV("pelvis", "waistJoint", toUV(pelvisBox, wPt));
  }
  const tailBox = slotBoxes.get("tail");
  const tailParent = pelvisBox ?? torsoBox;
  if (tailBox && tailParent) {
    const tPt = overlapPoint(tailParent, tailBox);
    setPinUV("tail", "tailBase", toUV(tailBox, tPt));
  }

  const hipOwnerSlot: PuppetPartSlot = pelvisBox ? "pelvis" : "torso";
  const hipOwnerBox = pelvisBox ?? torsoBox;
  for (const side of ["left", "right"] as const) {
    const thSlot: PuppetPartSlot = side === "left" ? "leftThigh" : "rightThigh";
    const shSlot: PuppetPartSlot = side === "left" ? "leftShin" : "rightShin";
    const ftSlot: PuppetPartSlot = side === "left" ? "leftFoot" : "rightFoot";
    const hipPinId = side === "left" ? "leftHip" : "rightHip";

    const thBox = slotBoxes.get(thSlot);
    const shBox = slotBoxes.get(shSlot);
    const ftBox = slotBoxes.get(ftSlot);

    if (hipOwnerBox && thBox) {
      const hp = overlapPoint(hipOwnerBox, thBox);
      if (hipOwnerSlot === "pelvis") setPinUV("pelvis", hipPinId, toUV(hipOwnerBox, hp));
      setPinUV(thSlot, "hipJoint", toUV(thBox, hp));
    }
    if (thBox && shBox) {
      const kn = overlapPoint(thBox, shBox);
      setPinUV(thSlot, "kneeJoint", toUV(thBox, kn));
      setPinUV(shSlot, "kneeJoint", toUV(shBox, kn));
    }
    if (shBox && ftBox) {
      const an = overlapPoint(shBox, ftBox);
      setPinUV(shSlot, "ankleJoint", toUV(shBox, an));
      setPinUV(ftSlot, "ankleJoint", toUV(ftBox, an));
    }
  }

  // Calibrate facial feature scales to match PSD 1:1 relative to head width
  let nextEyeScale = prevRig.eyeSpriteScale;
  let nextNoseScale = prevRig.noseSpriteScale;
  let nextMouthScale = prevRig.mouthSpriteScale;
  let nextHandScale = prevRig.handScale;
  if (headBox) {
    const eyeBox = slotBoxes.get("eyesOpen") ?? slotBoxes.get("rightEyeOpen");
    if (eyeBox) {
      nextEyeScale = Math.max(0.25, Math.min(2.8, eyeBox.w / (headBox.w * 0.24)));
    }
    const noseBox = slotBoxes.get("noseOverlay");
    if (noseBox) {
      nextNoseScale = Math.max(0.25, Math.min(2.8, noseBox.w / (headBox.w * 0.22)));
    }
    const mBox = slotBoxes.get("mouthNeutral") ?? slotBoxes.get("mouthAh");
    if (mBox) {
      nextMouthScale = Math.max(0.25, Math.min(2.8, mBox.w / (headBox.w * 0.34)));
    }
    const hBox = slotBoxes.get("leftHand") ?? slotBoxes.get("rightHand");
    if (hBox) {
      nextHandScale = Math.max(0.06, Math.min(0.45, (hBox.w / Math.max(1, headBox.w)) * prevRig.characterScale));
    }
  }

  // Derive z-order layerStack from PSD orderIndex
  const baseStack = defaultLayerStack();
  const nextLayerStack = [...baseStack].sort((a, b) => {
    const la = layersForSlot.get(a);
    const lb = layersForSlot.get(b);
    if (la && lb) {
      const maxA = Math.max(...la.map((x) => x.orderIndex));
      const maxB = Math.max(...lb.map((x) => x.orderIndex));
      return maxB - maxA; // Higher orderIndex = closer to front (smaller index in layerStack)
    }
    return baseStack.indexOf(a) - baseStack.indexOf(b);
  });

  const baseName = psd.fileName.replace(/\.psd$/i, "").trim();

  return {
    ...prevRig,
    characterName: baseName || prevRig.characterName,
    partDataUrls: nextUrls,
    partFileNames: nextNames,
    partEnabled: nextEnabled,
    pinsBySlot: nextPins,
    layerStack: nextLayerStack,
    eyeSpriteScale: nextEyeScale,
    noseSpriteScale: nextNoseScale,
    mouthSpriteScale: nextMouthScale,
    handScale: nextHandScale,
  };
}
