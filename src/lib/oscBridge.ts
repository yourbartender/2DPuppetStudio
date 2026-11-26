// Bridge between renderer (browser/Electron) and native OSC + NDI senders.
// In Electron, window.oscBridge is exposed via preload (real UDP OSC + NDI video).
// In a plain browser, gracefully falls back to no-ops.

export type OscArg = number | string | boolean;
export type OscMessage = { address: string; args: OscArg[] };

export type NdiBackgroundMode = "alpha" | "stage" | "green" | "white";

export type NdiStatus = {
  available: boolean;
  enabled: boolean;
  sourceName: string;
  framesSent: number;
  reason: string;
};

declare global {
  interface Window {
    oscBridge?: {
      send: (host: string, port: number, messages: OscMessage[]) => Promise<void>;
      ndiStatus?: () => Promise<NdiStatus>;
      ndiStart?: (sourceName?: string) => Promise<NdiStatus>;
      ndiStop?: () => Promise<NdiStatus>;
      ndiSendFrame?: (width: number, height: number, rgbaBytes: Uint8Array) => void;
      isElectron: true;
    };
  }
}

let lastWarn = 0;
export async function sendOsc(host: string, port: number, messages: OscMessage[]) {
  if (typeof window !== "undefined" && window.oscBridge) {
    return window.oscBridge.send(host, port, messages);
  }
  const now = Date.now();
  if (now - lastWarn > 5000) {
    lastWarn = now;
    // eslint-disable-next-line no-console
    console.info(
      `[OSC fallback] Would send ${messages.length} messages to ${host}:${port}. Run inside the packaged Electron app for real UDP.`,
    );
  }
}

export const isElectron = () =>
  typeof window !== "undefined" && !!window.oscBridge?.isElectron;

export async function getNdiStatus(): Promise<NdiStatus> {
  if (typeof window !== "undefined" && window.oscBridge?.ndiStatus) {
    return window.oscBridge.ndiStatus();
  }
  return {
    available: false,
    enabled: false,
    sourceName: "Puppet Studio",
    framesSent: 0,
    reason: "Run inside Electron for NDI output",
  };
}

export async function startNdiOutput(sourceName = "Puppet Studio"): Promise<NdiStatus> {
  if (typeof window !== "undefined" && window.oscBridge?.ndiStart) {
    return window.oscBridge.ndiStart(sourceName);
  }
  return getNdiStatus();
}

export async function stopNdiOutput(): Promise<NdiStatus> {
  if (typeof window !== "undefined" && window.oscBridge?.ndiStop) {
    return window.oscBridge.ndiStop();
  }
  return getNdiStatus();
}

export function sendNdiRgbaFrame(width: number, height: number, rgbaBytes: Uint8Array) {
  if (typeof window !== "undefined" && window.oscBridge?.ndiSendFrame) {
    window.oscBridge.ndiSendFrame(width, height, rgbaBytes);
  }
}
