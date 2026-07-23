import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const entry = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // manifest.json and the icons are referenced by fixed path, so they're
    // copied verbatim rather than emitted as hashed assets. `dest: "."` because
    // the plugin preserves the matched path — `dest: "icons"` nests them twice.
    // The .wasm is NOT copied here: it's imported as a URL asset (see wasm.ts)
    // so exactly one copy ships and its path is resolved at build time.
    viteStaticCopy({
      targets: [
        { src: "manifest.json", dest: "." },
        { src: "icons/*", dest: "." },
      ],
    }),
  ],
  // @twofau/ui is consumed as source and imports through its own "@/" alias.
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)) },
  },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        popup: entry("popup.html"),
        offscreen: entry("offscreen.html"),
        background: entry("src/background/index.ts"),
      },
      output: {
        // Fixed names: manifest.json can't reference hashed files.
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
