// @lovable.dev/vite-tanstack-config already includes tanstackStart, viteReact,
// tailwindcss, tsConfigPaths, cloudflare, componentTagger, env injection, etc.
// We override only `base` so the built bundle works under Electron's file:// loader.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { copyMediapipeWasm } from "./vite-plugins/copy-mediapipe-wasm";

export default defineConfig({
  vite: {
    base: "./",
    plugins: [copyMediapipeWasm()],
  },
});
