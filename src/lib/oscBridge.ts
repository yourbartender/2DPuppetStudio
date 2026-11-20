// Bridge between renderer (browser/Electron) and OSC sender.
// In Electron, window.oscBridge is exposed via preload (sends real UDP).
// In a plain browser, we fall back to a no-op that logs counts so the UI still works.

export type OscArg = number | string | boolean;
export type OscMessage = { address: string; args: OscArg[] };

declare global {
  interface Window {
    oscBridge?: {
      send: (host: string, port: number, messages: OscMessage[]) => Promise<void>;
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
