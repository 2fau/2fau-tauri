import { ensureReady } from "@twofau/core-wasm";
// Vite emits the .wasm as a build asset and inlines its final root-relative URL
// here. That resolves correctly against the extension origin from both the
// popup and the service worker, and guarantees a single copy in the bundle —
// wasm-bindgen's default `import.meta.url` lookup doesn't survive bundling into
// a service worker.
import wasmUrl from "@twofau/core-wasm/pkg/twofau_wasm_bg.wasm?url";

export function initWasm(): Promise<unknown> {
  return ensureReady(chrome.runtime.getURL(wasmUrl));
}
