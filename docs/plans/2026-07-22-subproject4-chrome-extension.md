# Sub-project 4 — Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone Manifest V3 Chrome extension with desktop feature parity, reusing `@twofau/ui` unchanged over a WASM-backed `VaultService`, storing the vault encrypted in `chrome.storage.sync`.

**Architecture:** The vault is the same sealed blob format as `vault.dat`, base64-chunked across `chrome.storage.sync` behind a manifest item that acts as the commit point. Writes carry a revision; if it advanced, the writer decrypts the remote blob, runs `twofau_core::merge`, and retries. The PBKDF2-derived key (never the passphrase) lives in `chrome.storage.session`, cleared by a `chrome.alarms` auto-lock. Popup, options page, and service worker each read that key per operation — nothing is cached in service-worker globals.

**Tech Stack:** Manifest V3, Vite 6 multi-entry, React 19, `@twofau/ui`, `@twofau/core-wasm` (wasm-bindgen), Vitest, TypeScript 5 strict, pnpm workspaces, Rust stable.

**Spec:** `docs/specs/2026-07-22-subproject4-chrome-extension.md`

## Global Constraints

- Manifest V3 only. No V2 APIs (`chrome.browserAction`, `background.scripts`, `chrome.tabs.executeScript`).
- Permissions are exactly `["storage", "contextMenus", "offscreen", "activeTab", "alarms"]`. **No `host_permissions`. No `content_scripts`.** Adding either requires going back to the spec.
- Manifest CSP must be exactly: `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"`.
- The service worker stores **no** state in global variables. Every handler re-reads from `chrome.storage`.
- `async`/`await` only — never `.then()` chains.
- Decrypted accounts and secrets are **never** persisted — not to `local`, not to `session`. Only the derived key goes in `session`.
- The sealed blob format is byte-identical to `vault.dat`: `b"2FAU" | version u8 | kdf_id u8 | salt[16] | nonce[12] | ciphertext`. Do not invent a new format.
- `chrome.storage.sync` limits: `QUOTA_BYTES` = 102400, `QUOTA_BYTES_PER_ITEM` = 8192. Chunk payloads are capped at 6144 chars to leave header/key-name headroom.
- Every referenced icon file must exist at its declared pixel size.
- Conventional commits (`feat:`, `fix:`, `test:`, `chore:`, `ci:`, `docs:`), scope optional.
- Never claim a manually-verified behaviour (context menu, clipboard, QR capture) has been verified unless it actually was.

---

### Task 1: Key-based vault API in core + WASM

Lets a host derive the key once and cache it, instead of paying 600 000 PBKDF2 rounds on every popup open and every context-menu click.

**Files:**
- Modify: `crates/twofau-core/src/vault.rs`
- Modify: `crates/twofau-core/src/lib.rs:26-29`
- Modify: `crates/twofau-wasm/src/lib.rs`
- Modify: `packages/core-wasm/index.ts`
- Test: `crates/twofau-core/src/vault.rs` (inline `mod tests`)
- Test: `packages/core-wasm/key-vault.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - Rust: `twofau_core::salt_of(blob: &[u8]) -> Result<[u8; SALT_LEN], VaultError>`, `Key::to_bytes(&self) -> [u8; 32]`
  - TS (from `@twofau/core-wasm`): `newSalt(): Promise<string>`, `vaultSalt(blob: Uint8Array): Promise<string>`, `deriveKey(passphrase: string, saltB64: string): Promise<string>`, `sealWithKey(doc: VaultDocument, keyB64: string, saltB64: string): Promise<Uint8Array>`, `openWithKey(blob: Uint8Array, keyB64: string): Promise<VaultDocument>`

- [ ] **Step 1: Write the failing Rust tests**

Append to the `mod tests` block at the bottom of `crates/twofau-core/src/vault.rs`:

```rust
    #[test]
    fn salt_of_reads_the_header_salt() {
        let blob = seal_with_passphrase(&sample_doc(), "pw", &SALT, &NONCE).unwrap();
        assert_eq!(salt_of(&blob).unwrap(), SALT);
        assert_eq!(salt_of(b"short"), Err(VaultError::BadFormat));
    }

    #[test]
    fn derived_key_bytes_round_trip_through_from_bytes() {
        let key = derive_key("pw", &SALT);
        let same = Key::from_bytes(key.to_bytes());
        let blob = seal(&sample_doc(), &key, &SALT, &NONCE).unwrap();
        assert_eq!(open(&blob, &same).unwrap(), sample_doc());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/jilizart/Projects/2fau-tauri && cargo test -p twofau-core vault:: 2>&1 | tail -20`
Expected: FAIL — `cannot find function 'salt_of' in this scope` and `no method named 'to_bytes' found for struct 'Key'`.

- [ ] **Step 3: Implement in the core**

In `crates/twofau-core/src/vault.rs`, add to the `impl Key` block:

```rust
    /// The raw key material. Hosts that cache a derived key instead of the
    /// passphrase (the Chrome extension's session storage) need this — treat
    /// the result as secret.
    pub fn to_bytes(&self) -> [u8; 32] {
        self.0
    }
```

And add next to `open_with_passphrase`:

```rust
/// Read the salt out of a sealed blob's header, so a host can derive the key
/// separately from opening the blob (and cache the key).
pub fn salt_of(blob: &[u8]) -> Result<[u8; SALT_LEN], VaultError> {
    let parsed = parse(blob)?;
    parsed.salt.try_into().map_err(|_| VaultError::BadFormat)
}
```

In `crates/twofau-core/src/lib.rs`, extend the vault re-export:

```rust
pub use vault::{
    derive_key, open, open_with_passphrase, salt_of, seal, seal_with_passphrase, Kdf, Key,
    VaultError, NONCE_LEN, SALT_LEN,
};
```

- [ ] **Step 4: Run the Rust tests to verify they pass**

Run: `cargo test -p twofau-core 2>&1 | tail -5`
Expected: PASS, all tests ok.

- [ ] **Step 5: Add the WASM bindings**

In `crates/twofau-wasm/src/lib.rs`, add after `decode_secret`:

```rust
fn decode_b64_array<const N: usize>(b64: &str, what: &str) -> Result<[u8; N], JsError> {
    let bytes = STANDARD
        .decode(b64)
        .map_err(|_| JsError::new(&format!("invalid base64 {what}")))?;
    bytes
        .try_into()
        .map_err(|_| JsError::new(&format!("{what} must be {N} bytes")))
}

/// A fresh random 16-byte salt (base64), for a brand-new vault.
#[wasm_bindgen]
pub fn new_salt() -> Result<String, JsError> {
    let mut salt = [0u8; SALT_LEN];
    getrandom::getrandom(&mut salt).map_err(|_| JsError::new("RNG failure"))?;
    Ok(STANDARD.encode(salt))
}

/// The salt recorded in an existing blob's header (base64).
#[wasm_bindgen]
pub fn vault_salt(blob: &[u8]) -> Result<String, JsError> {
    let salt = twofau_core::salt_of(blob).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(STANDARD.encode(salt))
}

/// Derive the 32-byte vault key (base64) from a passphrase + salt. Hosts cache
/// this instead of the passphrase so they don't re-run 600k PBKDF2 rounds.
#[wasm_bindgen]
pub fn derive_key(passphrase: &str, salt_b64: &str) -> Result<String, JsError> {
    let salt: [u8; SALT_LEN] = decode_b64_array(salt_b64, "salt")?;
    Ok(STANDARD.encode(twofau_core::derive_key(passphrase, &salt).to_bytes()))
}

/// Seal a `VaultDocument` with an already-derived key. The nonce is fresh per
/// call; `salt_b64` must be the salt the key was derived from, since it is
/// written into the header and bound as associated data.
#[wasm_bindgen]
pub fn seal_with_key(doc: JsValue, key_b64: &str, salt_b64: &str) -> Result<Vec<u8>, JsError> {
    let doc: VaultDocument = serde_wasm_bindgen::from_value(doc)?;
    let key = twofau_core::Key::from_bytes(decode_b64_array(key_b64, "key")?);
    let salt: [u8; SALT_LEN] = decode_b64_array(salt_b64, "salt")?;
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut nonce).map_err(|_| JsError::new("RNG failure"))?;
    twofau_core::seal(&doc, &key, &salt, &nonce).map_err(|e| JsError::new(&e.to_string()))
}

/// Open a blob with an already-derived key.
#[wasm_bindgen]
pub fn open_with_key(blob: &[u8], key_b64: &str) -> Result<JsValue, JsError> {
    let key = twofau_core::Key::from_bytes(decode_b64_array(key_b64, "key")?);
    let doc = twofau_core::open(blob, &key).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(serde_wasm_bindgen::to_value(&doc)?)
}
```

- [ ] **Step 6: Add the typed JS wrappers**

In `packages/core-wasm/index.ts`, extend the import list from `./pkg/twofau_wasm.js` with:

```ts
  new_salt as _newSalt,
  vault_salt as _vaultSalt,
  derive_key as _deriveKey,
  seal_with_key as _sealWithKey,
  open_with_key as _openWithKey,
```

and append these functions:

```ts
/** A fresh random 16-byte salt (base64) for a brand-new vault. */
export async function newSalt(): Promise<string> {
  await ensureReady();
  return _newSalt();
}

/** The salt recorded in an existing blob's header (base64). */
export async function vaultSalt(blob: Uint8Array): Promise<string> {
  await ensureReady();
  return _vaultSalt(blob);
}

/** Derive the vault key (base64). Expensive — cache the result, not the passphrase. */
export async function deriveKey(passphrase: string, saltB64: string): Promise<string> {
  await ensureReady();
  return _deriveKey(passphrase, saltB64);
}

export async function sealWithKey(
  doc: VaultDocument,
  keyB64: string,
  saltB64: string,
): Promise<Uint8Array> {
  await ensureReady();
  return _sealWithKey(doc, keyB64, saltB64);
}

export async function openWithKey(blob: Uint8Array, keyB64: string): Promise<VaultDocument> {
  await ensureReady();
  return _openWithKey(blob, keyB64) as VaultDocument;
}
```

- [ ] **Step 7: Write the failing JS interop test**

Create `packages/core-wasm/key-vault.test.ts`:

```ts
// @vitest-environment node
// Proves the key-based vault API works across the JS boundary and stays
// format-compatible with the passphrase API the desktop app uses.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deriveKey,
  ensureReady,
  newSalt,
  openVault,
  openWithKey,
  sealVault,
  sealWithKey,
  vaultSalt,
  type VaultDocument,
} from "./index";

const DOC: VaultDocument = {
  entries: [
    {
      account: {
        id: "11111111-1111-4111-8111-111111111111",
        issuer: "Acme",
        label: "me",
        otp_type: "Totp",
        algorithm: "Sha1",
        digits: 6,
        period: 30,
        counter: 0,
      },
      secret: "SGVsbG8h",
      modified_at: 42,
    },
  ],
  tombstones: [],
};

beforeAll(async () => {
  await ensureReady(readFileSync(new URL("./pkg/twofau_wasm_bg.wasm", import.meta.url)));
});

describe("key-based vault API", () => {
  it("round-trips through a derived key", async () => {
    const salt = await newSalt();
    const key = await deriveKey("hunter2hunter2", salt);
    const blob = await sealWithKey(DOC, key, salt);
    expect(await openWithKey(blob, key)).toEqual(DOC);
  });

  it("rejects a key derived from the wrong passphrase", async () => {
    const salt = await newSalt();
    const blob = await sealWithKey(DOC, await deriveKey("right-passphrase", salt), salt);
    const wrong = await deriveKey("wrong-passphrase", salt);
    await expect(openWithKey(blob, wrong)).rejects.toThrow();
  });

  it("is format-compatible with the passphrase API", async () => {
    // A blob the desktop app could have written...
    const blob = await sealVault(DOC, "shared-passphrase");
    // ...opens with a key derived from the salt in its own header.
    const key = await deriveKey("shared-passphrase", await vaultSalt(blob));
    expect(await openWithKey(blob, key)).toEqual(DOC);

    // ...and the reverse: a key-sealed blob opens by passphrase.
    const salt = await newSalt();
    const keyed = await sealWithKey(DOC, await deriveKey("shared-passphrase", salt), salt);
    expect(await openVault(keyed, "shared-passphrase")).toEqual(DOC);
  });
});
```

- [ ] **Step 8: Rebuild WASM and run the test**

Run: `cd /Users/jilizart/Projects/2fau-tauri && pnpm build:core-wasm && pnpm --filter @twofau/core-wasm test 2>&1 | tail -15`
Expected: PASS — 3 tests in `key-vault.test.ts` plus the existing smoke tests.

- [ ] **Step 9: Verify lint and formatting**

Run: `cargo fmt --all --check && cargo clippy -p twofau-core -p twofau-wasm --all-targets -- -D warnings 2>&1 | tail -5`
Expected: no output from fmt, `Finished` from clippy with no warnings.

- [ ] **Step 10: Commit**

```bash
git add crates/twofau-core/src/vault.rs crates/twofau-core/src/lib.rs \
        crates/twofau-wasm/src/lib.rs packages/core-wasm/index.ts \
        packages/core-wasm/key-vault.test.ts
