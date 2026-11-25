import React, { useState } from "react";
import { X, Layers, Scissors, PersonStanding, FilePlus2 } from "lucide-react";
import type { PuppetStore } from "@/lib/puppetModel";

interface NewPuppetModalProps {
  open: boolean;
  onClose: () => void;
  store: PuppetStore;
  onOpenPSD: () => void;
  onOpenSheet: () => void;
}

export function NewPuppetModal({
  open,
  onClose,
  store,
  onOpenPSD,
  onOpenSheet,
}: NewPuppetModalProps) {
  const [name, setName] = useState("My Puppet");

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-white/15 bg-[#151922] text-foreground shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5">
          <h2 className="text-sm font-semibold">Create New Puppet</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Character Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Puppet"
              className="w-full rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm text-foreground outline-none focus:border-cyan-400"
            />
          </div>

          <div className="grid gap-2">
            <button
              type="button"
              onClick={() => {
                store.resetToBlankPuppet(name.trim() || "New Puppet");
                onClose();
                onOpenPSD();
              }}
              className="flex items-center gap-3 rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3 text-left transition hover:bg-cyan-500/20"
            >
              <Layers className="h-5 w-5 shrink-0 text-cyan-300" />
              <div>
                <div className="text-xs font-semibold">Import Photoshop (.PSD)</div>
                <div className="text-[11px] text-muted-foreground">
                  Auto-map layers &amp; rig joint pins 1:1 from a multi-layer PSD
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                store.resetToBlankPuppet(name.trim() || "New Puppet");
                onClose();
                onOpenSheet();
              }}
              className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-left transition hover:bg-amber-500/20"
            >
              <Scissors className="h-5 w-5 shrink-0 text-amber-300" />
              <div>
                <div className="text-xs font-semibold">Slice Paper Puppet Sheet</div>
                <div className="text-[11px] text-muted-foreground">
                  Auto-cut parts from a drawn or scanned PNG/JPG character sheet
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                store.resetToDemoHuman();
                store.updateRig((p) => ({
                  ...p,
                  characterName: name.trim() || "Demo Character",
                }));
                onClose();
              }}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-left transition hover:bg-white/10"
            >
              <PersonStanding className="h-5 w-5 shrink-0 text-sky-300" />
              <div>
                <div className="text-xs font-semibold">Start From Demo Character</div>
                <div className="text-[11px] text-muted-foreground">
                  Pre-rigged full-body puppet with eyes, visemes, arms &amp; legs
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                store.resetToBlankPuppet(name.trim() || "New Puppet");
                onClose();
              }}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-left transition hover:bg-white/10"
            >
              <FilePlus2 className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div>
                <div className="text-xs font-semibold">Blank Puppet</div>
                <div className="text-[11px] text-muted-foreground">
                  Empty rig — upload individual PNGs for each body part
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
