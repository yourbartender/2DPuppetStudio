import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

/**
 * Copies @mediapipe/tasks-vision/wasm/* into public/mediapipe/wasm/ so the
 * model + runtime are bundled with the app and no network calls are made.
 * Runs once at config resolve time (covers both `vite dev` and `vite build`).
 * Safe to re-run — it's a no-op when files are already up to date by mtime.
 */
export function copyMediapipeWasm(): Plugin {
  return {
    name: "handosc-copy-mediapipe-wasm",
    apply: () => true,
    configResolved() {
      try {
        const here = dirname(fileURLToPath(import.meta.url));
        const projectRoot = resolve(here, "..");
        const src = join(
          projectRoot,
          "node_modules",
          "@mediapipe",
          "tasks-vision",
          "wasm",
        );
        const dest = join(projectRoot, "public", "mediapipe", "wasm");
        if (!existsSync(src)) {
          // Dependency missing — skip silently; runtime will surface the error.
          return;
        }
        mkdirSync(dest, { recursive: true });
        for (const entry of readdirSync(src)) {
          const from = join(src, entry);
          const to = join(dest, entry);
          if (!statSync(from).isFile()) continue;
          if (
            existsSync(to) &&
            statSync(to).mtimeMs >= statSync(from).mtimeMs
          ) {
            continue;
          }
          copyFileSync(from, to);
        }
      } catch (e) {
        // Don't fail the build over a copy error — log and continue.
        // eslint-disable-next-line no-console
        console.warn("[copy-mediapipe-wasm] skipped:", (e as Error).message);
      }
    },
  };
}