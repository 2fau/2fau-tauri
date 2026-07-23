// @vitest-environment node
// Guards the manifest invariants the spec pins down: MV3, the exact permission
// set, the wasm CSP, no host access, and no dangling file references.
import { existsSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { describe, expect, it } from "vitest";
import manifest from "../manifest.json";

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

describe("manifest.json", () => {
  it("is Manifest V3", () => {
    expect(manifest.manifest_version).toBe(3);
  });

  it("declares exactly the permissions the spec allows", () => {
    expect([...manifest.permissions].sort()).toEqual(
      ["activeTab", "alarms", "contextMenus", "offscreen", "storage"].sort(),
    );
  });

  it("requests no host access and injects no content scripts", () => {
    expect(manifest).not.toHaveProperty("host_permissions");
    expect(manifest).not.toHaveProperty("content_scripts");
  });

  it("allows wasm in extension pages", () => {
    expect(manifest.content_security_policy.extension_pages).toBe(
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    );
  });

  it("only references files that exist", () => {
    for (const path of Object.values(manifest.icons)) expect(existsSync(root(path))).toBe(true);
    expect(existsSync(root(manifest.action.default_popup))).toBe(true);
  });

  it("registers the service worker as a module", () => {
    expect(manifest.background).toEqual({ service_worker: "background.js", type: "module" });
  });

  it("binds a shortcut that opens the popup", () => {
    expect(manifest.commands._execute_action.suggested_key.default).toBe("Ctrl+Shift+U");
  });

  // The source-tree check above can't catch a build that relocates files, which
  // is exactly how the icons first shipped double-nested under dist/icons/icons.
  it("resolves its paths inside dist when a build is present", () => {
    const dist = (p: string) => fileURLToPath(new URL(`../dist/${p}`, import.meta.url));
    if (!existsSync(dist("manifest.json"))) return; // not built yet
    for (const path of Object.values(manifest.icons)) expect(existsSync(dist(path))).toBe(true);
    expect(existsSync(dist(manifest.action.default_popup))).toBe(true);
    // The service worker the manifest names must actually be emitted, or Chrome
    // rejects the whole extension at load.
    expect(existsSync(dist(manifest.background.service_worker))).toBe(true);
  });
});
