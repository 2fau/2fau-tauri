import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: vitest 2 carries Vite 5's types
// while the build runs on Vite 6, so a single file sharing `plugins` between
// them fails to type-check. Tests here are plain .ts and need no plugins.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("../../packages/ui/src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
