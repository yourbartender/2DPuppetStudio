import React, { useRef, useState } from "react";
import { X, Upload, Scissors, Sparkles } from "lucide-react";
import {
  PUPPET_SLOT_META,
  type PuppetPartSlot,
  type PuppetStore,
} from "@/lib/puppetModel";
import {
  extractSheetIslands,
  generateExampleSheetFromRig,
  type SheetIsland,
} from "@/lib/sheetSlicer";

interface SheetImporterModalProps {
  open: boolean;
  onClose: () => void;
  store: PuppetStore;
}

export function SheetImporterModal({ open, onClose, store }: SheetImporterModalProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [sheetImg, setSheetImg] = useState<HTMLImageElement | null>(null);
  const [islands, setIslands] = useState<SheetIsland[]>([]);
  const [assignments, setAssignments] = useState<Record<string, PuppetPartSlot | "">>({});
  const [removeBg, setRemoveBg] = useState(true);
  const [tolerance, setTolerance] = useState(36);

  if (!open) return null;

  const runDetect = (img: HTMLImageElement, doRemoveBg: boolean, tol: number) => {
    const found = extractSheetIslands(img, doRemoveBg, tol);
    setIslands(found);
    setAssignments({});
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      const img = new Image();
      img.onload = () => {
        setSheetUrl(url);
        setSheetImg(img);
        runDetect(img, removeBg, tolerance);
      };
      img.src = url;
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateFromCurrent = () => {
    const gen = generateExampleSheetFromRig(store.images);
    setSheetUrl(gen.dataUrl);
    setSheetImg(null);
    setIslands(gen.islands);
    const autoMap: Record<string, PuppetPartSlot | ""> = {};
    for (const isl of gen.islands) {
      if (isl.sourceSlotHint) autoMap[isl.id] = isl.sourceSlotHint;
    }
    setAssignments(autoMap);
  };

  const handleApply = () => {
    let count = 0;
    for (const isl of islands) {
      const target = assignments[isl.id];
      if (target) {
        store.setPartImage(target, isl.dataUrl, `Sheet Cut (${isl.id})`);
        count++;
      }
    }
    if (count > 0) onClose();
  };

  const assignedCount = Object.values(assignments).filter(Boolean).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#151922] text-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
              <Scissors className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Paper Puppet Sheet Auto-Slicer</h2>
              <p className="text-xs text-muted-foreground">
                Upload a scanned or painted character parts sheet — background is removed and parts
                are sliced automatically
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/25 px-5 py-3 text-xs">
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 font-semibold text-black hover:bg-amber-400"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload Sheet Image…
            </button>
            <button
              type="button"
              onClick={handleGenerateFromCurrent}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 font-medium hover:bg-white/15"
            >
              <Sparkles className="h-3.5 w-3.5 text-cyan-300" />
              Build Sheet From Current Puppet
            </button>
          </div>

          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-1.5 text-muted-foreground">
              <input
                type="checkbox"
                checked={removeBg}
                onChange={(e) => {
                  setRemoveBg(e.target.checked);
                  if (sheetImg) runDetect(sheetImg, e.target.checked, tolerance);
                }}
                className="accent-amber-400"
              />
              Remove Paper Background
            </label>
            <label className="inline-flex items-center gap-1.5 text-muted-foreground">
              Tolerance
              <input
                type="range"
                min={10}
                max={80}
                value={tolerance}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setTolerance(v);
                  if (sheetImg) runDetect(sheetImg, removeBg, v);
                }}
                className="w-20 accent-amber-400"
              />
              <span className="w-6 font-mono">{tolerance}</span>
            </label>
          </div>
        </div>

        {/* Body */}
        <div className="grid flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-2">
          {/* Sheet Preview */}
          <div className="flex flex-col rounded-xl border border-white/10 bg-black/30 p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Source Sheet ({islands.length} cut-outs detected)
            </div>
            {sheetUrl ? (
              <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-lg bg-white/95 p-2">
                <img
                  src={sheetUrl}
                  alt="Puppet sheet"
                  className="max-h-[420px] max-w-full object-contain"
                />
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center py-16 text-center text-xs text-muted-foreground">
                <Scissors className="mb-2 h-8 w-8 text-amber-400/60" />
                Upload a PNG/JPG character parts sheet or build one from the current puppet.
              </div>
            )}
          </div>

          {/* Detected Islands */}
          <div className="flex flex-col rounded-xl border border-white/10 bg-black/30 p-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Assign Cut-Outs to Puppet Parts
            </div>
            <div className="grid max-h-[430px] grid-cols-2 gap-2 overflow-y-auto pr-1">
              {islands.map((isl) => (
                <div
                  key={isl.id}
                  className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-[#181d28] p-2"
                >
                  <div className="flex h-20 w-full items-center justify-center rounded bg-[repeating-conic-gradient(#262b36_0%_25%,#1b1f29_0%_50%)] bg-[length:10px_10px] p-1">
                    <img
                      src={isl.dataUrl}
                      alt={isl.id}
                      className="max-h-18 max-w-full object-contain"
                    />
                  </div>
                  <select
                    value={assignments[isl.id] ?? ""}
                    onChange={(e) =>
                      setAssignments((p) => ({
                        ...p,
                        [isl.id]: e.target.value as PuppetPartSlot | "",
                      }))
                    }
                    className="w-full rounded border border-white/15 bg-black/50 px-2 py-1 text-[11px] text-foreground outline-none"
                  >
                    <option value="">— Skip —</option>
                    {PUPPET_SLOT_META.map((m) => (
                      <option key={m.slot} value={m.slot} className="bg-[#161a24]">
                        {m.title}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 bg-black/25 px-5 py-3">
          <span className="text-xs text-muted-foreground">
            {assignedCount} part{assignedCount === 1 ? "" : "s"} assigned
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white/10 px-4 py-1.5 text-xs font-medium hover:bg-white/15"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={assignedCount === 0}
              onClick={handleApply}
              className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-black hover:bg-amber-400 disabled:opacity-40"
            >
              Apply Assigned Cut-Outs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