git commit -m "feat(core): key-based seal/open so hosts can cache a derived key"
```

---

### Task 2: Extension package scaffold with a working popup

Deliverable: a loadable unpacked extension whose popup renders the real shared UI over `MockVaultService`. This proves the Vite/WASM/Tailwind/CSP pipeline before any storage work depends on it.

**Files:**
- Create: `apps/twofau-extension/package.json`
- Create: `apps/twofau-extension/tsconfig.json`
- Create: `apps/twofau-extension/vite.config.ts`
- Create: `apps/twofau-extension/manifest.json`
- Create: `apps/twofau-extension/popup.html`
- Create: `apps/twofau-extension/src/popup/main.tsx`
- Create: `apps/twofau-extension/src/index.css`
- Create: `apps/twofau-extension/icons/icon-{16,48,128}.png`
- Test: `apps/twofau-extension/src/manifest.test.ts`

**Interfaces:**
- Consumes: `@twofau/ui` (`TwoFAUApp`, `MockVaultService`), `@twofau/core-wasm` (`ensureReady`).
- Produces: the `@twofau/extension` workspace package; `dist/` layout with fixed entry names `popup.js`, `background.js`, `options.js`, `offscreen.js` and `twofau_wasm_bg.wasm` at the dist root; `initWasm()` from `src/wasm.ts`.

- [ ] **Step 1: Create the package manifest**

Create `apps/twofau-extension/package.json`:

```json
{
  "name": "@twofau/extension",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite build --watch --mode development",
    "build": "tsc --noEmit && vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@twofau/core-wasm": "workspace:*",
    "@twofau/ui": "workspace:*",
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/chrome": "^0.0.287",
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.2",
    "vite": "^6.0.7",
    "vite-plugin-static-copy": "^2.2.0",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 2: Create tsconfig and Vite config**

Create `apps/twofau-extension/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["chrome", "vitest/globals"],
    "paths": { "@/*": ["../../packages/ui/src/*"] }
  },
  "include": ["src", "vite.config.ts"]
}
```

Create `apps/twofau-extension/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
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
    // manifest.json references fixed paths, so these are copied verbatim rather
    // than emitted as hashed assets. The .wasm lands at the dist root so the
    // service worker and popup can both reach it via chrome.runtime.getURL.
    viteStaticCopy({
      targets: [
        { src: "manifest.json", dest: "." },
        { src: "icons/*", dest: "icons" },
        { src: "../../packages/core-wasm/pkg/twofau_wasm_bg.wasm", dest: "." },
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
      input: { popup: entry("popup.html") },
      output: {
        // Fixed names: manifest.json can't reference hashed files.
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Create the manifest, popup HTML, styles, and WASM loader**

Create `apps/twofau-extension/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "2FAU",
  "version": "0.1.0",
  "description": "Local, encrypted TOTP/HOTP authenticator. Your codes are generated in your browser and never sent anywhere.",
  "minimum_chrome_version": "116",
  "action": { "default_popup": "popup.html", "default_title": "2FAU" },
  "permissions": ["storage", "contextMenus", "offscreen", "activeTab", "alarms"],
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

Create `apps/twofau-extension/popup.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>2FAU</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/popup/main.tsx"></script>
  </body>
</html>
```

Create `apps/twofau-extension/src/index.css`:

```css
/* Shared UI theme (which imports Tailwind); tell Tailwind v4 to scan the shared
   package's source for utility classes (node_modules is skipped by default). */
@import "@twofau/ui/src/styles/globals.css";
@source "../../../packages/ui/src";
@source "../src";

html,
body {
  margin: 0;
  width: 320px;
}
```

Create `apps/twofau-extension/src/wasm.ts`:

```ts
import { ensureReady } from "@twofau/core-wasm";

/**
 * Initialise the WASM core from the copy at the extension root. The default
 * `import.meta.url` resolution doesn't survive bundling into a service worker,
 * so the URL is always passed explicitly.
 */
export function initWasm(): Promise<unknown> {
  return ensureReady(chrome.runtime.getURL("twofau_wasm_bg.wasm"));
}
```

Create `apps/twofau-extension/src/popup/main.tsx`:

```tsx
import { MockVaultService, TwoFAUApp } from "@twofau/ui";
import ReactDOM from "react-dom/client";
import { initWasm } from "../wasm";
import "../index.css";

async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
  try {
    await initWasm();
  } catch (err) {
    // A blank list would look like an empty vault; say what actually happened.
    root.render(
      <p className="p-4 text-[13px] text-destructive">
        Could not start: {err instanceof Error ? err.message : String(err)}
      </p>,
    );
    return;
  }
  // Task 6 replaces this with the real storage-backed service.
  root.render(<TwoFAUApp service={new MockVaultService({ startUnlocked: true })} />);
}

void bootstrap();
```

- [ ] **Step 4: Generate the icon files**

Run (macOS `sips`; the source is the desktop app's 128px icon):

```bash
cd /Users/jilizart/Projects/2fau-tauri
mkdir -p apps/twofau-extension/icons
cp apps/twofau-app/src-tauri/icons/128x128.png apps/twofau-extension/icons/icon-128.png
sips -z 48 48 apps/twofau-extension/icons/icon-128.png --out apps/twofau-extension/icons/icon-48.png
sips -z 16 16 apps/twofau-extension/icons/icon-128.png --out apps/twofau-extension/icons/icon-16.png
file apps/twofau-extension/icons/*.png
```

Expected: three PNG files reported at 128 x 128, 48 x 48, and 16 x 16.

- [ ] **Step 5: Write the failing manifest guard test**

Create `apps/twofau-extension/src/manifest.test.ts`:

```ts
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
});
```

- [ ] **Step 6: Install and run the test to verify it fails, then passes**

Run: `cd /Users/jilizart/Projects/2fau-tauri && pnpm install && pnpm --filter @twofau/extension test 2>&1 | tail -15`
Expected: PASS — 5 tests. (If icons were skipped in Step 4, the last test fails; that is the guard working.)

- [ ] **Step 7: Build and load the extension manually**

Run: `pnpm --filter @twofau/extension build && ls apps/twofau-extension/dist`
Expected: `manifest.json`, `popup.html`, `popup.js`, `icons/`, `twofau_wasm_bg.wasm`, `assets/`.

Then, manually: open `chrome://extensions`, enable Developer mode, "Load unpacked", select `apps/twofau-extension/dist`. Click the 2FAU toolbar icon.
Expected: the 320px popup renders the shared UI with mock accounts and live rotating codes, no console errors. **This is a manual check — record the outcome honestly.**

- [ ] **Step 8: Commit**

```bash
git add apps/twofau-extension pnpm-lock.yaml
git commit -m "feat(extension): MV3 scaffold with the shared UI in the popup"
```

---

### Task 3: Chunked sync storage (`VaultRepo`)

Pure storage: moves an opaque blob in and out of `chrome.storage` with a manifest commit point, torn-read fallback, and revision conflict reporting. It knows nothing about crypto.

**Files:**
- Create: `apps/twofau-extension/src/vault/base64.ts`
- Create: `apps/twofau-extension/src/vault/vault-repo.ts`
- Create: `apps/twofau-extension/src/test/fake-chrome.ts`
- Test: `apps/twofau-extension/src/vault/vault-repo.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (uses only `chrome.storage`).
- Produces:
  - `bytesToB64(bytes: Uint8Array): string`, `b64ToBytes(b64: string): Uint8Array`
  - `interface VaultManifest { version: number; revision: number; chunks: number; salt: string; kdfId: number }`
  - `interface LoadedVault { blob: Uint8Array; manifest: VaultManifest }`
  - `type SaveResult = { ok: true; manifest: VaultManifest } | { ok: false; conflict: LoadedVault }`
  - `class VaultQuotaError extends Error`
  - `class VaultRepo { constructor(area?: "sync" | "local"); hasVault(): Promise<boolean>; load(): Promise<LoadedVault | null>; save(blob: Uint8Array, salt: string, kdfId: number, baseRevision: number): Promise<SaveResult> }`
  - `installFakeChrome(): FakeChrome` from `src/test/fake-chrome.ts`

- [ ] **Step 1: Write the base64 helpers**

Create `apps/twofau-extension/src/vault/base64.ts`:

```ts
// chrome.storage values must be JSON-serialisable, so the blob travels as
// base64. btoa/atob exist in every extension context (popup, options, worker).

export function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
```

- [ ] **Step 2: Write the fake chrome.storage test double**

Create `apps/twofau-extension/src/test/fake-chrome.ts`:

```ts
// Minimal in-memory stand-in for the chrome.storage areas the extension uses.
// Enforces the real sync quota so quota handling is actually exercised.

const SYNC_QUOTA_BYTES = 102_400;

export interface FakeArea {
  data: Record<string, unknown>;
  get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

function areaSize(data: Record<string, unknown>): number {
  return Object.entries(data).reduce(
    (total, [key, value]) => total + key.length + JSON.stringify(value).length,
    0,
  );
}

function makeArea(quotaBytes: number | null): FakeArea {
  const area: FakeArea = {
    data: {},
    async get(keys) {
      if (keys === undefined || keys === null) return { ...area.data };
      const list = typeof keys === "string" ? [keys] : keys;
      const out: Record<string, unknown> = {};
      for (const key of list) if (key in area.data) out[key] = area.data[key];
      return out;
    },
    async set(items) {
      const next = { ...area.data, ...items };
      if (quotaBytes !== null && areaSize(next) > quotaBytes) {
        throw new Error("QUOTA_BYTES quota exceeded");
      }
      area.data = next;
    },
    async remove(keys) {
      for (const key of typeof keys === "string" ? [keys] : keys) delete area.data[key];
    },
    async clear() {
      area.data = {};
    },
  };
  return area;
}

export interface FakeChrome {
  sync: FakeArea;
  local: FakeArea;
  session: FakeArea;
}

/** Install a fake `chrome` global and return its areas for assertions. */
export function installFakeChrome(): FakeChrome {
  const fake: FakeChrome = {
    sync: makeArea(SYNC_QUOTA_BYTES),
    local: makeArea(null),
    session: makeArea(null),
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { sync: fake.sync, local: fake.local, session: fake.session },
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
  };
  return fake;
}
```

- [ ] **Step 3: Write the failing repo tests**

Create `apps/twofau-extension/src/vault/vault-repo.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeChrome, type FakeChrome } from "../test/fake-chrome";
import { bytesToB64 } from "./base64";
import { VaultQuotaError, VaultRepo } from "./vault-repo";

const SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const KDF_ID = 1;

let fake: FakeChrome;
let repo: VaultRepo;

function blobOf(size: number, fill: number): Uint8Array {
  return new Uint8Array(size).fill(fill);
}

beforeEach(() => {
  fake = installFakeChrome();
  repo = new VaultRepo();
});

describe("VaultRepo", () => {
  it("reports no vault before the first save", async () => {
    expect(await repo.hasVault()).toBe(false);
    expect(await repo.load()).toBeNull();
  });

  it("round-trips a blob larger than one chunk", async () => {
    const blob = blobOf(20_000, 7);
    const saved = await repo.save(blob, SALT, KDF_ID, 0);
    expect(saved.ok).toBe(true);

    const loaded = await repo.load();
    expect(loaded?.blob).toEqual(blob);
    expect(loaded?.manifest).toMatchObject({ revision: 1, salt: SALT, kdfId: KDF_ID });
    expect(loaded!.manifest.chunks).toBeGreaterThan(1);
  });

  it("bumps the revision and deletes the previous generation", async () => {
    await repo.save(blobOf(9_000, 1), SALT, KDF_ID, 0);
    const second = await repo.save(blobOf(300, 2), SALT, KDF_ID, 1);
    expect(second.ok && second.manifest.revision).toBe(2);

    const leftovers = Object.keys(fake.sync.data).filter((k) => k.startsWith("v1.chunk."));
    expect(leftovers).toEqual([]);
  });

  it("reports a conflict when the stored revision moved on", async () => {
    const remote = blobOf(100, 9);
    await repo.save(remote, SALT, KDF_ID, 0); // another browser got there first

    const result = await repo.save(blobOf(100, 3), SALT, KDF_ID, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict.blob).toEqual(remote);
      expect(result.conflict.manifest.revision).toBe(1);
    }
  });

  it("falls back to the local mirror when a chunk is missing", async () => {
    const blob = blobOf(20_000, 5);
    await repo.save(blob, SALT, KDF_ID, 0);
    await repo.load(); // populates the mirror

    delete fake.sync.data["v1.chunk.1"]; // a torn remote write

    const loaded = await repo.load();
    expect(loaded?.blob).toEqual(blob);
  });

  it("rejects a write that exceeds the sync quota", async () => {
    await expect(repo.save(blobOf(200_000, 1), SALT, KDF_ID, 0)).rejects.toBeInstanceOf(
      VaultQuotaError,
    );
    expect(await repo.hasVault()).toBe(false);
  });

  it("stores nothing recognisable as the raw blob in a single item", async () => {
    const blob = blobOf(20_000, 4);
    await repo.save(blob, SALT, KDF_ID, 0);
    expect(Object.values(fake.sync.data)).not.toContain(bytesToB64(blob));
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd /Users/jilizart/Projects/2fau-tauri && pnpm --filter @twofau/extension test 2>&1 | tail -15`
Expected: FAIL — `Failed to resolve import "./vault-repo"`.

- [ ] **Step 5: Implement the repo**

Create `apps/twofau-extension/src/vault/vault-repo.ts`:

```ts
import { b64ToBytes, bytesToB64 } from "./base64";

const MANIFEST_KEY = "vault.manifest";
const MIRROR_KEY = "vault.mirror";

export const MANIFEST_VERSION = 1;
/** chrome.storage.sync allows 8192 bytes per item; leave room for the key name
 *  and JSON quoting. */
export const CHUNK_CHARS = 6144;
/** chrome.storage.sync total budget. */
export const QUOTA_BYTES = 102_400;

export interface VaultManifest {
  version: number;
  revision: number;
  chunks: number;
  salt: string;
  kdfId: number;
}

export interface LoadedVault {
  blob: Uint8Array;
  manifest: VaultManifest;
}

export type SaveResult =
  | { ok: true; manifest: VaultManifest }
  | { ok: false; conflict: LoadedVault };

/** The vault no longer fits in chrome.storage.sync. */
export class VaultQuotaError extends Error {
  constructor() {
    super("This vault no longer fits in Chrome's sync storage (100 KB limit).");
    this.name = "VaultQuotaError";
  }
}

function chunkKey(revision: number, index: number): string {
  return `v${revision}.chunk.${index}`;
}

function split(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_CHARS) out.push(text.slice(i, i + CHUNK_CHARS));
  return out.length > 0 ? out : [""];
}

/**
 * Moves the sealed vault blob in and out of chrome.storage as base64 chunks.
 *
 * The manifest is the commit point: chunks for a new generation are written
 * first, then the manifest, then the old generation is deleted. A concurrent
 * reader therefore sees either the old manifest with its intact generation, or
 * the new manifest with its intact generation — never a mix.
 */
export class VaultRepo {
  private readonly area: chrome.storage.StorageArea;

  constructor(private readonly areaName: "sync" | "local" = "sync") {
    this.area = chrome.storage[areaName];
  }

  async hasVault(): Promise<boolean> {
    return (await this.loadManifest()) !== null;
  }

  async loadManifest(): Promise<VaultManifest | null> {
    const got = await this.area.get(MANIFEST_KEY);
    return (got[MANIFEST_KEY] as VaultManifest | undefined) ?? null;
  }

  async load(): Promise<LoadedVault | null> {
    const manifest = await this.loadManifest();
    if (!manifest) return null;

    const keys = Array.from({ length: manifest.chunks }, (_, i) => chunkKey(manifest.revision, i));
    const got = await this.area.get(keys);
    const parts = keys.map((k) => got[k] as string | undefined);

    if (parts.some((p) => p === undefined)) {
      // A torn remote write: the manifest landed before all of its chunks.
      // Serve the last blob we read successfully rather than a corrupt one.
      const mirror = await this.readMirror();
      if (mirror) return mirror;
      throw new Error("Vault data is incomplete and no local copy is available.");
    }

    const loaded = { blob: b64ToBytes(parts.join("")), manifest };
    await this.writeMirror(loaded);
    return loaded;
  }

  async save(
    blob: Uint8Array,
    salt: string,
    kdfId: number,
    baseRevision: number,
  ): Promise<SaveResult> {
    const current = await this.loadManifest();
    if ((current?.revision ?? 0) !== baseRevision) {
      const conflict = await this.load();
      if (conflict) return { ok: false, conflict };
    }

    const revision = (current?.revision ?? 0) + 1;
    const parts = split(bytesToB64(blob));
    const manifest: VaultManifest = {
      version: MANIFEST_VERSION,
      revision,
      chunks: parts.length,
      salt,
      kdfId,
    };

    const items: Record<string, string> = {};
    parts.forEach((part, i) => {
      items[chunkKey(revision, i)] = part;
    });

    if (this.areaName === "sync" && this.estimateBytes(items, manifest) > QUOTA_BYTES) {
      throw new VaultQuotaError();
    }

    try {
      await this.area.set(items); // chunks first...
      await this.area.set({ [MANIFEST_KEY]: manifest }); // ...manifest commits.
    } catch (err) {
      if (String(err).includes("QUOTA_BYTES")) throw new VaultQuotaError();
      throw err;
    }

    if (current) {
      await this.area.remove(
        Array.from({ length: current.chunks }, (_, i) => chunkKey(current.revision, i)),
      );
    }
    await this.writeMirror({ blob, manifest });
    return { ok: true, manifest };
  }

  /** Rough size of what this write will occupy, including the manifest. */
  private estimateBytes(items: Record<string, string>, manifest: VaultManifest): number {
    const chunkBytes = Object.entries(items).reduce(
      (total, [key, value]) => total + key.length + value.length + 2,
      0,
    );
    return chunkBytes + MANIFEST_KEY.length + JSON.stringify(manifest).length;
  }

  private async readMirror(): Promise<LoadedVault | null> {
    const got = await chrome.storage.local.get(MIRROR_KEY);
    const mirror = got[MIRROR_KEY] as { blob: string; manifest: VaultManifest } | undefined;
    return mirror ? { blob: b64ToBytes(mirror.blob), manifest: mirror.manifest } : null;
  }

  private async writeMirror(loaded: LoadedVault): Promise<void> {
    // Ciphertext only — the mirror is no more sensitive than the sync copy.
    await chrome.storage.local.set({
      [MIRROR_KEY]: { blob: bytesToB64(loaded.blob), manifest: loaded.manifest },
    });
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @twofau/extension test 2>&1 | tail -15`
Expected: PASS — 7 `VaultRepo` tests plus the 5 manifest tests.

- [ ] **Step 7: Commit**

```bash
git add apps/twofau-extension/src/vault apps/twofau-extension/src/test
git commit -m "feat(extension): chunked sync vault storage with a manifest commit point"
```

---

### Task 4: Session key and auto-lock

**Files:**
- Create: `apps/twofau-extension/src/vault/session-key.ts`
- Create: `apps/twofau-extension/src/vault/settings.ts`
- Test: `apps/twofau-extension/src/vault/session-key.test.ts`

**Interfaces:**
- Consumes: `installFakeChrome()` from Task 3.
- Produces:
  - `AUTO_LOCK_ALARM = "2fau.auto-lock"`, `DEFAULT_AUTO_LOCK_MINUTES = 15`
  - `getSessionKey(): Promise<string | null>`, `setSessionKey(keyB64: string): Promise<void>`, `clearSessionKey(): Promise<void>`, `touchSessionKey(): Promise<void>`
  - `interface Settings { autoLockMinutes: number; storageArea: "sync" | "local" }`, `readSettings(): Promise<Settings>`, `writeSettings(patch: Partial<Settings>): Promise<Settings>`

- [ ] **Step 1: Extend the fake chrome with alarms**

In `apps/twofau-extension/src/test/fake-chrome.ts`, add to `FakeChrome`:

```ts
export interface FakeAlarms {
  created: Record<string, number>;
  create(name: string, info: { delayInMinutes: number }): void;
  clear(name: string): Promise<boolean>;
}
```

and inside `installFakeChrome`, before assigning the global:

```ts
  const alarms: FakeAlarms = {
    created: {},
    create(name, info) {
      alarms.created[name] = info.delayInMinutes;
    },
    async clear(name) {
      const existed = name in alarms.created;
      delete alarms.created[name];
      return existed;
    },
  };
```

Add `alarms` to the returned object and to the assigned `chrome` global (`{ storage: {...}, alarms, runtime: {...} }`), and add `alarms: FakeAlarms` to the `FakeChrome` interface.

- [ ] **Step 2: Write the failing tests**

Create `apps/twofau-extension/src/vault/session-key.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeChrome, type FakeChrome } from "../test/fake-chrome";
import { readSettings, writeSettings } from "./settings";
import {
  AUTO_LOCK_ALARM,
  DEFAULT_AUTO_LOCK_MINUTES,
  clearSessionKey,
  getSessionKey,
  setSessionKey,
  touchSessionKey,
} from "./session-key";

let fake: FakeChrome;

beforeEach(() => {
  fake = installFakeChrome();
});

describe("session key", () => {
  it("starts absent", async () => {
    expect(await getSessionKey()).toBeNull();
  });

  it("stores the key in session storage and arms the auto-lock alarm", async () => {
    await setSessionKey("a2V5");
    expect(await getSessionKey()).toBe("a2V5");
    expect(fake.session.data["vault.key"]).toBe("a2V5");
    expect(fake.local.data["vault.key"]).toBeUndefined();
    expect(fake.alarms.created[AUTO_LOCK_ALARM]).toBe(DEFAULT_AUTO_LOCK_MINUTES);
  });

  it("clears the key and the alarm on lock", async () => {
    await setSessionKey("a2V5");
    await clearSessionKey();
    expect(await getSessionKey()).toBeNull();
    expect(fake.alarms.created[AUTO_LOCK_ALARM]).toBeUndefined();
  });

  it("re-arms the alarm on activity, but only while unlocked", async () => {
    await touchSessionKey();
    expect(fake.alarms.created[AUTO_LOCK_ALARM]).toBeUndefined();

    await setSessionKey("a2V5");
    await writeSettings({ autoLockMinutes: 5 });
    await touchSessionKey();
    expect(fake.alarms.created[AUTO_LOCK_ALARM]).toBe(5);
  });
});

describe("settings", () => {
  it("defaults, then persists a patch", async () => {
    expect(await readSettings()).toEqual({
      autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
      storageArea: "sync",
    });
    expect(await writeSettings({ storageArea: "local" })).toEqual({
      autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
      storageArea: "local",
    });
    expect((await readSettings()).storageArea).toBe("local");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @twofau/extension test session-key 2>&1 | tail -10`
Expected: FAIL — `Failed to resolve import "./settings"`.

- [ ] **Step 4: Implement settings**

Create `apps/twofau-extension/src/vault/settings.ts`:

```ts
export const DEFAULT_AUTO_LOCK_MINUTES = 15;

const SETTINGS_KEY = "settings";

export interface Settings {
  /** Minutes of inactivity before the session key is dropped. */
  autoLockMinutes: number;
  /** Where the vault lives. "local" keeps it on this browser only. */
  storageArea: "sync" | "local";
}

const DEFAULTS: Settings = {
  autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
  storageArea: "sync",
};

export async function readSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULTS, ...((got[SETTINGS_KEY] as Partial<Settings> | undefined) ?? {}) };
}

export async function writeSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await readSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
```

- [ ] **Step 5: Implement the session key**

Create `apps/twofau-extension/src/vault/session-key.ts`:

```ts
import { readSettings } from "./settings";

export { DEFAULT_AUTO_LOCK_MINUTES } from "./settings";
export const AUTO_LOCK_ALARM = "2fau.auto-lock";

const KEY = "vault.key";

/**
 * The derived vault key lives in chrome.storage.session: memory-only, wiped
 * when the browser closes, and — unlike a service-worker global — it survives
 * the worker being torn down and restarted.
 */
export async function getSessionKey(): Promise<string | null> {
  const got = await chrome.storage.session.get(KEY);
  return (got[KEY] as string | undefined) ?? null;
}

export async function setSessionKey(keyB64: string): Promise<void> {
  await chrome.storage.session.set({ [KEY]: keyB64 });
  await armAutoLock();
}

export async function clearSessionKey(): Promise<void> {
  await chrome.storage.session.remove(KEY);
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
}

/** Push the auto-lock deadline back after vault activity. No-op when locked. */
export async function touchSessionKey(): Promise<void> {
  if ((await getSessionKey()) === null) return;
  await armAutoLock();
}

async function armAutoLock(): Promise<void> {
  const { autoLockMinutes } = await readSettings();
  chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: autoLockMinutes });
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @twofau/extension test 2>&1 | tail -10`
Expected: PASS — all suites.

- [ ] **Step 7: Commit**

```bash
git add apps/twofau-extension/src/vault/session-key.ts apps/twofau-extension/src/vault/settings.ts \
        apps/twofau-extension/src/vault/session-key.test.ts apps/twofau-extension/src/test/fake-chrome.ts
git commit -m "feat(extension): session-held vault key with alarm-driven auto-lock"
```

---

### Task 5: `ExtensionVaultService`

The `VaultService` implementation: crypto + the revision-guard retry loop, over `VaultRepo`.

**Files:**
- Modify: `packages/ui/src/index.ts` (export the formatting helpers the service and menu need)
- Create: `apps/twofau-extension/src/vault/extension-vault-service.ts`
- Create: `apps/twofau-extension/src/vault/backend.ts`
- Create: `apps/twofau-extension/src/test/setup-wasm.ts`
- Modify: `apps/twofau-extension/vite.config.ts` (add the test setup file)
- Test: `apps/twofau-extension/src/vault/extension-vault-service.test.ts`

**Interfaces:**
- Consumes: `VaultRepo`, `LoadedVault`, `SaveResult` (Task 3); `getSessionKey`, `setSessionKey`, `touchSessionKey` (Task 4); `deriveKey`, `newSalt`, `vaultSalt`, `sealWithKey`, `openWithKey`, `merge`, `totp`, `hotp`, `newId`, `nowMs`, `base32Decode`, `parseOtpauth` (Task 1 / existing `@twofau/core-wasm`).
- Produces:
  - `KDF_ID = 1`
  - `class ExtensionVaultService implements VaultService` with `static create(repo?: VaultRepo): Promise<ExtensionVaultService>` and, beyond the `VaultService` interface, `listStored(): Promise<StoredAccount[]>`
  - `createVaultService(): Promise<VaultService>` from `backend.ts`
  - From `@twofau/ui`: `algorithmArg`, `primaryName`, `secondaryName`

- [ ] **Step 1: Export the formatting helpers from the UI package**

In `packages/ui/src/index.ts`, append:

```ts
// Host apps need these to render account names and call the WASM OTP functions
// exactly the way the shared components do.
export { algorithmArg, formatCode, primaryName, secondaryName } from "@/lib/format";
```

- [ ] **Step 2: Add the WASM test setup**

Create `apps/twofau-extension/src/test/setup-wasm.ts`:

```ts
// Tests exercise the real crypto core. jsdom has no fetch for the .wasm URL, so
// initialise from the built bytes instead.
import { readFileSync } from "node:fs";
import { ensureReady } from "@twofau/core-wasm";
import { beforeAll } from "vitest";

beforeAll(async () => {
  await ensureReady(
    readFileSync(
      new URL("../../../../packages/core-wasm/pkg/twofau_wasm_bg.wasm", import.meta.url),
    ),
  );
});
```

In `apps/twofau-extension/vite.config.ts`, extend the `test` block:

```ts
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/setup-wasm.ts"],
  },
```

- [ ] **Step 3: Write the failing service tests**

Create `apps/twofau-extension/src/vault/extension-vault-service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeChrome } from "../test/fake-chrome";
import { ExtensionVaultService } from "./extension-vault-service";
import { VaultRepo } from "./vault-repo";

const PASSPHRASE = "correct-horse-battery";
const URI = "otpauth://totp/Acme:me@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Acme";

async function freshService() {
  return ExtensionVaultService.create(new VaultRepo());
}

beforeEach(() => {
  installFakeChrome();
});

describe("ExtensionVaultService", () => {
  it("asks for setup on first run and creates the vault on unlock", async () => {
    const service = await freshService();
    expect(service.needsSetup()).toBe(true);
    expect(service.isLocked()).toBe(true);

    await service.unlock(PASSPHRASE);
    expect(service.isLocked()).toBe(false);
    expect(await service.list()).toEqual([]);

    const reopened = await ExtensionVaultService.create(new VaultRepo());
    expect(reopened.needsSetup()).toBe(false);
  });

  it("rejects the wrong passphrase and stays locked", async () => {
    await (await freshService()).unlock(PASSPHRASE);
    installKeepingStorage();

    const service = await freshService();
    await expect(service.unlock("not-the-passphrase")).rejects.toThrow(/passphrase/i);
    expect(service.isLocked()).toBe(true);
  });

  it("adds, lists, updates, and removes accounts across instances", async () => {
    const service = await freshService();
    await service.unlock(PASSPHRASE);

    const added = await service.addUri(URI);
    expect(added.issuer).toBe("Acme");

    const reloaded = await freshService();
    await reloaded.unlock(PASSPHRASE);
    const [account] = await reloaded.list();
    expect(account.id).toBe(added.id);

    await reloaded.update({ ...account, label: "renamed" });
    expect((await reloaded.list())[0].label).toBe("renamed");

    await reloaded.remove(account.id);
    expect(await reloaded.list()).toEqual([]);
  });

  it("produces a six-digit code for a known secret and time", async () => {
    const service = await freshService();
    await service.unlock(PASSPHRASE);
    const account = await service.addUri(URI);
    expect(await service.code(account, 59_000)).toMatch(/^\d{6}$/);
  });

  it("advances the HOTP counter", async () => {
    const service = await freshService();
    await service.unlock(PASSPHRASE);
    const account = await service.addManual({
      issuer: "Acme",
      label: "counter",
      secretBase32: "JBSWY3DPEHPK3PXP",
      type: "hotp",
    });
    await service.advanceHotp(account.id);
    expect((await service.list())[0].counter).toBe(1);
  });

  it("merges instead of clobbering when another browser wrote first", async () => {
    const service = await freshService();
    await service.unlock(PASSPHRASE);
    const mine = await service.addUri(URI);

    // Simulate a concurrent writer: a second service instance sharing the same
    // storage adds a different account and commits at the next revision.
    const other = await freshService();
    await other.unlock(PASSPHRASE);
    const theirs = await other.addManual({
      issuer: "Other",
      label: "them",
      secretBase32: "JBSWY3DPEHPK3PXP",
      type: "totp",
    });

    // The first instance still holds the older revision; its next write must
    // merge rather than drop the other account.
    await service.update({ ...mine, label: "mine-renamed" });

    const final = await freshService();
    await final.unlock(PASSPHRASE);
    const ids = (await final.list()).map((a) => a.id).sort();
    expect(ids).toEqual([mine.id, theirs.id].sort());
    expect((await final.list()).find((a) => a.id === mine.id)?.label).toBe("mine-renamed");
  });

  it("refuses vault operations while locked", async () => {
    const service = await freshService();
    await expect(service.list()).rejects.toThrow(/locked/i);
  });
});

/** Re-install the fake chrome globals while keeping the stored data. */
function installKeepingStorage() {
  const previous = (globalThis as unknown as { chrome: { storage: Record<string, { data: unknown }> } })
    .chrome.storage;
  const sync = previous.sync.data;
  const local = previous.local.data;
  const fake = installFakeChrome();
  fake.sync.data = sync as Record<string, unknown>;
  fake.local.data = local as Record<string, unknown>;
}
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @twofau/extension test extension-vault-service 2>&1 | tail -10`
Expected: FAIL — `Failed to resolve import "./extension-vault-service"`.

- [ ] **Step 5: Implement the service**

Create `apps/twofau-extension/src/vault/extension-vault-service.ts`:

```ts
import {
  base32Decode,
  deriveKey,
  hotp,
  merge,
  newId,
  newSalt,
  nowMs,
  openWithKey,
  parseOtpauth,
  sealWithKey,
  totp,
  vaultSalt,
} from "@twofau/core-wasm";
import { algorithmArg } from "@twofau/ui";
import type { AddManualFields, Capabilities, VaultService } from "@twofau/ui";
import type { Account, StoredAccount, VaultDocument } from "@twofau/ui";
import { getSessionKey, setSessionKey, touchSessionKey } from "./session-key";
import { VaultRepo, type LoadedVault } from "./vault-repo";

/** PBKDF2-HMAC-SHA256; the only KDF the blob format defines today. */
export const KDF_ID = 1;

/** Set true once the activeTab capture spike in Task 11 confirms it works. */
const SCAN_SUPPORTED = false;

const MAX_MERGE_ATTEMPTS = 3;

/**
 * `VaultService` over the WASM core and chrome.storage. Holds no plaintext:
 * every call re-reads the session key, decrypts, does its work, and re-seals.
 */
export class ExtensionVaultService implements VaultService {
  private constructor(
    private readonly repo: VaultRepo,
    private vaultExists: boolean,
    private unlocked: boolean,
  ) {}

  static async create(repo: VaultRepo = new VaultRepo()): Promise<ExtensionVaultService> {
    const vaultExists = await repo.hasVault();
    const unlocked = vaultExists && (await getSessionKey()) !== null;
    return new ExtensionVaultService(repo, vaultExists, unlocked);
  }

  capabilities(): Capabilities {
    return { scanScreen: SCAN_SUPPORTED, qrImage: true, paste: true };
  }

  isLocked(): boolean {
    return !this.unlocked;
  }

  needsSetup(): boolean {
    return !this.vaultExists;
  }

  async unlock(passphrase: string): Promise<void> {
    const loaded = await this.repo.load();
    if (!loaded) {
      // First run: this passphrase creates the vault.
      const salt = await newSalt();
      const key = await deriveKey(passphrase, salt);
      const blob = await sealWithKey({ entries: [], tombstones: [] }, key, salt);
      await this.repo.save(blob, salt, KDF_ID, 0);
      await setSessionKey(key);
      this.vaultExists = true;
      this.unlocked = true;
      return;
    }

    const salt = await vaultSalt(loaded.blob);
    const key = await deriveKey(passphrase, salt);
    try {
      await openWithKey(loaded.blob, key);
    } catch {
      throw new Error("Wrong passphrase");
    }
    await setSessionKey(key);
    this.unlocked = true;
  }

  async list(): Promise<Account[]> {
    return (await this.listStored()).map((e) => e.account);
  }

  /** Entries with their secrets — for the service worker's code generation. */
  async listStored(): Promise<StoredAccount[]> {
    const { doc } = await this.read();
    return doc.entries;
  }

  async addUri(otpauthUri: string): Promise<Account> {
    const parsed = await parseOtpauth(otpauthUri);
    const account: Account = {
      id: await newId(),
      issuer: parsed.issuer,
      label: parsed.label,
      otp_type: parsed.otp_type,
      algorithm: parsed.algorithm,
      digits: parsed.digits,
      period: parsed.period,
      counter: parsed.counter,
    };
    await this.mutate((doc) => {
      doc.entries.push({ account, secret: parsed.secret, modified_at: Date.now() });
    });
    return account;
  }

  async addManual(fields: AddManualFields): Promise<Account> {
    const secret = await base32Decode(fields.secretBase32);
    const account: Account = {
      id: await newId(),
      issuer: fields.issuer,
      label: fields.label,
      otp_type: fields.type === "hotp" ? "Hotp" : "Totp",
      algorithm: "Sha1",
      digits: 6,
      period: 30,
      counter: 0,
    };
    await this.mutate((doc) => {
      doc.entries.push({ account, secret, modified_at: Date.now() });
    });
    return account;
  }

  async update(account: Account): Promise<void> {
    await this.mutate((doc) => {
      const entry = doc.entries.find((e) => e.account.id === account.id);
      if (entry) {
        entry.account = account;
        entry.modified_at = Date.now();
      }
    });
  }

  async remove(id: string): Promise<void> {
    await this.mutate((doc) => {
      doc.entries = doc.entries.filter((e) => e.account.id !== id);
      doc.tombstones.push({ id, deleted_at: Date.now() });
    });
  }

  async advanceHotp(id: string): Promise<void> {
    await this.mutate((doc) => {
      const entry = doc.entries.find((e) => e.account.id === id);
      if (entry) {
        entry.account = { ...entry.account, counter: entry.account.counter + 1 };
        entry.modified_at = Date.now();
      }
    });
  }

  async code(account: Account, unixTimeMs: number): Promise<string> {
    const entry = (await this.listStored()).find((e) => e.account.id === account.id);
    if (!entry) return "-".repeat(account.digits);
    const algo = algorithmArg(account.algorithm);
    if (account.otp_type === "Hotp") {
      return hotp(entry.secret, BigInt(account.counter), account.digits, algo);
    }
    return totp(
      entry.secret,
      BigInt(Math.floor(unixTimeMs / 1000)),
      account.period,
      account.digits,
      algo,
    );
  }

  // MARK: internals

  private async requireKey(): Promise<string> {
    const key = await getSessionKey();
    if (key === null) {
      this.unlocked = false;
      throw new Error("The vault is locked.");
    }
    return key;
  }

  private async read(): Promise<{ doc: VaultDocument; loaded: LoadedVault; key: string }> {
    const key = await this.requireKey();
    const loaded = await this.repo.load();
    if (!loaded) throw new Error("The vault is locked.");
    await touchSessionKey();
    return { doc: await openWithKey(loaded.blob, key), loaded, key };
  }

  /** Apply `change`, then commit with the revision guard from the spec. */
  private async mutate(change: (doc: VaultDocument) => void): Promise<void> {
    const { doc, loaded, key } = await this.read();
    change(doc);
    await this.commit(doc, loaded, key);
  }

  /**
   * Write `doc`, re-merging and retrying if another browser committed first.
   * This is the revision guard: the normal path is a plain overwrite.
   */
  private async commit(doc: VaultDocument, loaded: LoadedVault, key: string): Promise<void> {
    let next = doc;
    let base = loaded.manifest.revision;
    const salt = loaded.manifest.salt;

    for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt += 1) {
      const blob = await sealWithKey(next, key, salt);
      const result = await this.repo.save(blob, salt, KDF_ID, base);
      if (result.ok) return;

      // Another browser committed first: fold its document in and retry.
      const remote = await openWithKey(result.conflict.blob, key);
      next = await merge(next, remote);
      base = result.conflict.manifest.revision;
    }
    throw new Error("The vault is being written from another browser — try again.");
  }
}
```

- [ ] **Step 6: Add the backend seam**

Create `apps/twofau-extension/src/vault/backend.ts`:

```ts
import type { VaultService } from "@twofau/ui";
import { ExtensionVaultService } from "./extension-vault-service";
import { VaultRepo } from "./vault-repo";
import { readSettings } from "./settings";

/**
 * Picks the backend the UI talks to.
 *
 * Sub-project 5 adds the desktop app's localhost bridge here: probe it, and
 * return a `BridgeVaultService` when it answers. Nothing else in the extension
 * knows which backend it got.
 */
export async function createVaultService(): Promise<VaultService> {
  const { storageArea } = await readSettings();
  return ExtensionVaultService.create(new VaultRepo(storageArea));
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @twofau/extension test 2>&1 | tail -15`
Expected: PASS — 7 service tests plus the earlier suites.

- [ ] **Step 8: Typecheck and run the UI suite (the index export changed)**

Run: `pnpm --filter @twofau/extension typecheck && pnpm --filter @twofau/ui test 2>&1 | tail -5`
Expected: no typecheck output; UI tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src/index.ts apps/twofau-extension/src/vault apps/twofau-extension/src/test \
        apps/twofau-extension/vite.config.ts
git commit -m "feat(extension): VaultService over WASM crypto with a revision-guard commit"
```

---

### Task 6: Wire the popup to the real vault

**Files:**
- Modify: `apps/twofau-extension/src/popup/main.tsx`

**Interfaces:**
- Consumes: `createVaultService()` (Task 5), `initWasm()` (Task 2).
- Produces: a popup backed by real storage; no further interface.

- [ ] **Step 1: Replace the mock with the real service**

Rewrite `apps/twofau-extension/src/popup/main.tsx`:

```tsx
import { TwoFAUApp } from "@twofau/ui";
import type { VaultService } from "@twofau/ui";
import ReactDOM from "react-dom/client";
import { createVaultService } from "../vault/backend";
import { initWasm } from "../wasm";
import "../index.css";

function Failed({ message }: { message: string }) {
  return <p className="p-4 text-[13px] text-destructive">Could not start: {message}</p>;
}

async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
  let service: VaultService;
  try {
    // WASM first: the service constructor already needs it to read the vault.
    await initWasm();
    service = await createVaultService();
  } catch (err) {
    // An empty list would read as an empty vault, which is a lie. Say what broke.
    root.render(<Failed message={err instanceof Error ? err.message : String(err)} />);
    return;
  }
  root.render(<TwoFAUApp service={service} />);
}

void bootstrap();
```

- [ ] **Step 2: Build and typecheck**

Run: `pnpm --filter @twofau/extension build 2>&1 | tail -8`
Expected: `built in ...`, `dist/popup.js` emitted, no TS errors.

- [ ] **Step 3: Manual check — first run and unlock**

Reload the unpacked extension at `chrome://extensions`, then open the popup.
Expected: the "Create a passphrase" screen. Create one (≥ 8 chars), add an account by pasting an `otpauth://` URI, confirm the code rotates. Close and reopen the popup — accounts still there, still unlocked. Open `chrome://extensions` → service worker → `chrome.storage.sync.get(console.log)` and confirm only `vault.manifest` and `v1.chunk.*` keys exist, with no readable account data.
**Manual check — report exactly what happened, including anything that didn't work.**

- [ ] **Step 4: Commit**

```bash
git add apps/twofau-extension/src/popup/main.tsx
git commit -m "feat(extension): back the popup with the real encrypted vault"
```

---

### Task 7: Recent accounts and the context menu

**Files:**
- Create: `apps/twofau-extension/src/vault/recent.ts`
- Create: `apps/twofau-extension/src/background/context-menu.ts`
- Test: `apps/twofau-extension/src/background/context-menu.test.ts`

**Interfaces:**
- Consumes: `ExtensionVaultService` (Task 5), `getSessionKey` (Task 4), `primaryName`/`secondaryName` (Task 5 exports).
- Produces:
  - `recordUse(id: string): Promise<void>`, `recentIds(): Promise<string[]>`, `RECENT_LIMIT = 5`
  - `MENU_PARENT_ID = "2fau"`, `MENU_CODE_PREFIX = "2fau.code."`, `refreshContextMenu(): Promise<void>`, `accountIdFromMenuItem(menuItemId: string): string | null`

- [ ] **Step 1: Extend the fake chrome with contextMenus**

In `apps/twofau-extension/src/test/fake-chrome.ts`, add:

```ts
export interface FakeMenuItem {
  id: string;
  title: string;
  parentId?: string;
  enabled?: boolean;
  contexts?: string[];
}

export interface FakeContextMenus {
  items: FakeMenuItem[];
  create(item: FakeMenuItem): void;
  removeAll(): Promise<void>;
}
```

and inside `installFakeChrome`:

```ts
  const contextMenus: FakeContextMenus = {
    items: [],
    create(item) {
      contextMenus.items.push(item);
    },
    async removeAll() {
      contextMenus.items = [];
    },
  };
```

Add `contextMenus` to the `FakeChrome` interface, the returned object, and the assigned `chrome` global.

- [ ] **Step 2: Write the failing tests**

Create `apps/twofau-extension/src/background/context-menu.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeChrome, type FakeChrome } from "../test/fake-chrome";
import { ExtensionVaultService } from "../vault/extension-vault-service";
import { recordUse } from "../vault/recent";
import { clearSessionKey } from "../vault/session-key";
import { accountIdFromMenuItem, MENU_CODE_PREFIX, refreshContextMenu } from "./context-menu";

const PASSPHRASE = "correct-horse-battery";
let fake: FakeChrome;

async function seed(count: number) {
  const service = await ExtensionVaultService.create();
  await service.unlock(PASSPHRASE);
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const account = await service.addManual({
      issuer: `Issuer${i}`,
      label: `label${i}`,
      secretBase32: "JBSWY3DPEHPK3PXP",
      type: "totp",
    });
    ids.push(account.id);
  }
  return ids;
}

beforeEach(() => {
  fake = installFakeChrome();
});

describe("context menu", () => {
  it("shows a single disabled item while locked", async () => {
    await seed(1);
    await clearSessionKey();

    await refreshContextMenu();
    const children = fake.contextMenus.items.filter((i) => i.parentId);
    expect(children).toHaveLength(1);
    expect(children[0].enabled).toBe(false);
    expect(children[0].title).toMatch(/locked/i);
  });

  it("lists at most five accounts, most recently used first", async () => {
    const ids = await seed(7);
    await recordUse(ids[6]);
    await recordUse(ids[3]);

    await refreshContextMenu();
    const children = fake.contextMenus.items.filter((i) => i.parentId);
    expect(children).toHaveLength(5);
    expect(accountIdFromMenuItem(children[0].id)).toBe(ids[3]);
    expect(accountIdFromMenuItem(children[1].id)).toBe(ids[6]);
  });

  it("titles items by account name and never by code", async () => {
    await seed(1);
    await refreshContextMenu();
    const child = fake.contextMenus.items.find((i) => i.id.startsWith(MENU_CODE_PREFIX));
    expect(child?.title).toBe("label0 — Issuer0");
    expect(child?.title).not.toMatch(/\d{6}/);
  });

  it("rebuilds from scratch each time", async () => {
    await seed(2);
    await refreshContextMenu();
    await refreshContextMenu();
    expect(fake.contextMenus.items.filter((i) => !i.parentId)).toHaveLength(1);
  });
});

describe("accountIdFromMenuItem", () => {
  it("ignores menu items that aren't account codes", () => {
    expect(accountIdFromMenuItem("2fau.locked")).toBeNull();
    expect(accountIdFromMenuItem(`${MENU_CODE_PREFIX}abc`)).toBe("abc");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @twofau/extension test context-menu 2>&1 | tail -10`
Expected: FAIL — `Failed to resolve import "../vault/recent"`.

- [ ] **Step 4: Implement the recency list**

Create `apps/twofau-extension/src/vault/recent.ts`:

```ts
const RECENT_KEY = "recent";

/** How many accounts the context menu offers. */
export const RECENT_LIMIT = 5;

/** Account ids, most recently used first. Ids only — no secrets, no codes. */
export async function recentIds(): Promise<string[]> {
  const got = await chrome.storage.local.get(RECENT_KEY);
  return (got[RECENT_KEY] as string[] | undefined) ?? [];
}

export async function recordUse(id: string): Promise<void> {
  const next = [id, ...(await recentIds()).filter((x) => x !== id)].slice(0, RECENT_LIMIT * 2);
  await chrome.storage.local.set({ [RECENT_KEY]: next });
}
```

- [ ] **Step 5: Implement the context menu**

Create `apps/twofau-extension/src/background/context-menu.ts`:

```ts
import { primaryName, secondaryName } from "@twofau/ui";
import type { Account } from "@twofau/ui";
import { createVaultService } from "../vault/backend";
import { recentIds, RECENT_LIMIT } from "../vault/recent";

export const MENU_PARENT_ID = "2fau";
export const MENU_CODE_PREFIX = "2fau.code.";
const MENU_LOCKED_ID = "2fau.locked";

/** The account id behind a menu item, or null for anything else. */
export function accountIdFromMenuItem(menuItemId: string): string | null {
  return menuItemId.startsWith(MENU_CODE_PREFIX)
    ? menuItemId.slice(MENU_CODE_PREFIX.length)
    : null;
}

/**
 * Rebuild the quick-copy menu: the five most recently used accounts, titled by
 * name. Codes are deliberately not in the titles — they rotate every 30s, so
 * live titles would mean constant churn, and a code sitting in an OS menu is a
 * needless exposure. The code is generated when an item is clicked.
 */
export async function refreshContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_PARENT_ID,
    title: "2FAU",
    contexts: ["all"],
  });

  const service = await createVaultService();
  if (service.isLocked()) {
    chrome.contextMenus.create({
      id: MENU_LOCKED_ID,
      parentId: MENU_PARENT_ID,
      title: "Locked — open 2FAU to unlock",
      enabled: false,
      contexts: ["all"],
    });
    return;
  }

  for (const account of orderByRecency(await service.list(), await recentIds())) {
    const secondary = secondaryName(account);
    chrome.contextMenus.create({
      id: `${MENU_CODE_PREFIX}${account.id}`,
      parentId: MENU_PARENT_ID,
      title: secondary ? `${primaryName(account)} — ${secondary}` : primaryName(account),
      contexts: ["all"],
    });
  }
}

function orderByRecency(accounts: Account[], recent: string[]): Account[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ordered = recent.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const seen = new Set(ordered.map((a) => a.id));
  return [...ordered, ...accounts.filter((a) => !seen.has(a.id))].slice(0, RECENT_LIMIT);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @twofau/extension test 2>&1 | tail -12`
Expected: PASS — 5 context-menu tests plus the earlier suites.

- [ ] **Step 7: Commit**

```bash
git add apps/twofau-extension/src/vault/recent.ts apps/twofau-extension/src/background \
        apps/twofau-extension/src/test/fake-chrome.ts
git commit -m "feat(extension): recent-accounts quick-copy context menu"
```

---

### Task 8: Service worker — clipboard copy and lifecycle

**Files:**
- Create: `apps/twofau-extension/offscreen.html`
- Create: `apps/twofau-extension/src/offscreen/clipboard.ts`
- Create: `apps/twofau-extension/src/background/clipboard.ts`
- Create: `apps/twofau-extension/src/background/index.ts`
- Modify: `apps/twofau-extension/manifest.json` (background entry, commands)
- Modify: `apps/twofau-extension/vite.config.ts` (background + offscreen entries)
- Modify: `apps/twofau-extension/src/manifest.test.ts` (assert the new keys)

**Interfaces:**
- Consumes: `refreshContextMenu`, `accountIdFromMenuItem` (Task 7); `recordUse` (Task 7); `createVaultService` (Task 5); `AUTO_LOCK_ALARM`, `clearSessionKey` (Task 4); `initWasm` (Task 2).
- Produces: `copyToClipboard(text: string): Promise<void>`; `COPY_MESSAGE = "2fau.copy"`.

- [ ] **Step 1: Add the offscreen document**

Create `apps/twofau-extension/offscreen.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>2FAU clipboard</title>
  </head>
  <body>
    <textarea id="sink"></textarea>
    <script type="module" src="/src/offscreen/clipboard.ts"></script>
  </body>
</html>
```

Create `apps/twofau-extension/src/offscreen/clipboard.ts`:

```ts
// A service worker has no DOM, so clipboard writes happen here. execCommand is
// deprecated on the web but is the supported path for offscreen documents:
// navigator.clipboard requires document focus, which an offscreen document
// never has.
export const COPY_MESSAGE = "2fau.copy";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== COPY_MESSAGE) return undefined;
  const sink = document.getElementById("sink") as HTMLTextAreaElement;
  sink.value = String(message.text ?? "");
  sink.select();
  const ok = document.execCommand("copy");
  sink.value = "";
  sendResponse({ ok });
  return true;
});
```

- [ ] **Step 2: Add the service-worker clipboard bridge**

Create `apps/twofau-extension/src/background/clipboard.ts`:

```ts
export const COPY_MESSAGE = "2fau.copy";

const OFFSCREEN_PATH = "offscreen.html";

/** Copy `text` via the offscreen document. Works on chrome:// pages and PDFs,
 *  and needs no host permission. */
export async function copyToClipboard(text: string): Promise<void> {
  await ensureOffscreen();
  const response = (await chrome.runtime.sendMessage({ type: COPY_MESSAGE, text })) as
    | { ok: boolean }
    | undefined;
  if (!response?.ok) throw new Error("Could not write to the clipboard.");
}

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.CLIPBOARD],
    justification: "Copy a one-time code to the clipboard from the context menu.",
  });
}
```

- [ ] **Step 3: Add the service-worker entry point**

Create `apps/twofau-extension/src/background/index.ts`:

```ts
import { createVaultService } from "../vault/backend";
import { recordUse } from "../vault/recent";
import { AUTO_LOCK_ALARM, clearSessionKey } from "../vault/session-key";
import { initWasm } from "../wasm";
import { copyToClipboard } from "./clipboard";
import { accountIdFromMenuItem, refreshContextMenu } from "./context-menu";

// No module-level state beyond these listener registrations: the worker is torn
// down whenever Chrome feels like it, so every handler re-reads from storage.

chrome.runtime.onInstalled.addListener(() => void refreshContextMenu());
chrome.runtime.onStartup.addListener(() => void refreshContextMenu());

// Lock state and the account list both live in storage; rebuild the menu when
// either changes.
chrome.storage.onChanged.addListener((changes, area) => {
  const relevant =
    (area === "session" && "vault.key" in changes) ||
    (area !== "session" && ("vault.manifest" in changes || "recent" in changes));
  if (relevant) void refreshContextMenu();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTO_LOCK_ALARM) return;
  await clearSessionKey();
  await refreshContextMenu();
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const id = accountIdFromMenuItem(String(info.menuItemId));
  if (!id) return;

  await chrome.action.setBadgeText({ text: "" });
  try {
    await initWasm();
    const service = await createVaultService();
    const account = (await service.list()).find((a) => a.id === id);
    if (!account) return;

    const code = await service.code(account, Date.now());
    await copyToClipboard(code);
    if (account.otp_type === "Hotp") await service.advanceHotp(account.id);
    await recordUse(account.id);
    await flashBadge("✓", "#2f9e44");
  } catch {
    await flashBadge("!", "#e03131");
  }
});

/** Confirm the action visually — a silent copy is indistinguishable from a
 *  failure. Best-effort: the badge clears on the next copy regardless. */
async function flashBadge(text: string, color: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: "" }), 1500);
}
```

- [ ] **Step 4: Register the new entries**

In `apps/twofau-extension/manifest.json`, add after `"action"`:

```json
  "background": { "service_worker": "background.js", "type": "module" },
  "commands": {
    "_execute_action": {
      "suggested_key": { "default": "Ctrl+Shift+U", "mac": "Command+Shift+U" }
    }
  },
```

In `apps/twofau-extension/vite.config.ts`, replace the `input` block:

```ts
      input: {
        popup: entry("popup.html"),
        offscreen: entry("offscreen.html"),
        background: entry("src/background/index.ts"),
      },
```

- [ ] **Step 5: Extend the manifest guard test**

Append to the `describe("manifest.json", ...)` block in `apps/twofau-extension/src/manifest.test.ts`:

```ts
  it("registers the service worker as a module", () => {
    expect(manifest.background).toEqual({ service_worker: "background.js", type: "module" });
  });

  it("binds a shortcut that opens the popup", () => {
    expect(manifest.commands._execute_action.suggested_key.default).toBe("Ctrl+Shift+U");
  });
```

- [ ] **Step 6: Build and run the tests**

Run: `pnpm --filter @twofau/extension test && pnpm --filter @twofau/extension build 2>&1 | tail -10`
Expected: all tests PASS; `dist/background.js`, `dist/offscreen.html`, `dist/offscreen.js` emitted.

- [ ] **Step 7: Manual check — the context menu**

Reload the unpacked extension. Unlock the popup, then right-click on a normal web page → "2FAU" → pick an account. Paste somewhere.
Expected: the current code is pasted; the toolbar badge flashes a green ✓. Repeat on a `chrome://extensions` tab — it must still work (that's the point of the offscreen path). Lock (wait out the auto-lock or clear `vault.key` from the service worker console) and confirm the submenu shows the disabled "Locked" item.
Also press `Ctrl+Shift+U` / `Cmd+Shift+U` and confirm the popup opens.
**Manual check — report exactly what happened.**

- [ ] **Step 8: Commit**

```bash
git add apps/twofau-extension/offscreen.html apps/twofau-extension/src/offscreen \
        apps/twofau-extension/src/background apps/twofau-extension/manifest.json \
        apps/twofau-extension/vite.config.ts apps/twofau-extension/src/manifest.test.ts
git commit -m "feat(extension): copy codes from the context menu via an offscreen document"
```

---

### Task 9: Options page

**Files:**
- Create: `apps/twofau-extension/options.html`
- Create: `apps/twofau-extension/src/options/main.tsx`
- Create: `apps/twofau-extension/src/options/options-view.tsx`
- Create: `apps/twofau-extension/src/vault/usage.ts`
- Modify: `apps/twofau-extension/manifest.json` (`options_page`)
- Modify: `apps/twofau-extension/vite.config.ts` (options entry)
- Test: `apps/twofau-extension/src/vault/usage.test.ts`

**Interfaces:**
- Consumes: `readSettings`, `writeSettings`, `Settings` (Task 4); `QUOTA_BYTES` (Task 3).
- Produces: `syncUsage(): Promise<{ bytes: number; quota: number; percent: number }>`.

- [ ] **Step 1: Write the failing usage test**

Create `apps/twofau-extension/src/vault/usage.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeChrome, type FakeChrome } from "../test/fake-chrome";
import { QUOTA_BYTES } from "./vault-repo";
import { syncUsage } from "./usage";

let fake: FakeChrome;

beforeEach(() => {
  fake = installFakeChrome();
});

describe("syncUsage", () => {
  it("is zero for an empty area", async () => {
    expect(await syncUsage()).toEqual({ bytes: 0, quota: QUOTA_BYTES, percent: 0 });
  });

  it("counts key names and JSON-encoded values", async () => {
    await fake.sync.set({ ab: "cd" }); // 2 + 4 ("cd" with quotes) = 6
    const usage = await syncUsage();
    expect(usage.bytes).toBe(6);
    expect(usage.percent).toBeCloseTo((6 / QUOTA_BYTES) * 100, 5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @twofau/extension test usage 2>&1 | tail -8`
Expected: FAIL — `Failed to resolve import "./usage"`.

- [ ] **Step 3: Implement usage**

Create `apps/twofau-extension/src/vault/usage.ts`:

```ts
import { QUOTA_BYTES } from "./vault-repo";

export interface SyncUsage {
  bytes: number;
  quota: number;
  percent: number;
}

/**
 * How much of the 100 KB sync budget the vault occupies. Computed rather than
 * read from getBytesInUse so it works identically under test.
 */
export async function syncUsage(): Promise<SyncUsage> {
  const all = await chrome.storage.sync.get(null);
  const bytes = Object.entries(all).reduce(
    (total, [key, value]) => total + key.length + JSON.stringify(value).length,
    0,
  );
  return { bytes, quota: QUOTA_BYTES, percent: (bytes / QUOTA_BYTES) * 100 };
}
```

- [ ] **Step 4: Build the options page**

Create `apps/twofau-extension/options.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>2FAU settings</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/options/main.tsx"></script>
  </body>
</html>
```

Create `apps/twofau-extension/src/options/options-view.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { readSettings, writeSettings, type Settings } from "../vault/settings";
import { syncUsage, type SyncUsage } from "../vault/usage";

export function OptionsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [usage, setUsage] = useState<SyncUsage | null>(null);

  useEffect(() => {
    void (async () => {
      setSettings(await readSettings());
      setUsage(await syncUsage());
    })();
  }, []);

  if (!settings) return <p className="p-6 text-[13px]">Loading…</p>;

  async function patch(next: Partial<Settings>) {
    setSettings(await writeSettings(next));
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="text-[17px] font-semibold">2FAU settings</h1>

      <section className="flex flex-col gap-1.5">
        <label className="text-[13px] font-medium" htmlFor="auto-lock">
          Auto-lock after
        </label>
        <Input
          id="auto-lock"
          type="number"
          min={1}
          max={480}
          value={settings.autoLockMinutes}
          onChange={(e) => void patch({ autoLockMinutes: Number(e.target.value) || 1 })}
        />
        <p className="text-[11px] text-muted-foreground">
          Minutes of inactivity before the passphrase is required again.
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Storage</span>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={settings.storageArea === "sync"}
            onChange={(e) => void patch({ storageArea: e.target.checked ? "sync" : "local" })}
          />
          Sync the encrypted vault across my Chrome profile
        </label>
        {usage && (
          <p className="text-[11px] text-muted-foreground">
            Using {(usage.bytes / 1024).toFixed(1)} KB of {(usage.quota / 1024).toFixed(0)} KB (
            {usage.percent.toFixed(0)}%).
          </p>
        )}
      </section>

      <section className="flex flex-col gap-1.5" id="vault">
        <span className="text-[13px] font-medium">Vault</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled title="Added in the next task">
            Change passphrase
          </Button>
        </div>
      </section>
    </div>
  );
}
```

Create `apps/twofau-extension/src/options/main.tsx`:

```tsx
import ReactDOM from "react-dom/client";
import { initWasm } from "../wasm";
import { OptionsView } from "./options-view";
import "../index.css";

async function bootstrap() {
  await initWasm();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<OptionsView />);
}

void bootstrap();
```

The popup pins `body` to 320px; scope that to the popup only. In `apps/twofau-extension/src/index.css`, replace the `html, body` rule with:

```css
html,
body {
  margin: 0;
}

/* The popup is a fixed-width panel; the options page is not. */
body:has(> #root > .w-\[320px\]) {
  width: 320px;
}
```

- [ ] **Step 5: Register the options page**

In `apps/twofau-extension/manifest.json`, add after `"action"`:

```json
  "options_page": "options.html",
```

In `apps/twofau-extension/vite.config.ts`, add to `input`:

```ts
        options: entry("options.html"),
```

Append to the manifest guard test in `apps/twofau-extension/src/manifest.test.ts`, inside the existing "only references files that exist" test:

```ts
    expect(existsSync(root(manifest.options_page))).toBe(true);
```

- [ ] **Step 6: Run tests and build**

Run: `pnpm --filter @twofau/extension test && pnpm --filter @twofau/extension build 2>&1 | tail -10`
Expected: all PASS; `dist/options.html` and `dist/options.js` emitted.

- [ ] **Step 7: Manual check**

Reload the extension, right-click the toolbar icon → Options.
Expected: the settings page renders, the auto-lock value persists across a reload, and the usage figure is non-zero once a vault exists.
**Manual check — report what happened.**

- [ ] **Step 8: Commit**

```bash
git add apps/twofau-extension/options.html apps/twofau-extension/src/options \
        apps/twofau-extension/src/vault/usage.ts apps/twofau-extension/src/vault/usage.test.ts \
        apps/twofau-extension/src/index.css apps/twofau-extension/manifest.json \
        apps/twofau-extension/vite.config.ts apps/twofau-extension/src/manifest.test.ts
git commit -m "feat(extension): options page with auto-lock, storage area, and quota usage"
```

---

### Task 10: Change passphrase, export, and import

**Files:**
- Create: `apps/twofau-extension/src/vault/transfer.ts`
- Modify: `apps/twofau-extension/src/vault/extension-vault-service.ts` (add `changePassphrase`, `exportBlob`, `importBlob`)
- Modify: `apps/twofau-extension/src/options/options-view.tsx`
- Test: `apps/twofau-extension/src/vault/transfer.test.ts`

**Interfaces:**
- Consumes: `ExtensionVaultService` (Task 5).
- Produces on `ExtensionVaultService`:
  - `changePassphrase(current: string, next: string): Promise<void>`
  - `exportBlob(): Promise<Uint8Array>`
  - `importBlob(blob: Uint8Array, passphrase: string): Promise<number>` — returns the number of accounts after the merge
- Produces in `transfer.ts`: `downloadBlob(blob: Uint8Array, filename: string): void`, `readFileBytes(file: File): Promise<Uint8Array>`

- [ ] **Step 1: Write the failing tests**

Create `apps/twofau-extension/src/vault/transfer.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeChrome } from "../test/fake-chrome";
import { ExtensionVaultService } from "./extension-vault-service";

const PASSPHRASE = "correct-horse-battery";
const NEXT = "tr0ubador-and-more";

async function unlocked() {
  const service = await ExtensionVaultService.create();
  await service.unlock(PASSPHRASE);
  return service;
}

beforeEach(() => {
  installFakeChrome();
});

describe("changePassphrase", () => {
  it("re-seals under the new passphrase and rejects the old one", async () => {
    const service = await unlocked();
    await service.addManual({
      issuer: "Acme",
      label: "me",
      secretBase32: "JBSWY3DPEHPK3PXP",
      type: "totp",
    });

    await service.changePassphrase(PASSPHRASE, NEXT);

    const reopened = await ExtensionVaultService.create();
    await expect(reopened.unlock(PASSPHRASE)).rejects.toThrow(/passphrase/i);
    await reopened.unlock(NEXT);
    expect(await reopened.list()).toHaveLength(1);
  });

  it("refuses a wrong current passphrase", async () => {
    const service = await unlocked();
    await expect(service.changePassphrase("wrong", NEXT)).rejects.toThrow(/passphrase/i);
  });
});

describe("export / import", () => {
  it("exports a blob that imports back, merging rather than replacing", async () => {
    const source = await unlocked();
    const exported = await source.addManual({
      issuer: "Exported",
      label: "one",
      secretBase32: "JBSWY3DPEHPK3PXP",
      type: "totp",
    });
    const blob = await source.exportBlob();

    // A different browser with a different vault and its own account.
    installFakeChrome();
    const target = await ExtensionVaultService.create();
    await target.unlock("another-passphrase-x");
    await target.addManual({
      issuer: "Local",
      label: "two",
      secretBase32: "JBSWY3DPEHPK3PXP",
      type: "totp",
    });

    expect(await target.importBlob(blob, PASSPHRASE)).toBe(2);
    const ids = (await target.list()).map((a) => a.id);
    expect(ids).toContain(exported.id);
  });

  it("rejects an import with the wrong passphrase", async () => {
    const service = await unlocked();
    const blob = await service.exportBlob();
    await expect(service.importBlob(blob, "nope-nope-nope")).rejects.toThrow(/passphrase/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @twofau/extension test transfer 2>&1 | tail -8`
Expected: FAIL — `service.changePassphrase is not a function`.

- [ ] **Step 3: Implement the service methods**

In `apps/twofau-extension/src/vault/extension-vault-service.ts`, add these methods after `code()`. (`merge`, `deriveKey`, `newSalt`, `vaultSalt`, `sealWithKey`, `openWithKey`, and `setSessionKey` are already imported from Task 5.)

```ts
  /** Re-derive under a new passphrase and re-seal with a fresh salt. */
  async changePassphrase(current: string, next: string): Promise<void> {
    const loaded = await this.repo.load();
    if (!loaded) throw new Error("There is no vault to re-encrypt.");

    const currentKey = await deriveKey(current, await vaultSalt(loaded.blob));
    let doc: VaultDocument;
    try {
      doc = await openWithKey(loaded.blob, currentKey);
    } catch {
      throw new Error("Wrong passphrase");
    }

    const salt = await newSalt();
    const key = await deriveKey(next, salt);
    const blob = await sealWithKey(doc, key, salt);
    const result = await this.repo.save(blob, salt, KDF_ID, loaded.manifest.revision);
    if (!result.ok) {
      throw new Error("The vault changed in another browser — reopen and try again.");
    }
    await setSessionKey(key);
    this.unlocked = true;
  }

  /** The sealed blob exactly as stored — same format as the desktop vault.dat. */
  async exportBlob(): Promise<Uint8Array> {
    const loaded = await this.repo.load();
    if (!loaded) throw new Error("There is no vault to export.");
    return loaded.blob;
  }

  /** Merge an exported blob into this vault. Returns the resulting account count. */
  async importBlob(blob: Uint8Array, passphrase: string): Promise<number> {
    const importedKey = await deriveKey(passphrase, await vaultSalt(blob));
    let imported: VaultDocument;
    try {
      imported = await openWithKey(blob, importedKey);
    } catch {
      throw new Error("Wrong passphrase for that file");
    }

    // Merge through the core rather than by hand, so import obeys exactly the
    // same newest-wins/tombstone rules as concurrent sync writes.
    const { doc, loaded, key } = await this.read();
    const merged = await merge(doc, imported);
    await this.commit(merged, loaded, key);
    return merged.entries.length;
  }
```

- [ ] **Step 4: Add the file helpers**

Create `apps/twofau-extension/src/vault/transfer.ts`:

```ts
/** Trigger a download of the sealed blob from an extension page. */
export function downloadBlob(blob: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([blob], { type: "application/octet-stream" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @twofau/extension test 2>&1 | tail -12`
Expected: PASS — 4 transfer tests plus the earlier suites.

- [ ] **Step 6: Wire the options page**

In `apps/twofau-extension/src/options/options-view.tsx`, replace the `id="vault"` section with:

```tsx
      <VaultSection />
```

and append this component to the same file:

```tsx
function VaultSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function service() {
    const { ExtensionVaultService } = await import("../vault/extension-vault-service");
    return ExtensionVaultService.create();
  }

  async function run(work: () => Promise<string>) {
    setError(null);
    setStatus(null);
    try {
      setStatus(await work());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <span className="text-[13px] font-medium">Vault</span>

      <div className="flex flex-col gap-1.5">
        <Input
          type="password"
          placeholder="Current passphrase"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Input
          type="password"
          placeholder="New passphrase"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Button
          size="sm"
          disabled={current.length === 0 || next.length < 8}
          onClick={() =>
            void run(async () => {
              await (await service()).changePassphrase(current, next);
              setCurrent("");
              setNext("");
              return "Passphrase changed.";
            })
          }
        >
          Change passphrase
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void run(async () => {
              const { downloadBlob } = await import("../vault/transfer");
              downloadBlob(await (await service()).exportBlob(), "2fau-vault.dat");
              return "Exported. The file is encrypted with your passphrase.";
            })
          }
        >
          Export encrypted vault
        </Button>

        <Input
          type="password"
          placeholder="Passphrase of the file to import"
          value={importPassphrase}
          onChange={(e) => setImportPassphrase(e.target.value)}
        />
        <input
          type="file"
          accept=".dat,application/octet-stream"
          className="text-[12px]"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void run(async () => {
              const { readFileBytes } = await import("../vault/transfer");
              const count = await (await service()).importBlob(
                await readFileBytes(file),
                importPassphrase,
              );
              return `Imported. The vault now holds ${count} account${count === 1 ? "" : "s"}.`;
            });
          }}
        />
      </div>

      {status && <p className="text-[11px] text-muted-foreground">{status}</p>}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </section>
  );
}
```

- [ ] **Step 7: Typecheck, build, and manually verify**

Run: `pnpm --filter @twofau/extension typecheck && pnpm --filter @twofau/extension build 2>&1 | tail -6`
Expected: no errors.

Manually: reload the extension, open Options, export the vault, change the passphrase, confirm the popup now demands the new one, then import the exported file with the *old* passphrase and confirm the accounts survive.
**Manual check — report what happened.**

- [ ] **Step 8: Commit**

```bash
git add apps/twofau-extension/src/vault/transfer.ts apps/twofau-extension/src/vault/transfer.test.ts \
        apps/twofau-extension/src/vault/extension-vault-service.ts \
        apps/twofau-extension/src/options/options-view.tsx
git commit -m "feat(extension): change passphrase plus encrypted export/import"
```

---

### Task 11: QR capture from the current tab

**Spike first.** The spec flags this: `activeTab` is granted when the user invokes the action, but the platform guidance is explicit that a *side panel* button click does not carry the grant. If a popup button behaves the same way, this feature is dropped — it does **not** justify adding `host_permissions`.

**Files:**
- Modify: `packages/ui/src/lib/qr.ts` (add `decodeQrDataUrl`)
- Modify: `packages/ui/src/index.ts` (export it)
- Create: `apps/twofau-extension/src/vault/scan.ts`
- Modify: `apps/twofau-extension/src/vault/extension-vault-service.ts` (`SCAN_SUPPORTED`)
- Modify: `apps/twofau-extension/src/popup/main.tsx` (pass `onScan`)
- Test: `packages/ui/src/lib/qr.test.ts`

**Interfaces:**
- Consumes: `createVaultService` (Task 5).
- Produces: `decodeQrDataUrl(dataUrl: string): Promise<string | null>` from `@twofau/ui`; `scanCurrentTab(): Promise<string>` from `scan.ts` (returns the decoded `otpauth://` URI, throws with a user-facing message otherwise).

- [ ] **Step 1: Run the spike**

Add this temporary button to `apps/twofau-extension/src/popup/main.tsx` (inside the render, above `<TwoFAUApp .../>`) and rebuild:

```tsx
  // SPIKE — delete after recording the result.
  const spike = async () => {
    const url = await chrome.tabs.captureVisibleTab();
    console.log("captureVisibleTab ok, length:", url.length);
  };
```

Render `<button onClick={() => void spike()}>spike</button>`, run `pnpm --filter @twofau/extension build`, reload the extension, open a normal web page, open the popup, click the button, and read the popup's console.

Expected (pass): a length is logged.
Expected (fail): an error mentioning permissions or `activeTab`.

- [ ] **Step 2: Record the spike result and branch**

If the spike **failed**: remove the spike code, leave `SCAN_SUPPORTED = false`, add a line to `docs/ROADMAP.md` under "Known debt" reading `- Tab QR capture dropped in SP4: activeTab is not granted to popup button clicks (spiked 2026-07-22).`, commit as `docs: record that tab QR capture isn't reachable under activeTab`, and **skip to Task 12**.

If the spike **passed**: remove the spike code and continue.

- [ ] **Step 3: Write the failing decoder test**

Create `packages/ui/src/lib/qr.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { decodeQrDataUrl } from "./qr";

describe("decodeQrDataUrl", () => {
  it("returns null when the image holds no QR code", async () => {
    // jsdom has no real canvas; a blank bitmap is enough to prove the plumbing.
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 2, height: 2, close() {} })),
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob([new Uint8Array(4)]))));
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 }),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    expect(await decodeQrDataUrl("data:image/png;base64,AAAA")).toBeNull();
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm --filter @twofau/ui test qr 2>&1 | tail -8`
Expected: FAIL — `decodeQrDataUrl is not exported`.

- [ ] **Step 5: Implement the decoder**

Append to `packages/ui/src/lib/qr.ts`:

```ts
/** Decode a QR code from a data: URL (e.g. a captured tab screenshot). */
export async function decodeQrDataUrl(dataUrl: string): Promise<string | null> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(data, width, height)?.data ?? null;
}
```

In `packages/ui/src/index.ts`, append:

```ts
export { decodeQrImage, decodeQrDataUrl } from "@/lib/qr";
```

- [ ] **Step 6: Implement the scan action**

Create `apps/twofau-extension/src/vault/scan.ts`:

```ts
import { decodeQrDataUrl } from "@twofau/ui";

/**
 * Screenshot the active tab and decode a QR code from it. Relies on `activeTab`,
 * which the action click that opened the popup grants for this tab only — no
 * host permissions, no content script.
 */
export async function scanCurrentTab(): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab();
  const text = await decodeQrDataUrl(dataUrl);
  if (!text) throw new Error("No QR code found on this page.");
  if (!text.startsWith("otpauth://")) throw new Error("That QR code isn't a 2FA enrolment code.");
  return text;
}
```

- [ ] **Step 7: Turn the capability on and wire the popup**

In `apps/twofau-extension/src/vault/extension-vault-service.ts`:

```ts
/** Confirmed by the Task 11 spike: activeTab covers a popup button click. */
const SCAN_SUPPORTED = true;
```

In `apps/twofau-extension/src/popup/main.tsx`, replace the final render with:

```tsx
  root.render(
    <TwoFAUApp
      service={service}
      onScan={() => {
        void (async () => {
          const { scanCurrentTab } = await import("../vault/scan");
          try {
            await service.addUri(await scanCurrentTab());
            // Reopening is the simplest reliable refresh: the provider reloads
            // its account list on mount.
            window.location.reload();
          } catch (err) {
            console.error(err);
          }
        })();
      }}
    />,
  );
```

- [ ] **Step 8: Run the tests and build**

Run: `pnpm --filter @twofau/ui test && pnpm --filter @twofau/extension test && pnpm --filter @twofau/extension build 2>&1 | tail -8`
Expected: all PASS.

- [ ] **Step 9: Manual check**

Reload the extension, open a page showing a 2FA enrolment QR code, open the popup, click the scan button.
Expected: the account is added.
**Manual check — report what happened.**

- [ ] **Step 10: Commit**

```bash
git add packages/ui/src/lib/qr.ts packages/ui/src/lib/qr.test.ts packages/ui/src/index.ts \
        apps/twofau-extension/src/vault/scan.ts \
        apps/twofau-extension/src/vault/extension-vault-service.ts \
        apps/twofau-extension/src/popup/main.tsx
git commit -m "feat(extension): enrol by scanning a QR code on the current tab"
```

---

### Task 12: CI, docs, and the manual verification checklist

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `apps/twofau-extension/MANUAL-CHECKS.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing consumed by later tasks (SP4 ends here).

- [ ] **Step 1: Add the extension to CI**

In `.github/workflows/ci.yml`, append a job:

```yaml
  extension:
    name: Chrome extension (build + tests)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4
      - uses: dtolnay/rust-toolchain@4be7066ada62dd38de10e7b70166bc74ed198c30 # stable
        with:
          targets: wasm32-unknown-unknown
      - uses: Swatinem/rust-cache@e18b497796c12c097a38f9edb9d0641fb99eee32 # v2
      - uses: jetli/wasm-pack-action@0d096b08b4e5a7de8c28de67e11e945404e9eefa # v0.4.0
      - uses: pnpm/action-setup@b906affcce14559ad1aafd4ab0e942779e9f58b1 # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 20
          cache: pnpm
      - run: cargo test -p twofau-core # emit ts-rs bindings
      - run: pnpm install --frozen-lockfile=false
      - run: pnpm build:core-wasm
      - run: pnpm --filter @twofau/extension test
      - run: pnpm --filter @twofau/extension build
```

- [ ] **Step 2: Write the manual checklist**

Create `apps/twofau-extension/MANUAL-CHECKS.md`:

```markdown
# Manual checks

Automated tests cover the vault, storage, and menu construction. These behaviours
involve real Chrome surfaces and cannot be verified headlessly — run them before
calling a change done, and report the actual outcome.

Load: `pnpm --filter @twofau/extension build`, then `chrome://extensions` →
Developer mode → Load unpacked → `apps/twofau-extension/dist`.

- [ ] First run shows "Create a passphrase"; a vault is created.
- [ ] Adding an `otpauth://` URI by paste produces a code that rotates.
- [ ] Reopening the popup keeps the vault unlocked.
- [ ] `chrome.storage.sync.get(console.log)` in the service-worker console shows
      only `vault.manifest` and `v*.chunk.*` — nothing readable.
- [ ] Right-click on a normal page → 2FAU → an account copies its code; the
      badge flashes green.
- [ ] The same works on a `chrome://extensions` tab (offscreen clipboard path).
- [ ] While locked, the submenu holds one disabled "Locked" item.
- [ ] `Ctrl+Shift+U` / `Cmd+Shift+U` opens the popup.
- [ ] Auto-lock: set it to 1 minute in Options, wait, confirm the popup asks for
      the passphrase again.
- [ ] Options: export the vault, change the passphrase, confirm the old one is
      rejected, re-import the exported file with the old passphrase, accounts survive.
- [ ] Two browsers signed into the same Chrome profile: add an account in each
      while both are unlocked, confirm both accounts survive (revision guard).
- [ ] QR capture from a live enrolment page (only if Task 11's spike passed).
```

- [ ] **Step 3: Update the docs**

In `docs/ROADMAP.md`, change the SP4 row's status from `**in progress**` to `**done**`, and change the SP5 row's status to `**next**`.

In `docs/DEVELOPMENT.md`, add to the "Everyday commands" JS block:

```bash
pnpm --filter @twofau/extension test     # extension unit tests
pnpm --filter @twofau/extension build    # -> apps/twofau-extension/dist (load unpacked)
pnpm --filter @twofau/extension dev      # rebuild on change
```

and add to the Traps list:

```markdown
- **The extension's `dist/` entry names are fixed** (`popup.js`, `background.js`,
  `options.js`, `offscreen.js`) because `manifest.json` can't reference hashed
  files. Don't "fix" the Rollup output names.
- **`chrome.storage.sync` is 100 KB total / 8 KB per item.** The vault is chunked
  at 6144 chars; a large vault will hit the ceiling and raise `VaultQuotaError`.
```

In `README.md`, update the Status paragraph:

```markdown
Sub-projects 0–4 are done: shared core, encrypted vault, shared React UI, a
menu-bar/tray desktop app, and a Manifest V3 Chrome extension with the same
encrypted vault synced through `chrome.storage.sync`. Next up is the desktop
localhost bridge and device sync (SP5) — see [`docs/ROADMAP.md`](docs/ROADMAP.md).
```

and add to the Layout block:

```
apps/twofau-extension   Chrome extension (MV3): popup, options, service worker
```

- [ ] **Step 4: Run the whole verification chain**

Run:

```bash
cd /Users/jilizart/Projects/2fau-tauri && \
  cargo fmt --all --check && \
  cargo clippy -p twofau-core -p twofau-wasm --all-targets -- -D warnings && \
  cargo test -p twofau-core && \
  pnpm build:core-wasm && \
  pnpm -r test && \
  pnpm --filter @twofau/extension build
```

Expected: every step succeeds; no clippy warnings; all Vitest suites pass.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml apps/twofau-extension/MANUAL-CHECKS.md \
        docs/ROADMAP.md docs/DEVELOPMENT.md README.md
git commit -m "ci: build and test the Chrome extension; document SP4"
```

---

## Coverage against the spec

| Spec requirement | Task |
| --- | --- |
| Same sealed-blob format as `vault.dat` | 1, 5 (format-compat test in 1) |
| Single blob, LWW + revision guard, merge on conflict | 3 (guard), 5 (merge retry) |
| Derived key in `chrome.storage.session`, not the passphrase | 1 (key API), 4 |
| Decrypted accounts never persisted | 5 (decrypt per call) |
| Minimal permissions, no content script | 2 (manifest guard test) |
| Vite multi-entry, no `@crxjs`, wasm via `chrome.runtime.getURL` | 2 |
| CSP with `wasm-unsafe-eval` | 2 (asserted in the guard test) |
| Chunked sync layout, manifest commit point, torn-read fallback, quota | 3 |
| Auto-lock via `chrome.alarms` | 4, 8 (alarm handler) |
| Popup over `TwoFAUApp` | 2, 6 |
| Context menu, five recent accounts, names not codes, offscreen clipboard | 7, 8 |
| Options page: auto-lock, sync toggle, quota meter | 9 |
| Options page: change passphrase, export/import | 10 |
| Keyboard shortcut | 8 |
| QR capture from the current tab (spike-gated) | 11 |
| `createVaultService()` seam for SP5 | 5 |
| Error-handling table behaviours | 3 (torn, quota), 5 (wrong passphrase, locked), 6 (WASM init) |
| Manual checklist | 12 |
