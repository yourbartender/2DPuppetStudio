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
import { isElectron } from "@/lib/oscBridge";
import { Hand, Radio, Activity, Power, PersonStanding, Smile } from "lucide-react";

export function HandOscApp() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const [settings, setSettings] = useState<TrackerSettings>({
    host: "127.0.0.1",
    port: 9000,
    fps: 60,
    mirror: true,
    smoothMinCutoff: 4.0,
    smoothBeta: 0.17,
    mapping: "centered_aspect",
    screenWidth: typeof window !== "undefined" ? window.screen.width : 1920,
    screenHeight: typeof window !== "undefined" ? window.screen.height : 1080,

    trackHands: true,
    handsSendLandmarks: true,
    handsSendBundled: false,
    handsSendAxisGrouped: true,
    handsSendGesture: true,

    trackPose: false,
    poseSendLandmarks: true,
    poseSendBundled: false,
    poseSendAxisGrouped: true,

    trackFace: false,
    faceTier: "curated",
    faceSendLandmarks: false,
    faceSendBundled: false,
    faceSendAxisGrouped: true,
    faceSendBlendshapes: true,
  });

  // enumerate cameras
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
        // need a permission grant first to get labels
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

  const stats = useHolisticTracker(videoRef, canvasRef, deviceId, settings, running);
  const electron = useMemo(() => isElectron(), []);

  const set = <K extends keyof TrackerSettings>(k: K, v: TrackerSettings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));

  return (
    <div className="min-h-screen bg-gradient-surface text-foreground">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur supports-[backdrop-filter]:bg-card/30">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-primary shadow-glow">
              <Hand className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">HandOSC</h1>
              <p className="text-xs text-muted-foreground">
                MediaPipe Hands → OSC for macOS
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
                electron
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-accent/40 bg-accent/10 text-accent"
              }`}
            >
              <Radio className="h-3 w-3" />
              {electron ? "OSC live (UDP)" : "Preview only — package as Electron for UDP"}
            </span>
            <Button
              size="lg"
              variant={running ? "destructive" : "default"}
              onClick={() => setRunning((r) => !r)}
              className="gap-2"
            >
              <Power className="h-4 w-4" />
              {running ? "Stop" : "Start tracking"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1600px] gap-6 px-6 py-6 lg:grid-cols-[1fr_360px]">
        {/* Preview */}
        <div className="space-y-4">
          <Card className="overflow-hidden border-border/60 bg-black p-0 shadow-elevated">
            <div className="relative aspect-video w-full">
              <video ref={videoRef} className="hidden" playsInline muted />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 h-full w-full object-cover"
              />
              {!running && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Hand className="h-10 w-10 opacity-40" />
                  <p className="text-sm">Press Start tracking to begin</p>
                </div>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="FPS" value={stats.fps.toString()} />
            <StatTile label="Msgs/s" value={stats.msgsPerSec.toString()} />
            <StatTile
              label="Detected"
              value={`H:${stats.hands} P:${stats.poses} F:${stats.faces}`}
            />
            <StatTile
              label="Gestures"
              value={
                [stats.gestures.L && `L:${stats.gestures.L}`, stats.gestures.R && `R:${stats.gestures.R}`]
                  .filter(Boolean)
                  .join("  ") || "—"
              }
            />
          </div>

          {stats.lastError && (
            <Card className="border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {stats.lastError}
            </Card>
          )}
        </div>

        {/* Sidebar controls */}
        <div className="space-y-4">
          <Section title="OSC destination" icon={<Radio className="h-4 w-4" />}>
            <div className="grid grid-cols-[1fr_110px] gap-2">
              <Field label="Host">
                <Input
                  value={settings.host}
                  onChange={(e) => set("host", e.target.value)}
                  className="font-mono-tabular"
                />
              </Field>
              <Field label="Port">
                <Input
                  type="number"
                  value={settings.port}
                  onChange={(e) => set("port", Number(e.target.value) || 0)}
                  className="font-mono-tabular"
                />
              </Field>
            </div>
          </Section>

          <Section title="Hands" icon={<Hand className="h-4 w-4" />}>
            <ToggleRow
              label="Track hands"
              checked={settings.trackHands}
              onChange={(v) => set("trackHands", v)}
            />
            {settings.trackHands && (
              <div className="space-y-2 pt-1">
                <ToggleRow
                  label="/hand/L|R/landmark/0..20"
                  checked={settings.handsSendLandmarks}
                  onChange={(v) => set("handsSendLandmarks", v)}
                />
                <ToggleRow
                  label="/hand/L|R bundled floats"
                  checked={settings.handsSendBundled}
                  onChange={(v) => set("handsSendBundled", v)}
                />
                <ToggleRow
                  label="/hand/L|R/x|y|z (21 per axis)"
                  checked={settings.handsSendAxisGrouped}
                  onChange={(v) => set("handsSendAxisGrouped", v)}
                />
                <ToggleRow
                  label="/hand/L|R/gesture + /pinch"
                  checked={settings.handsSendGesture}
                  onChange={(v) => set("handsSendGesture", v)}
                />
              </div>
            )}
          </Section>

          <Section title="Pose (body)" icon={<PersonStanding className="h-4 w-4" />}>
            <ToggleRow
              label="Track pose"
              checked={settings.trackPose}
              onChange={(v) => set("trackPose", v)}
            />
            {settings.trackPose && (
              <div className="space-y-2 pt-1">
                <ToggleRow
                  label="/pose/landmark/0..32"
                  checked={settings.poseSendLandmarks}
                  onChange={(v) => set("poseSendLandmarks", v)}
                />
                <ToggleRow
                  label="/pose bundled floats"
                  checked={settings.poseSendBundled}
                  onChange={(v) => set("poseSendBundled", v)}
                />
                <ToggleRow
                  label="/pose/x|y|z (33 per axis)"
                  checked={settings.poseSendAxisGrouped}
                  onChange={(v) => set("poseSendAxisGrouped", v)}
                />
              </div>
            )}
          </Section>

          <Section title="Face" icon={<Smile className="h-4 w-4" />}>
            <ToggleRow
              label="Track face"
              checked={settings.trackFace}
              onChange={(v) => set("trackFace", v)}
            />
            {settings.trackFace && (
              <div className="space-y-2 pt-1">
                <Field label="Landmark count">
                  <Select
                    value={settings.faceTier}
                    onValueChange={(v) => set("faceTier", v as FaceTier)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">{faceTierLabel("off")}</SelectItem>
                      <SelectItem value="essentials">{faceTierLabel("essentials")}</SelectItem>
                      <SelectItem value="curated">{faceTierLabel("curated")}</SelectItem>
                      <SelectItem value="detailed">{faceTierLabel("detailed")}</SelectItem>
                      <SelectItem value="all">{faceTierLabel("all")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <ToggleRow
                  label="/face/landmark/N (per-point)"
                  checked={settings.faceSendLandmarks}
                  onChange={(v) => set("faceSendLandmarks", v)}
                />
                <ToggleRow
                  label="/face bundled floats"
                  checked={settings.faceSendBundled}
                  onChange={(v) => set("faceSendBundled", v)}
                />
                <ToggleRow
                  label="/face/x|y|z (per axis)"
                  checked={settings.faceSendAxisGrouped}
                  onChange={(v) => set("faceSendAxisGrouped", v)}
                />
                <ToggleRow
                  label="/face/blendshape/* (52 expressions)"
                  checked={settings.faceSendBlendshapes}
                  onChange={(v) => set("faceSendBlendshapes", v)}
                />
              </div>
            )}
          </Section>

          <Section title="Camera" icon={<Hand className="h-4 w-4" />}>
            <Field label="Device">
              <Select
                value={deviceId ?? undefined}
                onValueChange={(v) => setDeviceId(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select camera" />
                </SelectTrigger>
                <SelectContent>
                  {devices.map((d) => (
                    <SelectItem key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <ToggleRow
              label="Mirror horizontally"
              checked={settings.mirror}
              onChange={(v) => set("mirror", v)}
            />
          </Section>

          <Section title="Coordinate mapping" icon={<Activity className="h-4 w-4" />}>
            <Field label="Mode">
              <Select
                value={settings.mapping}
                onValueChange={(v) => set("mapping", v as MappingMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="centered_aspect">
                    Centered: x ∈ [-1,1], y scaled to screen
                  </SelectItem>
                  <SelectItem value="normalized">Normalized 0..1 (raw)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {settings.mapping === "centered_aspect" && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Screen W">
                  <Input
                    type="number"
                    value={settings.screenWidth}
                    onChange={(e) => set("screenWidth", Number(e.target.value) || 1)}
                    className="font-mono-tabular"
                  />
                </Field>
                <Field label="Screen H">
                  <Input
                    type="number"
                    value={settings.screenHeight}
                    onChange={(e) => set("screenHeight", Number(e.target.value) || 1)}
                    className="font-mono-tabular"
                  />
                </Field>
              </div>
            )}
          </Section>

          <Section title="Send rate & smoothing" icon={<Activity className="h-4 w-4" />}>
            <SliderRow
              label="Send rate"
              value={settings.fps}
              min={5}
              max={120}
              step={1}
              suffix=" Hz"
              onChange={(v) => set("fps", v)}
            />
            <SliderRow
              label="Smoothing (min cutoff)"
              value={settings.smoothMinCutoff}
              min={0.1}
              max={5}
              step={0.05}
              onChange={(v) => set("smoothMinCutoff", v)}
            />
            <SliderRow
              label="Smoothing (beta / responsiveness)"
              value={settings.smoothBeta}
              min={0}
              max={0.2}
              step={0.005}
              onChange={(v) => set("smoothBeta", v)}
            />
          </Section>
        </div>
      </main>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card className="border-border/60 bg-card/60 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate font-mono-tabular text-lg font-semibold text-foreground">
        {value}
      </div>
    </Card>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/60 bg-card/60 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="text-primary">{icon}</span>
        {title}
      </div>
      <div className="space-y-3">{children}</div>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
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
    <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2">
      <span className="font-mono-tabular text-xs">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </Label>
        <span className="font-mono-tabular text-xs text-foreground">
          {value.toFixed(step < 1 ? 2 : 0)}
          {suffix ?? ""}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}
