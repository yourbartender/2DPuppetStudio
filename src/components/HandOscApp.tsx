import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useHolisticTracker,
  type TrackerSettings,
  type MappingMode,
} from "@/hooks/useHolisticTracker";
import { faceTierLabel, type FaceTier } from "@/lib/faceSubsets";
import {
  getNdiStatus,
  isElectron,
  startNdiOutput,
  stopNdiOutput,
  type NdiBackgroundMode,
  type NdiStatus,
} from "@/lib/oscBridge";
import {
  STAGE_BACKGROUNDS,
  usePuppetStore,
  type PuppetPartSlot,
  type PuppetStageBackground,
} from "@/lib/puppetModel";
import type { ParsedPSD } from "@/lib/psdImporter";
import { PuppetStageCanvas } from "@/components/PuppetStageCanvas";
import { PuppetStudioInspector } from "@/components/PuppetStudioInspector";
import { PSDImporterModal } from "@/components/PSDImporterModal";
import { SheetImporterModal } from "@/components/SheetImporterModal";
import { NewPuppetModal } from "@/components/NewPuppetModal";
import {
  Hand,
  Radio,
  Activity,
  Power,
  PersonStanding,
  Smile,
  Columns2,
  Theater,
  Maximize2,
  Camera,
  Undo2,
  Redo2,
  Video,
  Image as ImageIcon,
  Play,
  Pause,
  Eye,
  EyeOff,
  Layers,
  FolderOpen,
  Save,
  Cast,
} from "lucide-react";

type WorkspaceMode = "split" | "studio" | "fullStage" | "cameraOsc";

