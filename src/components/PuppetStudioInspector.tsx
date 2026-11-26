import React, { useRef, useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  Upload,
  Copy,
  Trash2,
  RotateCcw,
  Layers,
  Scissors,
  FolderOpen,
  Save,
  FilePlus2,
  FlipHorizontal2,
  FlipVertical2,
  Sliders,
  Pin,
} from "lucide-react";
import {
  ALL_PUPPET_SLOTS,
  PUPPET_CATEGORIES,
  PUPPET_SLOT_META,
  SLOT_META_BY_ID,
  STAGE_LAYER_SLOTS,
  type EyeAnimationMode,
  type MouthAnimationMode,
  type PuppetPartSlot,
  type PuppetStore,
} from "@/lib/puppetModel";

interface PuppetStudioInspectorProps {
  store: PuppetStore;
  onOpenNew: () => void;
  onOpenPSD: () => void;
  onOpenSheet: () => void;
}

export function PuppetStudioInspector({
  store,
  onOpenNew,
  onOpenPSD,
  onOpenSheet,
}: PuppetStudioInspectorProps) {
  const [tab, setTab] = useState<"rigging" | "proportions">("rigging");
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);
  const partFileInputRef = useRef<HTMLInputElement | null>(null);
  const rigFileInputRef = useRef<HTMLInputElement | null>(null);
  const pinCanvasRef = useRef<HTMLDivElement | null>(null);
  const draggingPinRef = useRef<string | null>(null);

  const { rig, selectedSlot, setSelectedSlot, selectedCategory, setSelectedCategory } = store;
  const selectedMeta = SLOT_META_BY_ID[selectedSlot];
  const selectedDataUrl = rig.partDataUrls[selectedSlot];
  const selectedPins = rig.pinsBySlot[selectedSlot] ?? [];
  const isStageSlot = STAGE_LAYER_SLOTS.includes(selectedSlot);

  const categorySlots = PUPPET_SLOT_META.filter((m) => m.category === selectedCategory);
  const slotsWithImages = ALL_PUPPET_SLOTS.filter(
    (s) => s !== selectedSlot && Boolean(rig.partDataUrls[s]),
  );

  const handleUploadPartImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        store.setPartImage(selectedSlot, reader.result, file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleImportRigFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await store.importCharacterFile(file);
    } catch (err) {
      alert(`Could not load puppet file: ${(err as Error).message}`);
    }
  };

  const updatePinFromPointer = (clientX: number, clientY: number, pinId: string) => {
    const box = pinCanvasRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0 || box.height <= 0) return;
    const u = (clientX - box.left) / box.width;
    const v = (clientY - box.top) / box.height;
    store.updatePin(selectedSlot, pinId, u, v, false);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card/60 backdrop-blur">
      {/* Hidden file inputs */}
      <input
        ref={partFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleUploadPartImage}
        className="hidden"
      />
      <input
        ref={rigFileInputRef}
        type="file"
        accept=".json,.puppet.json"
        onChange={handleImportRigFile}
        className="hidden"
      />

      {/* Character File Action Bar */}
      <div className="border-b border-border/50 bg-[#12161e] p-2.5">
        <div className="mb-2 flex items-center gap-1.5">
          <input
            type="text"
            value={rig.characterName}
            onChange={(e) =>
              store.updateRig((p) => ({ ...p, characterName: e.target.value }))
            }
            className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-2.5 py-1 text-xs font-semibold text-foreground outline-none focus:border-cyan-400"
            placeholder="Character Name"
          />
          <button
            type="button"
            onClick={onOpenNew}
            className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium hover:bg-white/15"
            title="New Puppet (Ctrl/⌘N)"
          >
            <FilePlus2 className="h-3 w-3 text-cyan-300" />
            New
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={onOpenPSD}
            className="inline-flex items-center justify-center gap-1 rounded-md bg-cyan-500/15 px-2 py-1 font-medium text-cyan-300 hover:bg-cyan-500/25"
            title="Import multi-layer Photoshop (.PSD)"
          >
            <Layers className="h-3 w-3" />
            PSD
          </button>
          <button
            type="button"
            onClick={onOpenSheet}
            className="inline-flex items-center justify-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 font-medium text-amber-300 hover:bg-amber-500/25"
            title="Slice Paper Puppet Sheet"
          >
            <Scissors className="h-3 w-3" />
            Sheet
          </button>
          <button
            type="button"
            onClick={() => rigFileInputRef.current?.click()}
            className="inline-flex items-center justify-center gap-1 rounded-md bg-white/10 px-2 py-1 font-medium hover:bg-white/15"
            title="Open .puppet.json character package (compatible with macOS Native!)"
          >
            <FolderOpen className="h-3 w-3" />
            Load
          </button>
          <button
            type="button"
            onClick={() => store.exportCharacterPackage(true)}
            className="inline-flex items-center justify-center gap-1 rounded-md bg-emerald-500/20 px-2 py-1 font-medium text-emerald-300 hover:bg-emerald-500/30"
            title="Save .puppet.json character package (Ctrl/⌘S)"
          >
            <Save className="h-3 w-3" />
            Save
          </button>
        </div>
      </div>

      {/* 2-Tab Switcher */}
      <div className="grid grid-cols-2 border-b border-border/50 bg-black/20 p-1 text-xs">
        <button
          type="button"
          onClick={() => setTab("rigging")}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition ${
            tab === "rigging"
              ? "bg-cyan-500/20 text-cyan-300"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Pin className="h-3.5 w-3.5" />
          Rigging &amp; Sprites
        </button>
        <button
          type="button"
          onClick={() => setTab("proportions")}
          className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-medium transition ${
            tab === "proportions"
              ? "bg-cyan-500/20 text-cyan-300"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          Proportions &amp; Motion
        </button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-3 text-xs">
        {tab === "rigging" ? (
          <div className="space-y-3">
            {/* Category Pills */}
            <div className="grid grid-cols-3 gap-1">
              {PUPPET_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setSelectedCategory(cat.id);
                    const first = PUPPET_SLOT_META.find((m) => m.category === cat.id);
                    if (first) setSelectedSlot(first.slot);
                  }}
                  className={`rounded-md px-2 py-1.5 text-[11px] font-medium transition ${
                    selectedCategory === cat.id
                      ? "bg-cyan-500 text-black font-semibold"
                      : "bg-white/8 text-muted-foreground hover:bg-white/12 hover:text-foreground"
                  }`}
                >
                  {cat.shortLabel}
                </button>
              ))}
            </div>

            {/* Part Slots List */}
            <div className="max-h-[190px] space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/25 p-1.5">
              {categorySlots.map((m) => {
                const isSel = selectedSlot === m.slot;
                const enabled = rig.partEnabled[m.slot];
                const thumb = rig.partDataUrls[m.slot];
                const layerIdx = rig.layerStack.indexOf(m.slot);
                return (
                  <div
                    key={m.slot}
                    onClick={() => {
                      setSelectedSlot(m.slot);
                      store.setShowStageTransformBox(true);
                      setCopyMenuOpen(false);
                    }}
                    className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 transition ${
                      isSel
                        ? "bg-cyan-500/20 ring-1 ring-cyan-400/50"
                        : "hover:bg-white/8"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(enabled)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        store.updateRig(
                          (p) => ({
                            ...p,
                            partEnabled: { ...p.partEnabled, [m.slot]: e.target.checked },
                          }),
                          true,
                        )
                      }
                      className="accent-cyan-400"
                    />
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border border-white/10 bg-black/40">
                      {thumb ? (
                        <img src={thumb} alt={m.title} className="max-h-6 max-w-6 object-contain" />
                      ) : (
                        <span className="text-[9px] text-muted-foreground">—</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-medium text-foreground">
                        {m.title}
                      </div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        {rig.partFileNames[m.slot] || "Empty"}
                      </div>
                    </div>

                    {layerIdx >= 0 && (
                      <div
                        className="flex items-center gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => store.moveLayerForward(m.slot)}
                          disabled={layerIdx === 0}
                          className="rounded p-0.5 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-25"
                          title="Bring Forward (closer to camera)"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => store.moveLayerBackward(m.slot)}
                          disabled={layerIdx === rig.layerStack.length - 1}
                          className="rounded p-0.5 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-25"
                          title="Send Backward (behind body)"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Selected Part Sprite Actions */}
            <div className="rounded-xl border border-white/10 bg-black/25 p-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-foreground">{selectedMeta.title}</span>
                {isStageSlot && (
                  <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-300">
                    Layer #{rig.layerStack.indexOf(selectedSlot) + 1}
                  </span>
                )}
              </div>
              <p className="mb-2 text-[10px] text-muted-foreground">{selectedMeta.subtitle}</p>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => partFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1 rounded-md bg-cyan-500/20 px-2.5 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/30"
                >
                  <Upload className="h-3 w-3" />
                  Replace PNG…
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setCopyMenuOpen((v) => !v)}
                    disabled={slotsWithImages.length === 0}
                    className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 text-[11px] font-medium hover:bg-white/15 disabled:opacity-35"
                  >
                    <Copy className="h-3 w-3" />
                    Copy From Part…
                  </button>
                  {copyMenuOpen && (
                    <div className="absolute left-0 top-full z-30 mt-1 max-h-48 w-44 overflow-y-auto rounded-lg border border-white/15 bg-[#161b26] p-1 shadow-xl">
                      {slotsWithImages.map((srcSlot) => (
                        <button
                          key={srcSlot}
                          type="button"
                          onClick={() => {
                            store.copyPartImage(srcSlot, selectedSlot);
                            setCopyMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] hover:bg-cyan-500/20"
                        >
                          <img
                            src={rig.partDataUrls[srcSlot]}
                            alt=""
                            className="h-4 w-4 object-contain"
                          />
                          <span className="truncate">{SLOT_META_BY_ID[srcSlot].title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedDataUrl && (
                  <button
                    type="button"
                    onClick={() => store.clearPartImage(selectedSlot)}
                    className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/25"
                    title="Remove graphic from this slot"
                  >
                    <Trash2 className="h-3 w-3" />
                    Clear
                  </button>
                )}
              </div>

              {/* Interactive Pin Rigging Canvas */}
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Drag pins to rig joints • Double-click pin to reset</span>
                  <button
                    type="button"
                    onClick={store.resetAllPins}
                    className="inline-flex items-center gap-0.5 text-cyan-300 hover:underline"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    Reset Pins
                  </button>
                </div>

                <div className="flex justify-center rounded-lg border border-white/10 bg-[repeating-conic-gradient(#232834_0%_25%,#181c26_0%_50%)] bg-[length:12px_12px] p-2">
                  <div
                    ref={pinCanvasRef}
                    onPointerMove={(e) => {
                      if (draggingPinRef.current) {
                        updatePinFromPointer(e.clientX, e.clientY, draggingPinRef.current);
                      }
                    }}
                    onPointerUp={() => {
                      draggingPinRef.current = null;
                    }}
                    onPointerLeave={() => {
                      draggingPinRef.current = null;
                    }}
                    className="relative h-44 w-44 select-none"
                  >
                    {selectedDataUrl ? (
                      <img
                        src={selectedDataUrl}
                        alt={selectedMeta.title}
                        draggable={false}
                        className="h-full w-full object-contain pointer-events-none"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[11px] text-muted-foreground">
                        No graphic loaded
                      </div>
                    )}

                    {/* Draggable Rig Pins */}
                    {selectedPins.map((pin) => {
                      const active = store.selectedPinId === pin.id;
                      return (
                        <div
                          key={pin.id}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            (e.target as HTMLElement).setPointerCapture(e.pointerId);
                            draggingPinRef.current = pin.id;
                            store.setSelectedPinId(pin.id);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            store.resetSinglePin(selectedSlot, pin.id);
                          }}
                          style={{
                            left: `${pin.x * 100}%`,
                            top: `${pin.y * 100}%`,
                          }}
                          title={`${pin.name} (${pin.trackedSourceLabel}) — Double-click to reset`}
                          className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 transition-transform ${
                            active
                              ? "z-20 h-4 w-4 scale-110 border-white bg-amber-400 shadow-lg"
                              : "z-10 h-3.5 w-3.5 border-black bg-cyan-400 hover:scale-110"
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Selected Pin Legend */}
                {selectedPins.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {selectedPins.map((pin) => (
                      <button
                        key={pin.id}
                        type="button"
                        onClick={() => store.setSelectedPinId(pin.id)}
                        onDoubleClick={() => store.resetSinglePin(selectedSlot, pin.id)}
                        className={`rounded px-1.5 py-0.5 text-[10px] ${
                          store.selectedPinId === pin.id
                            ? "bg-amber-400/25 text-amber-200"
                            : "bg-white/5 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {pin.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Per-Part Transform Controls */}
              <div className="mt-3 space-y-2 border-t border-white/10 pt-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-muted-foreground">
                    Part Transform
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        store.updateRig(
                          (p) => ({
                            ...p,
                            partFlipH: {
                              ...p.partFlipH,
                              [selectedSlot]: !p.partFlipH[selectedSlot],
                            },
                          }),
                          true,
                        )
                      }
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
                        rig.partFlipH[selectedSlot]
                          ? "bg-cyan-500 text-black font-semibold"
                          : "bg-white/8 text-muted-foreground"
                      }`}
                    >
                      <FlipHorizontal2 className="h-3 w-3" />
                      Flip H
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        store.updateRig(
                          (p) => ({
                            ...p,
                            partFlipV: {
                              ...p.partFlipV,
                              [selectedSlot]: !p.partFlipV[selectedSlot],
                            },
                          }),
                          true,
                        )
                      }
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${
                        rig.partFlipV[selectedSlot]
                          ? "bg-cyan-500 text-black font-semibold"
                          : "bg-white/8 text-muted-foreground"
                      }`}
                    >
                      <FlipVertical2 className="h-3 w-3" />
                      Flip V
                    </button>
                    <button
                      type="button"
                      onClick={() => store.resetPartTransform(selectedSlot)}
                      className="inline-flex items-center gap-0.5 rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-cyan-300"
                      title="Reset part scale, rotation, flip & offset"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      Reset
                    </button>
                  </div>
                </div>

                <CompactSlider
                  label="Width"
                  value={rig.partWidthScale[selectedSlot] ?? 1}
                  min={0.25}
                  max={3.5}
                  step={0.02}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) =>
                    store.updateRig((p) => ({
                      ...p,
                      partWidthScale: { ...p.partWidthScale, [selectedSlot]: v },
                    }))
                  }
                />
                <CompactSlider
                  label="Height"
                  value={rig.partHeightScale[selectedSlot] ?? 1}
                  min={0.25}
                  max={3.5}
                  step={0.02}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) =>
                    store.updateRig((p) => ({
                      ...p,
                      partHeightScale: { ...p.partHeightScale, [selectedSlot]: v },
                    }))
                  }
                />
                <CompactSlider
                  label="Rotate"
                  value={rig.partRotationOffset[selectedSlot] ?? 0}
                  min={-180}
                  max={180}
                  step={1}
                  format={(v) => `${Math.round(v)}°`}
                  onChange={(v) =>
                    store.updateRig((p) => ({
                      ...p,
                      partRotationOffset: { ...p.partRotationOffset, [selectedSlot]: v },
                    }))
                  }
                />
              </div>
            </div>
          </div>
        ) : (
          /* Proportions & Motion Tab */
          <div className="space-y-4">
            <SectionCard title="Character Proportions">
              <CompactSlider
                label="Character Scale"
                value={rig.characterScale}
                min={0.14}
                max={0.65}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, characterScale: v }))}
              />
              <CompactSlider
                label="Hand Scale"
                value={rig.handScale}
                min={0.06}
                max={0.4}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, handScale: v }))}
              />
              <CompactSlider
                label="Arm Length"
                value={rig.armLengthScale}
                min={0.5}
                max={1.8}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, armLengthScale: v }))}
              />
              <CompactSlider
                label="Arm Thickness"
                value={rig.armThicknessScale}
                min={0.5}
                max={1.8}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, armThicknessScale: v }))}
              />
              <CompactSlider
                label="Arm Reach Boost"
                value={rig.armReachExaggeration}
                min={0}
                max={1.0}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, armReachExaggeration: v }))}
              />
              <CompactSlider
                label="Leg Length"
                value={rig.legLengthScale}
                min={0.5}
                max={1.8}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, legLengthScale: v }))}
              />
              <CompactSlider
                label="Leg Thickness"
                value={rig.legThicknessScale}
                min={0.5}
                max={1.8}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, legThicknessScale: v }))}
              />
            </SectionCard>

            <SectionCard title="Face Feature Sizes">
              <CompactSlider
                label="Eyes Scale"
                value={rig.eyeSpriteScale}
                min={0.3}
                max={2.4}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, eyeSpriteScale: v }))}
              />
              <CompactSlider
                label="Nose Scale"
                value={rig.noseSpriteScale}
                min={0.3}
                max={2.4}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, noseSpriteScale: v }))}
              />
              <CompactSlider
                label="Mouth Scale"
                value={rig.mouthSpriteScale}
                min={0.3}
                max={2.4}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, mouthSpriteScale: v }))}
              />
            </SectionCard>

            <SectionCard title="Head & Expression Motion">
              <CompactSlider
                label="Head Move"
                value={rig.headMoveAmount}
                min={0}
                max={2}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, headMoveAmount: v }))}
              />
              <CompactSlider
                label="Head Tilt"
                value={rig.headTiltAmount}
                min={0}
                max={2}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, headTiltAmount: v }))}
              />
              <CompactSlider
                label="2.5D Turn Parallax"
                value={rig.headTurnParallax}
                min={0}
                max={2}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, headTurnParallax: v }))}
              />
              <CompactSlider
                label="Depth Scale"
                value={rig.headScaleAmount}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, headScaleAmount: v }))}
              />
              <CompactSlider
                label="Jaw Warp"
                value={rig.jawWarpAmount}
                min={0}
                max={1.2}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, jawWarpAmount: v }))}
              />
              <CompactSlider
                label="Brow Lift"
                value={rig.browWarpAmount}
                min={0}
                max={1.5}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => store.updateRig((p) => ({ ...p, browWarpAmount: v }))}
              />
            </SectionCard>

            <SectionCard title="Animation Modes & Rig Behavior">
              <div className="space-y-2">
                <div>
                  <label className="mb-1 block text-[10px] text-muted-foreground">
                    Eye Blink / Wink Mode
                  </label>
                  <select
                    value={rig.eyeAnimationMode}
                    onChange={(e) =>
                      store.updateRig((p) => ({
                        ...p,
                        eyeAnimationMode: e.target.value as EyeAnimationMode,
                      }))
                    }
                    className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px]"
                  >
                    <option value="hybrid" className="bg-[#161a24]">
                      Hybrid: Open/Closed Sprites + Squash
                    </option>
                    <option value="sprite" className="bg-[#161a24]">
                      Sprite Swap Only
                    </option>
                    <option value="squash" className="bg-[#161a24]">
                      Auto-Squash Single Eye
                    </option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-[10px] text-muted-foreground">
                    Mouth / Lip-Sync Mode
                  </label>
                  <select
                    value={rig.mouthAnimationMode}
                    onChange={(e) =>
                      store.updateRig((p) => ({
                        ...p,
                        mouthAnimationMode: e.target.value as MouthAnimationMode,
                      }))
                    }
                    className="w-full rounded border border-white/15 bg-black/40 px-2 py-1 text-[11px]"
                  >
                    <option value="hybrid" className="bg-[#161a24]">
                      Hybrid: Viseme Sprites + Jaw Warp
                    </option>
                    <option value="sprites" className="bg-[#161a24]">
                      Viseme Sprite Swap Only
                    </option>
                    <option value="warp" className="bg-[#161a24]">
                      Single Head Image Jaw Warp Only
                    </option>
                  </select>
                </div>

                <CompactSlider
                  label="Blink Threshold"
                  value={rig.blinkThreshold}
                  min={0.12}
                  max={0.75}
                  step={0.02}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => store.updateRig((p) => ({ ...p, blinkThreshold: v }))}
                />

                <ToggleRow
                  label="Periodic Natural Auto-Blink"
                  checked={rig.autoBlinkEnabled}
                  onChange={(v) => store.updateRig((p) => ({ ...p, autoBlinkEnabled: v }))}
                />
                <ToggleRow
                  label="Dynamic Palm Flip (Back-of-Hand)"
                  checked={rig.dynamicPalmFlip}
                  onChange={(v) => store.updateRig((p) => ({ ...p, dynamicPalmFlip: v }))}
                />
                <ToggleRow
                  label="Lower Jaw Stretch Warp"
                  checked={rig.jawWarpEnabled}
                  onChange={(v) => store.updateRig((p) => ({ ...p, jawWarpEnabled: v }))}
                />
                <ToggleRow
                  label="Show Full Body Legs"
                  checked={rig.showFullBodyLegs}
                  onChange={(v) => store.updateRig((p) => ({ ...p, showFullBodyLegs: v }))}
                />
              </div>
            </SectionCard>
          </div>
        )}
      </div>

      {/* Status Footer */}
      <div className="border-t border-border/50 bg-black/30 px-3 py-1.5 text-[10px] text-muted-foreground">
        {store.statusMessage}
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-black/25 p-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-cyan-300/90">
        {title}
      </div>
      {children}
    </div>
  );
}

function CompactSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer accent-cyan-400"
      />
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between py-0.5 text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-cyan-400"
      />
    </label>
  );
}
