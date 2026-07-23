// Tests exercise the real crypto core. jsdom has no fetch for the .wasm URL, so
// initialise from the built bytes instead.
//
// The path comes off the vitest root rather than `import.meta.url`: under the
// jsdom environment that URL is not a file: URL, and readFileSync rejects it.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureReady } from "@twofau/core-wasm";
import { beforeAll } from "vitest";

const WASM = resolve(process.cwd(), "../../packages/core-wasm/pkg/twofau_wasm_bg.wasm");

beforeAll(async () => {
  await ensureReady(readFileSync(WASM));
});
