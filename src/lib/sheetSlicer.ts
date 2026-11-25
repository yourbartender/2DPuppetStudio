import {
  ALL_PUPPET_SLOTS,
  SLOT_META_BY_ID,
  type PuppetPartSlot,
} from "@/lib/puppetModel";

export interface SheetIsland {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dataUrl: string;
  sourceSlotHint?: PuppetPartSlot;
}

export function extractSheetIslands(
  img: HTMLImageElement,
  removeBg: boolean,
  bgTolerance = 36,
): SheetIsland[] {
  const maxDim = 1400;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight, 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Background removal via perimeter flood fill (protects white eyes/fur inside outlines!)
  if (removeBg) {
    // Sample 4 corners to estimate paper background color
    const corners = [
      0,
      (w - 1) * 4,
      (h - 1) * w * 4,
      ((h - 1) * w + (w - 1)) * 4,
    ];
    let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
    for (const idx of corners) {
      if (d[idx + 3] > 20) {
        bgR += d[idx];
        bgG += d[idx + 1];
        bgB += d[idx + 2];
        bgCount++;
      }
    }
    if (bgCount > 0) {
      bgR /= bgCount;
      bgG /= bgCount;
      bgB /= bgCount;

      const visited = new Uint8Array(w * h);
      const queue = new Int32Array(w * h);
      let head = 0, tail = 0;

      const isBg = (pIdx: number) => {
        const o = pIdx * 4;
        if (d[o + 3] < 16) return true;
        const dr = Math.abs(d[o] - bgR);
        const dg = Math.abs(d[o + 1] - bgG);
        const db = Math.abs(d[o + 2] - bgB);
        return dr + dg + db < bgTolerance * 3;
      };

      const seed = (x: number, y: number) => {
        const p = y * w + x;
        if (!visited[p] && isBg(p)) {
          visited[p] = 1;
          queue[tail++] = p;
        }
      };

      for (let x = 0; x < w; x++) {
        seed(x, 0);
        seed(x, h - 1);
      }
      for (let y = 0; y < h; y++) {
        seed(0, y);
        seed(w - 1, y);
      }

      while (head < tail) {
        const cur = queue[head++];
        d[cur * 4 + 3] = 0;
        const cx = cur % w;
        const cy = (cur - cx) / w;
        if (cx > 0) seed(cx - 1, cy);
        if (cx + 1 < w) seed(cx + 1, cy);
        if (cy > 0) seed(cx, cy - 1);
        if (cy + 1 < h) seed(cx, cy + 1);
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  // Connected-component labeling on opaque pixels (downsampled grid for speed)
  const step = Math.max(1, Math.floor(Math.max(w, h) / 360));
  const gw = Math.ceil(w / step);
  const gh = Math.ceil(h / step);
  const solid = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const px = Math.min(w - 1, gx * step);
      const py = Math.min(h - 1, gy * step);
      if (d[(py * w + px) * 4 + 3] > 28) {
        solid[gy * gw + gx] = 1;
      }
    }
  }

  const seen = new Uint8Array(gw * gh);
  const q = new Int32Array(gw * gh);
  const islands: SheetIsland[] = [];

  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const start = gy * gw + gx;
      if (!solid[start] || seen[start]) continue;
      seen[start] = 1;
      let qh = 0, qt = 0;
      q[qt++] = start;
      let minX = gx, maxX = gx, minY = gy, maxY = gy, count = 0;

      while (qh < qt) {
        const cur = q[qh++];
        count++;
        const cx = cur % gw;
        const cy = (cur - cx) / gw;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const neighbors = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < gw && ny >= 0 && ny < gh) {
            const ni = ny * gw + nx;
            if (solid[ni] && !seen[ni]) {
              seen[ni] = 1;
              q[qt++] = ni;
            }
          }
        }
      }

      if (count < 16) continue;
      const pad = Math.max(2, step);
      const rx = Math.max(0, minX * step - pad);
      const ry = Math.max(0, minY * step - pad);
      const rw = Math.min(w - rx, (maxX - minX + 1) * step + pad * 2);
      const rh = Math.min(h - ry, (maxY - minY + 1) * step + pad * 2);
      if (rw < 14 || rh < 14) continue;

      const sub = document.createElement("canvas");
      sub.width = rw;
      sub.height = rh;
      sub.getContext("2d")!.drawImage(c, rx, ry, rw, rh, 0, 0, rw, rh);
      islands.push({
        id: `island_${islands.length + 1}`,
        x: rx / w,
        y: ry / h,
        width: rw / w,
        height: rh / h,
        dataUrl: sub.toDataURL("image/png"),
      });
    }
  }

  return islands;
}

export function generateExampleSheetFromRig(
  images: Partial<Record<PuppetPartSlot, HTMLImageElement>>,
): { dataUrl: string; islands: SheetIsland[] } {
  const slots = ALL_PUPPET_SLOTS.filter((s) => Boolean(images[s]));
  const cols = 5;
  const rows = Math.max(1, Math.ceil(slots.length / cols));
  const cellW = 240;
  const cellH = 240;
  const pad = 28;
  const w = cols * cellW + pad * 2;
  const h = rows * cellH + pad * 2;

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const islands: SheetIsland[] = [];
  slots.forEach((slot, idx) => {
    const img = images[slot]!;
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const cx = pad + col * cellW;
    const cy = pad + row * cellH;

    const maxDraw = cellW - 44;
    const scale = Math.min(maxDraw / img.naturalWidth, maxDraw / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const dx = cx + (cellW - dw) / 2;
    const dy = cy + (cellH - dh) / 2 - 8;

    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.fillStyle = "#4b5563";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(SLOT_META_BY_ID[slot].title, cx + cellW / 2, cy + cellH - 12);

    // Lossless direct copy of the original sprite
    const orig = document.createElement("canvas");
    orig.width = img.naturalWidth;
    orig.height = img.naturalHeight;
    orig.getContext("2d")!.drawImage(img, 0, 0);

    islands.push({
      id: `sheet_${slot}`,
      x: dx / w,
      y: dy / h,
      width: dw / w,
      height: dh / h,
      dataUrl: orig.toDataURL("image/png"),
      sourceSlotHint: slot,
    });
  });

  return { dataUrl: c.toDataURL("image/png"), islands };
}
