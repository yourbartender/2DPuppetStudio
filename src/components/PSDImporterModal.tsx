import React, { useRef, useState } from "react";
import { X, Upload, Layers, Check, Plus, Trash2 } from "lucide-react";
import {
  ALL_PUPPET_SLOTS,
  PUPPET_CATEGORIES,
  PUPPET_SLOT_META,
  SLOT_META_BY_ID,
  type PuppetPartSlot,
  type PuppetStore,
} from "@/lib/puppetModel";
import {
  applyPSDLayersToRig,
  parsePSD,
  type ParsedPSD,
} from "@/lib/psdImporter";

interface PSDImporterModalProps {
  open: boolean;
  onClose: () => void;
  store: PuppetStore;
  cachedPSD: ParsedPSD | null;
  setCachedPSD: (psd: ParsedPSD | null) => void;
  cachedSlots: Record<string, PuppetPartSlot[]>;
  setCachedSlots: React.Dispatch<React.SetStateAction<Record<string, PuppetPartSlot[]>>>;
  cachedEnabled: Record<string, boolean>;
  setCachedEnabled: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}

export function PSDImporterModal({
  open,
  onClose,
  store,
  cachedPSD,
  setCachedPSD,
  cachedSlots,
  setCachedSlots,
  cachedEnabled,
  setCachedEnabled,
}: PSDImporterModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [clearUnmapped, setClearUnmapped] = useState(true);
  const [addingForLayerId, setAddingForLayerId] = useState<string | null>(null);

  if (!open) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setParsing(true);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parsePSD(buf, file.name);
      const initSlots: Record<string, PuppetPartSlot[]> = {};
      const initEnabled: Record<string, boolean> = {};
      for (const layer of parsed.layers) {
        initSlots[layer.id] = layer.suggestedSlot ? [layer.suggestedSlot] : [];
        initEnabled[layer.id] = layer.visible && Boolean(layer.suggestedSlot);
      }
      setCachedPSD(parsed);
      setCachedSlots(initSlots);
      setCachedEnabled(initEnabled);
    } catch (err) {
      setError((err as Error).message || "Failed to parse PSD file.");
    } finally {
      setParsing(false);
    }
  };

  const toggleSlotForLayer = (layerId: string, slot: PuppetPartSlot) => {
    setCachedSlots((prev) => {
      const cur = prev[layerId] ?? [];
      const exists = cur.includes(slot);
      const next = exists ? cur.filter((s) => s !== slot) : [...cur, slot];
      return { ...prev, [layerId]: next };
    });
    setCachedEnabled((prev) => ({ ...prev, [layerId]: true }));
  };

  const handleApply = () => {
    if (!cachedPSD) return;
    store.updateRig(
      (prev) =>
        applyPSDLayersToRig(prev, cachedPSD, cachedSlots, cachedEnabled, clearUnmapped),
      true,
    );
    onClose();
  };

  const mappedLayerCount = cachedPSD
    ? cachedPSD.layers.filter(
        (l) => cachedEnabled[l.id] && (cachedSlots[l.id]?.length ?? 0) > 0,
      ).length
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#151922] text-foreground shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Photoshop (.PSD) Character Importer</h2>
              <p className="text-xs text-muted-foreground">
                Maps layers to body parts, aligns visemes/eyes &amp; auto-rigs joint pins 1:1
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

        {/* File Picker Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-black/25 px-5 py-3">
          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".psd"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3.5 py-1.5 text-xs font-semibold text-black transition hover:bg-cyan-400"
            >
              <Upload className="h-3.5 w-3.5" />
              {cachedPSD ? "Load Different .PSD…" : "Choose .PSD File…"}
            </button>
            {cachedPSD && (
              <span className="text-xs text-muted-foreground">
                <strong className="text-foreground">{cachedPSD.fileName}</strong> •{" "}
                {cachedPSD.canvasWidth}×{cachedPSD.canvasHeight}px • {cachedPSD.layers.length}{" "}
                layers
              </span>
            )}
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={clearUnmapped}
              onChange={(e) => setClearUnmapped(e.target.checked)}
              className="accent-cyan-400"
            />
            Replace existing character (clear unmapped parts)
          </label>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {error && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}

          {parsing && (
            <div className="py-12 text-center text-sm text-cyan-300">
              Decoding Photoshop layers &amp; PackBits channels…
            </div>
          )}

          {!parsing && !cachedPSD && (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/20 py-16 text-center">
              <Layers className="mb-3 h-10 w-10 text-cyan-400/70" />
              <p className="text-sm font-medium">Select an 8-bit RGB Photoshop (.PSD) file</p>
              <p className="mt-1 max-w-md text-xs text-muted-foreground">
                Layers named in English or Finnish (Head/Pää, Eye/Silmä, Mouth/Suu, Torso/Vartalo,
                Hand/Käsi, Kämmenselkä, Thigh/Reisi, Tail/Häntä) are auto-assigned and auto-pinned.
                One layer can also be assigned to multiple slots!
              </p>
            </div>
          )}

          {!parsing && cachedPSD && (
            <div className="space-y-2">
              {cachedPSD.layers.map((layer) => {
                const assigned = cachedSlots[layer.id] ?? [];
                const enabled = Boolean(cachedEnabled[layer.id]);
                const isPicking = addingForLayerId === layer.id;

                return (
                  <div
                    key={layer.id}
                    className={`rounded-xl border p-2.5 transition ${
                      enabled && assigned.length > 0
                        ? "border-cyan-500/35 bg-cyan-500/5"
                        : "border-white/10 bg-black/20"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) =>
                          setCachedEnabled((p) => ({ ...p, [layer.id]: e.target.checked }))
                        }
                        className="h-4 w-4 accent-cyan-400"
                      />

                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-[repeating-conic-gradient(#262b36_0%_25%,#1b1f29_0%_50%)] bg-[length:10px_10px]">
                        <img
                          src={layer.dataUrl}
                          alt={layer.name}
                          className="max-h-11 max-w-11 object-contain"
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-xs font-semibold text-foreground">
                            {layer.name}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {layer.width}×{layer.height}
                          </span>
                          {!layer.visible && (
                            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              Hidden in PSD
                            </span>
                          )}
                        </div>

                        {/* Assigned slot pills */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {assigned.map((slot) => (
                            <span
                              key={slot}
                              className="inline-flex items-center gap-1 rounded-full bg-cyan-500/20 px-2 py-0.5 text-[11px] font-medium text-cyan-200"
                            >
                              {SLOT_META_BY_ID[slot].title}
                              <button
                                type="button"
                                onClick={() => toggleSlotForLayer(layer.id, slot)}
                                className="ml-0.5 rounded-full hover:text-white"
                                title="Remove slot assignment"
                              >
                                ×
                              </button>
                            </span>
                          ))}

                          <button
                            type="button"
                            onClick={() =>
                              setAddingForLayerId(isPicking ? null : layer.id)
                            }
                            className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-white/10 hover:text-foreground"
                          >
                            <Plus className="h-3 w-3" />
                            {assigned.length === 0 ? "Assign Part…" : "Add Slot…"}
                          </button>

                          {assigned.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setCachedSlots((p) => ({ ...p, [layer.id]: [] }))
                              }
                              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-red-300"
                              title="Clear all assignments"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Inline multi-slot picker panel */}
                    {isPicking && (
                      <div className="mt-2.5 grid gap-2 rounded-lg border border-white/10 bg-[#0e1118] p-3 md:grid-cols-3">
                        {PUPPET_CATEGORIES.map((cat) => (
                          <div key={cat.id}>
                            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              {cat.shortLabel}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {PUPPET_SLOT_META.filter((m) => m.category === cat.id).map(
                                (m) => {
                                  const active = assigned.includes(m.slot);
                                  return (
                                    <button
                                      key={m.slot}
                                      type="button"
                                      onClick={() => toggleSlotForLayer(layer.id, m.slot)}
                                      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition ${
                                        active
                                          ? "bg-cyan-500 font-semibold text-black"
                                          : "bg-white/8 text-muted-foreground hover:bg-white/15 hover:text-foreground"
                                      }`}
                                    >
                                      {active && <Check className="h-2.5 w-2.5" />}
                                      {m.title}
                                    </button>
                                  );
                                },
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-white/10 bg-black/25 px-5 py-3">
          <span className="text-xs text-muted-foreground">
            {mappedLayerCount} layer{mappedLayerCount === 1 ? "" : "s"} ready to import (
            {ALL_PUPPET_SLOTS.length} puppet slots supported)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white/10 px-4 py-1.5 text-xs font-medium text-foreground hover:bg-white/15"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!cachedPSD || mappedLayerCount === 0}
              onClick={handleApply}
              className="rounded-lg bg-cyan-500 px-4 py-1.5 text-xs font-semibold text-black transition hover:bg-cyan-400 disabled:opacity-40"
            >
              Import &amp; Auto-Rig Puppet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