export function HandOscApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const quickLoadRigRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<WorkspaceMode>("split");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // Full Stage HUD options
  const [showFullStagePip, setShowFullStagePip] = useState(true);
  const [cleanFeed, setCleanFeed] = useState(false);

  // NDI Video Output state (Transparent Alpha BGRA / Chroma / White)
  const [ndiStatus, setNdiStatus] = useState<NdiStatus>({
    available: false,
    enabled: false,
    sourceName: "Puppet Studio",
    framesSent: 0,
    reason: "Checking NDI…",
  });
  const [ndiBgMode, setNdiBgMode] = useState<NdiBackgroundMode>("alpha");

  useEffect(() => {
    getNdiStatus().then(setNdiStatus).catch(() => {});
  }, []);

  const toggleNdi = async () => {
    if (!ndiStatus.available) return;
    if (ndiStatus.enabled) {
      const st = await stopNdiOutput();
      setNdiStatus(st);
    } else {
      const st = await startNdiOutput("Puppet Studio");
      setNdiStatus(st);
    }
  };

  // Modals + remembered PSD cache
  const [showNewModal, setShowNewModal] = useState(false);
  const [showPSDModal, setShowPSDModal] = useState(false);
  const [showSheetModal, setShowSheetModal] = useState(false);
  const [cachedPSD, setCachedPSD] = useState<ParsedPSD | null>(null);
  const [cachedPSDSlots, setCachedPSDSlots] = useState<Record<string, PuppetPartSlot[]>>({});
  const [cachedPSDEnabled, setCachedPSDEnabled] = useState<Record<string, boolean>>({});

  const modalOpen = showNewModal || showPSDModal || showSheetModal;

  const store = usePuppetStore();

  const [settings, setSettings] = useState<TrackerSettings>({
    host: "127.0.0.1",
    port: 9000,
    fps: 60,
    mirror: true,
    smoothMinCutoff: 1.8,
    smoothBeta: 0.17,
    mapping: "centered_aspect",
    screenWidth: typeof window !== "undefined" ? window.screen.width : 1920,
    screenHeight: typeof window !== "undefined" ? window.screen.height : 1080,

    trackHands: true,
    handsSendLandmarks: true,
    handsSendBundled: false,
    handsSendAxisGrouped: true,
    handsSendGesture: true,

    trackPose: true,
    poseSendLandmarks: true,
    poseSendBundled: false,
    poseSendAxisGrouped: true,

    trackFace: true,
    faceTier: "curated",
    faceSendLandmarks: false,
    faceSendBundled: false,
    faceSendAxisGrouped: true,
    faceSendBlendshapes: true,
  });

  // Enumerate cameras
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    const refreshDevices = async () => {
      const all = await navigator.mediaDevices.enumerateDevices();
      const cams = all.filter((d) => d.kind === "videoinput");
      setDevices(cams);
      setDeviceId((prev) => {
        if (prev && cams.some((c) => c.deviceId === prev)) return prev;
        return cams[0]?.deviceId ?? null;
      });
    };
    const load = async () => {
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
        tmp.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      await refreshDevices();
    };
    load();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
    };
  }, []);

  // Global keyboard shortcuts (Undo, Redo, Save, New, Escape Clean Feed)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && cleanFeed) {
        setCleanFeed(false);
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if (
        (e.key.toLowerCase() === "z" && e.shiftKey) ||
        e.key.toLowerCase() === "y"
      ) {
        e.preventDefault();
        store.redo();
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        store.exportCharacterPackage(true);
      } else if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        setShowNewModal(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cleanFeed, store]);

  const tracker = useHolisticTracker(
    videoRef,
    canvasRef,
    deviceId,
    settings,
    running,
    modalOpen,
  );
  const { stats } = tracker;
  const electron = useMemo(() => isElectron(), []);

  const set = <K extends keyof TrackerSettings>(k: K, v: TrackerSettings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));

  const handleLoadVideoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    tracker.loadVideoFile(file);
    if (!running) setRunning(true);
  };

  const handleLoadImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    tracker.loadImageFile(file);
    if (!running) setRunning(true);
  };

  const handleQuickLoadRig = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await store.importCharacterFile(file);
    } catch (err) {
      alert(`Could not load .puppet.json: ${(err as Error).message}`);
    }
  };

  const renderInputSourceBar = (compact = false) => (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      <button
        type="button"
        onClick={() => {
          tracker.switchToCamera();
          if (!running) setRunning(true);
        }}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
          tracker.inputSource === "camera"
            ? "bg-cyan-500 text-black font-semibold"
            : "bg-black/60 text-white/80 hover:bg-black/80"
        }`}
        title="Live Webcam Input"
      >
        <Camera className="h-3 w-3" />
        {!compact && "Camera"}
      </button>
      <button
        type="button"
        onClick={() => videoFileInputRef.current?.click()}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
          tracker.inputSource === "video"
            ? "bg-cyan-500 text-black font-semibold"
            : "bg-black/60 text-white/80 hover:bg-black/80"
        }`}
        title="Track from Reference Video (.mp4 / .mov / .webm)"
      >
        <Video className="h-3 w-3" />
        Video
      </button>
      <button
        type="button"
        onClick={() => imageFileInputRef.current?.click()}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition ${
          tracker.inputSource === "image"
            ? "bg-cyan-500 text-black font-semibold"
            : "bg-black/60 text-white/80 hover:bg-black/80"
        }`}
        title="Track from Still Photo (.png / .jpg)"
      >
        <ImageIcon className="h-3 w-3" />
        Photo
      </button>
      {tracker.inputSource === "video" && (
        <button
          type="button"
          onClick={tracker.toggleVideoPlayPause}
          className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 font-semibold text-black hover:bg-amber-400"
          title={tracker.videoPlaying ? "Pause reference video" : "Play reference video"}
        >
          {tracker.videoPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </button>
      )}
    </div>
  );

  const renderCameraCanvasBox = (className: string, compactOverlay = false) => (
    <div
      className={`relative overflow-hidden rounded-xl border border-border/60 bg-black ${className}`}
    >
      <canvas ref={canvasRef} className="h-full w-full object-contain" />
      {!running && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-3 text-center">
          <Hand className="h-7 w-7 text-cyan-400 opacity-75" />
          <p className="text-xs text-muted-foreground">
            Click <strong className="text-foreground">Start</strong> or pick a Video/Photo to track
          </p>
        </div>
      )}
      {/* Top-left input source controls */}
      <div className="absolute left-2 top-2 z-10">{renderInputSourceBar(compactOverlay)}</div>
      {/* Bottom-left live telemetry badge */}
      {running && !compactOverlay && (
        <div className="absolute bottom-2 left-2 flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded-full bg-black/70 px-2 py-0.5 font-mono text-cyan-300">
            {stats.fps} fps
          </span>
          <span className="rounded-full bg-black/70 px-2 py-0.5 font-mono text-emerald-300">
            H:{stats.hands} P:{stats.poses} F:{stats.faces}
          </span>
          {tracker.mediaFileName && (
            <span className="max-w-[160px] truncate rounded-full bg-black/70 px-2 py-0.5 text-amber-300">
              {tracker.mediaFileName}
            </span>
          )}
        </div>
      )}
    </div>
  );

  const renderOscSidebar = () => (
    <div className="space-y-3 overflow-y-auto pr-0.5">
      {/* Quick Character Actions */}
      <Card className="space-y-2 border-border/60 bg-card/60 p-3.5 backdrop-blur">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
            Character &amp; Rig
          </span>
          <span className="max-w-[140px] truncate text-[11px] text-muted-foreground">
            {store.rig.characterName}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => setShowPSDModal(true)}
            className="inline-flex items-center justify-center gap-1 rounded-md bg-cyan-500/15 px-2 py-1.5 font-medium text-cyan-300 hover:bg-cyan-500/25"
          >
            <Layers className="h-3 w-3" />
            Import PSD
          </button>
          <button
            type="button"
            onClick={() => quickLoadRigRef.current?.click()}
            className="inline-flex items-center justify-center gap-1 rounded-md bg-white/10 px-2 py-1.5 font-medium hover:bg-white/15"
          >
            <FolderOpen className="h-3 w-3" />
            Load Rig
          </button>
          <button
            type="button"
            onClick={() => store.exportCharacterPackage(true)}
            className="inline-flex items-center justify-center gap-1 rounded-md bg-emerald-500/20 px-2 py-1.5 font-medium text-emerald-300 hover:bg-emerald-500/30"
          >
            <Save className="h-3 w-3" />
            Save Rig
          </button>
        </div>
      </Card>

      {/* Live Face Expression Meters */}
      <Card className="space-y-2 border-border/60 bg-card/60 p-3.5 backdrop-blur">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Smile className="h-3.5 w-3.5 text-cyan-400" />
            Face &amp; Expressions
          </span>
          <Switch checked={settings.trackFace} onCheckedChange={(v) => set("trackFace", v)} />
        </div>
        <div className="space-y-1.5 text-[11px]">
          <MeterRow label="Mouth Open" value={stats.faceSummary.mouthOpen} color="bg-amber-400" />
          <MeterRow label="Smile" value={stats.faceSummary.mouthSmile} color="bg-emerald-400" />
          <MeterRow label="Pucker (Oh)" value={stats.faceSummary.mouthPucker} color="bg-pink-400" />
          <MeterRow label="Brows Raise" value={stats.faceSummary.browRaise} color="bg-sky-400" />
          <div className="grid grid-cols-2 gap-2 pt-0.5">
            <MeterRow label="L Blink" value={stats.faceSummary.eyeBlinkL} color="bg-cyan-400" />
            <MeterRow label="R Blink" value={stats.faceSummary.eyeBlinkR} color="bg-cyan-400" />
          </div>
        </div>
      </Card>

      {/* OSC Target */}
      <Card className="space-y-3 border-border/60 bg-card/60 p-3.5 backdrop-blur">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            OSC Target (UDP)
          </span>
          <span className="font-mono text-[10px] text-emerald-300">
            {stats.msgsPerSec} msg/s
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2 space-y-1">
            <Label className="text-[11px]">Host</Label>
            <Input
              value={settings.host}
              onChange={(e) => set("host", e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Port</Label>
            <Input
              type="number"
              value={settings.port}
              onChange={(e) => set("port", Number(e.target.value) || 9000)}
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-[11px]">
            <Label className="text-[11px]">OSC Send Rate</Label>
            <span className="font-mono text-muted-foreground">{settings.fps} Hz</span>
          </div>
          <Slider
            value={[settings.fps]}
            min={10}
            max={60}
            step={5}
            onValueChange={([v]) => set("fps", v)}
          />
        </div>
      </Card>

      {/* Tracking Modules (Hands / Pose / Face OSC outputs) */}
      <Card className="space-y-3 border-border/60 bg-card/60 p-3.5 backdrop-blur">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Tracking &amp; OSC Streams
        </span>

        <div className="space-y-2 border-b border-border/40 pb-2.5 text-xs">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-medium">
              <Hand className="h-3.5 w-3.5 text-cyan-400" />
              Hands (2 × 21 pts)
            </span>
            <Switch checked={settings.trackHands} onCheckedChange={(v) => set("trackHands", v)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-medium">
              <PersonStanding className="h-3.5 w-3.5 text-sky-400" />
              Full-Body Pose (33 pts)
            </span>
            <Switch checked={settings.trackPose} onCheckedChange={(v) => set("trackPose", v)} />
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 font-medium">
              <Smile className="h-3.5 w-3.5 text-amber-400" />
              Face Blendshapes (52)
            </span>
            <Switch
              checked={settings.faceSendBlendshapes}
              onCheckedChange={(v) => set("faceSendBlendshapes", v)}
            />
          </div>
        </div>

        <div className="space-y-2 text-xs">
          <div className="space-y-1">
            <Label className="text-[11px]">Face Landmark Tier</Label>
            <Select
              value={settings.faceTier}
              onValueChange={(v) => set("faceTier", v as FaceTier)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["off", "essentials", "curated", "detailed", "all"] as FaceTier[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {faceTierLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px]">Camera Device</Label>
            <Select value={deviceId ?? ""} onValueChange={(v) => setDeviceId(v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Default camera" />
              </SelectTrigger>
              <SelectContent>
                {devices.map((d, idx) => (
                  <SelectItem key={d.deviceId || idx} value={d.deviceId}>
                    {d.label || `Camera ${idx + 1}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between pt-1">
            <Label className="text-xs">Mirror Camera</Label>
            <Switch checked={settings.mirror} onCheckedChange={(v) => set("mirror", v)} />
          </div>

          <div className="space-y-1 pt-1">
            <Label className="text-[11px]">OSC Coord Mapping</Label>
            <Select
              value={settings.mapping}
              onValueChange={(v) => set("mapping", v as MappingMode)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="centered_aspect">Centered Aspect (-1..1)</SelectItem>
                <SelectItem value="normalized">Normalized (0..1)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 pt-1">
            <div className="flex justify-between text-[11px]">
              <Label className="text-[11px]">1€ Smoothing Cutoff</Label>
              <span className="font-mono text-muted-foreground">
                {settings.smoothMinCutoff.toFixed(1)} Hz
              </span>
            </div>
            <Slider
              value={[settings.smoothMinCutoff]}
              min={0.3}
              max={6.0}
              step={0.1}
              onValueChange={([v]) => set("smoothMinCutoff", v)}
            />
          </div>
        </div>
      </Card>
    </div>
  );

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gradient-surface text-foreground">
      {/* Hidden persistent video element & media file pickers (never unmount on tab switch!) */}
      <video ref={videoRef} playsInline muted className="hidden" />
      <input
        ref={videoFileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
        onChange={handleLoadVideoFile}
        className="hidden"
      />
      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={handleLoadImageFile}
        className="hidden"
      />
      <input
        ref={quickLoadRigRef}
        type="file"
        accept=".json,.puppet.json"
        onChange={handleQuickLoadRig}
        className="hidden"
      />

      {/* Top Navigation Header (hidden in Clean Feed mode) */}
      {!cleanFeed && (
        <header className="shrink-0 border-b border-border/60 bg-[#12161e]/95 px-4 py-2.5 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* App Branding */}
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-teal-500 text-black shadow-md">
                <Hand className="h-4 w-4" />
              </div>
              <div>
                <h1 className="text-sm font-bold leading-tight tracking-tight">Puppet Studio</h1>
                <p className="text-[10px] text-muted-foreground">
                  2D Animation Rigging, Vision AI &amp; OSC
                </p>
              </div>
            </div>

            {/* 4 Workspace Mode Pills (matches macOS Native) */}
            <nav className="flex items-center gap-1 rounded-xl border border-white/10 bg-black/35 p-1 text-xs">
              <ModePill
                active={mode === "split"}
                onClick={() => setMode("split")}
                icon={<Columns2 className="h-3.5 w-3.5" />}
                label="Split: Camera + Puppet"
              />
              <ModePill
                active={mode === "studio"}
                onClick={() => setMode("studio")}
                icon={<Theater className="h-3.5 w-3.5" />}
                label="2D Puppet Studio"
              />
              <ModePill
                active={mode === "fullStage"}
                onClick={() => setMode("fullStage")}
                icon={<Maximize2 className="h-3.5 w-3.5" />}
                label="Full Stage Preview"
              />
              <ModePill
                active={mode === "cameraOsc"}
                onClick={() => setMode("cameraOsc")}
                icon={<Radio className="h-3.5 w-3.5" />}
                label="Camera & OSC"
              />
            </nav>

            {/* Right Utility Controls */}
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-lg border border-white/10 bg-black/30 p-0.5">
                <button
                  type="button"
                  onClick={store.undo}
                  disabled={!store.canUndo}
                  className="rounded p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-30"
                  title="Undo (Ctrl/⌘Z)"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={store.redo}
                  disabled={!store.canRedo}
                  className="rounded p-1.5 text-muted-foreground hover:bg-white/10 hover:text-foreground disabled:opacity-30"
                  title="Redo (Ctrl/⌘⇧Z)"
                >
                  <Redo2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* NDI Video Output Toggle + Background Mode Dropdown (macOS & Windows) */}
              <div
                className={`inline-flex items-center overflow-hidden rounded-lg border text-[11px] ${
                  ndiStatus.enabled
                    ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                    : "border-white/10 bg-black/30 text-muted-foreground"
                }`}
                title={ndiStatus.reason}
              >
                <button
                  type="button"
                  onClick={toggleNdi}
                  disabled={!ndiStatus.available}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 font-medium transition hover:bg-white/10 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Cast className="h-3.5 w-3.5" />
                  {ndiStatus.enabled
                    ? ndiBgMode === "alpha"
                      ? "NDI Alpha"
                      : "NDI Live"
                    : "NDI Out"}
                </button>
                <select
                  value={ndiBgMode}
                  onChange={(e) => setNdiBgMode(e.target.value as NdiBackgroundMode)}
                  disabled={!ndiStatus.available}
                  className="border-l border-white/10 bg-transparent px-1.5 py-1.5 text-[10px] outline-none disabled:opacity-45"
                  title="NDI background mode"
                >
                  <option value="alpha" className="bg-[#161a24] text-white">
                    Transparent (Alpha BGRA)
                  </option>
                  <option value="stage" className="bg-[#161a24] text-white">
                    Match Stage Background
                  </option>
                  <option value="green" className="bg-[#161a24] text-white">
                    Chroma Green
                  </option>
                  <option value="white" className="bg-[#161a24] text-white">
                    Solid White
                  </option>
                </select>
              </div>

              <span
                className={`hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium xl:inline-flex ${
                  electron
                    ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                }`}
              >
                <Activity className="h-3 w-3" />
                {electron ? "OSC live (UDP)" : "Web Preview"}
              </span>

              <Button
                size="sm"
                onClick={() => setRunning((r) => !r)}
                variant={running ? "destructive" : "default"}
                className="h-8 gap-1.5 px-3 text-xs font-semibold"
              >
                <Power className="h-3.5 w-3.5" />
                {running ? "Stop" : "Start"}
              </Button>
            </div>
          </div>
        </header>
      )}

      {/* Main Workspace Area */}
      <main className={`flex-1 overflow-hidden ${cleanFeed ? "p-0" : "p-3"}`}>
        {stats.lastError && !cleanFeed && (
          <div className="mb-2 rounded-lg border border-destructive/40 bg-destructive/15 px-3 py-1.5 text-xs text-destructive">
            {stats.lastError}
          </div>
        )}

        {/* MODE 1: SPLIT (Camera + Puppet Stage + OSC/Face Sidebar) */}
        {mode === "split" && (
          <div className="grid h-full grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="flex flex-col gap-3 lg:col-span-4">
              {renderCameraCanvasBox("flex-1 min-h-[240px]")}
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                <MiniStat label="FPS" value={String(stats.fps)} />
                <MiniStat label="Hands" value={String(stats.hands)} />
                <MiniStat label="Pose" value={stats.poses ? "Active" : "—"} />
                <MiniStat label="Face" value={stats.faces ? "Active" : "—"} />
              </div>
            </div>

            <div className="h-full min-h-[340px] lg:col-span-5">
              <PuppetStageCanvas
                store={store}
                frameRef={tracker.frameRef}
                calibration={tracker.calibration}
                countdownSeconds={tracker.countdownSeconds}
                viseme={stats.viseme}
                onCalibrateNow={tracker.calibrateNow}
                onStartCountdown={() => tracker.startCountdownCalibration(3)}
                isFullStage={false}
                onToggleFullStage={() => setMode("fullStage")}
                compact
                ndiEnabled={ndiStatus.enabled && !modalOpen}
                ndiBgMode={ndiBgMode}
              />
            </div>

            <div className="h-full overflow-y-auto lg:col-span-3">{renderOscSidebar()}</div>
          </div>
        )}

        {/* MODE 2: 2D PUPPET STUDIO (Large Stage + Mini Camera + Full Rigging Inspector) */}
        {mode === "studio" && (
          <div className="grid h-full min-h-0 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-12">
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden lg:col-span-8">
              <div className="min-h-0 flex-1 overflow-hidden">
                <PuppetStageCanvas
                  store={store}
                  frameRef={tracker.frameRef}
                  calibration={tracker.calibration}
                  countdownSeconds={tracker.countdownSeconds}
                  viseme={stats.viseme}
                  onCalibrateNow={tracker.calibrateNow}
                  onStartCountdown={() => tracker.startCountdownCalibration(3)}
                  isFullStage={false}
                  onToggleFullStage={() => setMode("fullStage")}
                  ndiEnabled={ndiStatus.enabled && !modalOpen}
                  ndiBgMode={ndiBgMode}
                />
              </div>

              {/* Bottom Strip: Mini Camera Feed + Live Expression Gauges */}
              <div className="grid h-36 shrink-0 grid-cols-12 gap-3 overflow-hidden">
                <div className="col-span-5 h-full min-h-0">
                  {renderCameraCanvasBox("h-full", true)}
                </div>
                <div className="col-span-7 flex h-full min-h-0 flex-col justify-start gap-2 overflow-hidden rounded-xl border border-border/60 bg-card/60 px-3 py-2 text-xs shadow">
                  <div className="flex shrink-0 items-center justify-between">
                    <span className="font-semibold text-cyan-300">Live Tracking Telemetry</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {stats.fps} fps • {stats.hands} hand{stats.hands === 1 ? "" : "s"} •{" "}
                      {stats.poses ? "Pose OK" : "No Pose"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <MeterRow label="Mouth Open" value={stats.faceSummary.mouthOpen} color="bg-amber-400" />
                    <MeterRow label="Smile" value={stats.faceSummary.mouthSmile} color="bg-emerald-400" />
                    <MeterRow label="Pucker (Oh)" value={stats.faceSummary.mouthPucker} color="bg-pink-400" />
                    <MeterRow label="Brows Raise" value={stats.faceSummary.browRaise} color="bg-sky-400" />
                    <MeterRow label="L Wink/Blink" value={stats.faceSummary.eyeBlinkL} color="bg-cyan-400" />
                    <MeterRow label="R Wink/Blink" value={stats.faceSummary.eyeBlinkR} color="bg-cyan-400" />
                  </div>
                </div>
              </div>
            </div>

            <div className="h-full min-h-0 lg:col-span-4">
              <PuppetStudioInspector
                store={store}
                onOpenNew={() => setShowNewModal(true)}
                onOpenPSD={() => setShowPSDModal(true)}
                onOpenSheet={() => setShowSheetModal(true)}
              />
            </div>
          </div>
        )}

        {/* MODE 3: FULL STAGE PREVIEW (Clean Feed / Chroma Key / Collapsible Camera PiP) */}
        {mode === "fullStage" && (
          <div className="relative h-full w-full">
            <PuppetStageCanvas
              store={store}
              frameRef={tracker.frameRef}
              calibration={tracker.calibration}
              countdownSeconds={tracker.countdownSeconds}
              viseme={stats.viseme}
              onCalibrateNow={tracker.calibrateNow}
              onStartCountdown={() => tracker.startCountdownCalibration(3)}
              isFullStage
              onToggleFullStage={() => setMode("studio")}
              cleanFeed={cleanFeed}
              ndiEnabled={ndiStatus.enabled && !modalOpen}
              ndiBgMode={ndiBgMode}
            />

            {/* Floating Camera PiP */}
            {!cleanFeed && showFullStagePip && (
              <div className="absolute bottom-4 left-4 z-20 h-36 w-60 shadow-2xl">
                {renderCameraCanvasBox("h-full w-full border-2 border-white/25", true)}
              </div>
            )}

            {/* Floating Bottom HUD */}
            {!cleanFeed ? (
              <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/15 bg-black/75 px-3 py-1.5 text-xs shadow-2xl backdrop-blur">
                <button
                  type="button"
                  onClick={() => setShowFullStagePip((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-full bg-cyan-500 px-2.5 py-1 font-semibold text-black hover:bg-cyan-400"
                >
                  <Camera className="h-3 w-3" />
                  {showFullStagePip ? "Hide Camera" : "Show Camera"}
                </button>

                <select
                  value={store.rig.stageBackground}
                  onChange={(e) =>
                    store.updateRig((p) => ({
                      ...p,
                      stageBackground: e.target.value as PuppetStageBackground,
                    }))
                  }
                  className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs text-white outline-none"
                >
                  {STAGE_BACKGROUNDS.map((bg) => (
                    <option key={bg.id} value={bg.id} className="bg-[#161a24] text-white">
                      {bg.label}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setCleanFeed(true)}
                  className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-white hover:bg-white/20"
                  title="Hide all UI chrome for OBS Window Capture (Press Esc to restore)"
                >
                  <EyeOff className="h-3 w-3" />
                  Clean Feed (Hide UI)
                </button>

                <button
                  type="button"
                  onClick={() => setMode("studio")}
                  className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-white hover:bg-white/20"
                >
                  Back to Studio
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCleanFeed(false)}
                className="absolute right-3 top-3 z-30 inline-flex items-center gap-1 rounded-full bg-black/50 px-3 py-1 text-[11px] text-white/75 opacity-25 transition hover:opacity-100"
              >
                <Eye className="h-3 w-3" />
                Restore UI (Esc)
              </button>
            )}
          </div>
        )}

        {/* MODE 4: CAMERA & OSC (Full Telemetry View) */}
        {mode === "cameraOsc" && (
          <div className="grid h-full grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="flex flex-col gap-3 lg:col-span-8">
              {renderCameraCanvasBox("flex-1 min-h-[300px]")}
              <div className="grid grid-cols-5 gap-2 text-center text-xs">
                <MiniStat label="FPS" value={String(stats.fps)} />
                <MiniStat label="OSC msg/s" value={String(stats.msgsPerSec)} />
                <MiniStat label="Hands" value={String(stats.hands)} />
                <MiniStat label="Pose" value={stats.poses ? "33 pts" : "—"} />
                <MiniStat label="Face" value={stats.faces ? "478 + 52 BS" : "—"} />
              </div>
            </div>
            <div className="h-full overflow-y-auto lg:col-span-4">{renderOscSidebar()}</div>
          </div>
        )}
      </main>

      {/* Modals */}
      <NewPuppetModal
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        store={store}
        onOpenPSD={() => setShowPSDModal(true)}
        onOpenSheet={() => setShowSheetModal(true)}
      />

      <PSDImporterModal
        open={showPSDModal}
        onClose={() => setShowPSDModal(false)}
        store={store}
        cachedPSD={cachedPSD}
        setCachedPSD={setCachedPSD}
        cachedSlots={cachedPSDSlots}
        setCachedSlots={setCachedPSDSlots}
        cachedEnabled={cachedPSDEnabled}
        setCachedEnabled={setCachedPSDEnabled}
      />

      <SheetImporterModal
        open={showSheetModal}
        onClose={() => setShowSheetModal(false)}
        store={store}
      />
    </div>
  );
}

function ModePill({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-medium transition ${
        active
          ? "bg-cyan-500 text-black font-semibold shadow-sm"
          : "text-muted-foreground hover:bg-white/10 hover:text-foreground"
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/50 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function MeterRow({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-foreground">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full transition-all duration-75 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
