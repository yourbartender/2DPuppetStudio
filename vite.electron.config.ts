import { rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { copyMediapipeWasm } from "./vite-plugins/copy-mediapipe-wasm";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // Set the project root to the electron/ folder so the emitted index.html
  // lands at the root of outDir (dist-electron/index.html), next to the
  // mediapipe/ assets copied from public/. This makes relative paths like
  // ./mediapipe/hand_landmarker.task resolve correctly under file://.
  root: "electron",
  publicDir: "../public",
  base: "./",
  plugins: [
    {
      name: "clean-dist-electron",
      buildStart() {
        try {
          rmSync(resolve(__dirname, "dist-electron"), { recursive: true, force: true });
        } catch {
          // ignore
        }
      },
    },
    react(),
    tailwindcss(),
    tsconfigPaths(),
    copyMediapipeWasm(),
  ],
  build: {
    outDir: "../dist-electron",
    emptyOutDir: false,
  },
});