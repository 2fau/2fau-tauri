# Sub-project 4 — Chrome extension (design)

**Date:** 2026-07-22
**Status:** Approved
**Part of:** 2FAU cross-platform Tauri 2 rewrite. Depends on sub-projects 0–3.

## Goal

A Manifest V3 Chrome extension with full desktop parity, reusing `@twofau/ui` unchanged and the
Rust core via WASM. The vault lives in `chrome.storage.sync` (encrypted, so it rides Chrome profile
sync across browsers) with the derived key in `chrome.storage.session`.

The extension is **standalone** in this sub-project. Sub-project 5 adds the desktop app's localhost
bridge as a second backend behind a seam defined here; nothing in SP4 talks to the desktop app.

## Decisions

- **Same sealed-blob format as `vault.dat`.** The extension seals a `VaultDocument` with exactly the
  header the desktop writes, so SP5's bridge and encrypted export/import are byte-compatible.
- **Single blob, last-write-wins, with a revision guard.** No per-account records. Concurrent writes
  are resolved by re-reading the revision before committing and running `twofau_core::merge` only
  when it advanced — cheap in the common case, and an offline browser can't erase another's accounts.
- **Session holds the derived key, not the passphrase.** `chrome.storage.session` is memory-only and
  cleared on browser close, and survives service-worker restarts. Storing the key (not the
  passphrase) keeps a reused passphrase out of storage and avoids paying 600 000 PBKDF2 rounds on
  every popup open and every context-menu click.
- **Decrypted accounts are never persisted.** Not in `local`, not in `session`. Decrypt on demand;
  AES-GCM over a ~10 KB blob is sub-millisecond.
- **Minimal permissions.** No host permissions and no content script. Context-menu items copy the
  code to the clipboard and never touch page content.

## Package layout

```
apps/twofau-extension/
  manifest.json
  vite.config.ts
  src/popup/{index.html,main.tsx}
  src/options/{index.html,main.tsx}
  src/background/{index.ts,context-menu.ts,auto-lock.ts,clipboard.ts}
  src/offscreen/{clipboard.html,clipboard.ts}
  src/vault/{extension-vault-service.ts,vault-repo.ts,session-key.ts,recent.ts,backend.ts}
```

Build: plain Vite multi-entry (popup, options, service worker, offscreen) plus a static
`manifest.json` and icons. No `@crxjs`. The service worker builds as an ES module
(`"type": "module"` in the manifest background entry).

WASM is loaded with `ensureReady(chrome.runtime.getURL("twofau_wasm_bg.wasm"))` — the optional
`input` parameter on `ensureReady` already exists for exactly this. The manifest must relax CSP:

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

Permissions: `storage`, `contextMenus`, `offscreen`, `activeTab`, `alarms`. Plus
`commands._execute_action` for the keyboard shortcut (opens the popup natively — no code).

## Core / WASM additions

`twofau-core::vault` already separates key derivation from sealing. Expose the existing pieces
through `twofau-wasm`:

- `derive_key(passphrase, salt_b64, kdf_id) -> key_b64`
- `seal_with_key(doc, key_b64, salt_b64, nonce_b64) -> Uint8Array`
- `open_with_key(blob, key_b64) -> VaultDocument`

No new crypto, no format change, no ts-rs binding change. The existing `*_with_passphrase` wrappers
stay for the desktop app.

## Storage layer (`vault-repo.ts`)

Keys in `chrome.storage.sync`:

| Key | Contents |
| --- | --- |
| `vault.manifest` | `{ version, revision, chunks, salt, kdfId }` |
| `v{revision}.chunk.{n}` | base64 slice of the sealed blob, ≤ 6 KB |

`chrome.storage.sync` allows 8 KB per item and 100 KB total; 6 KB chunks leave headroom for the key
name and JSON overhead.

**Read.** Fetch the manifest, then its generation's chunks. If any chunk is missing (a torn remote
write), fall back to the last-known-good blob mirrored in `chrome.storage.local`. On success, update
that mirror.

**Write.** Write the new generation's chunks first, then the manifest (the commit point), then
delete the previous generation's chunks. A concurrent reader either sees the old manifest and the
intact old generation, or the new manifest and the intact new one — never a mix.

**Revision guard.** Re-read `vault.manifest` immediately before committing. If its revision is
higher than the one this write was derived from, decrypt the remote blob, `merge()` it with the
local document, and commit the merged result at `remote.revision + 1`. Otherwise commit at
`loaded.revision + 1`.

**Quota.** Reject a write that would exceed `QUOTA_BYTES` with a distinct error the UI can show,
leaving the existing vault intact. The options page surfaces usage as a percentage.

## Unlock / lock

- First run → `SetupView`; `needsSetup()` is true when no `vault.manifest` exists.
- Unlock derives the key from the passphrase and the manifest salt, writes it to
  `chrome.storage.session`, and decrypts.
- `chrome.alarms` drives auto-lock (default 15 minutes, configurable). Firing removes the session
  key. Any vault operation reschedules the alarm.
- Every context that needs the vault (popup, options, service worker) reads the key from
  `session` per operation — no state in service-worker globals.

## Surfaces

**Popup.** `TwoFAUApp` from `@twofau/ui`, unmodified, over `ExtensionVaultService`.
`capabilities()` returns `{ scanScreen: true, qrImage: true, paste: true }` — the first host to
light up `scanScreen`. If the `activeTab` spike below fails, `scanScreen` stays `false` and the UI
simply doesn't render the button, exactly as it does on desktop today.

**Scan QR from the current tab.** `chrome.tabs.captureVisibleTab()` → the existing jsQR helper in
`@twofau/ui` → `addUri()`. This relies on `activeTab` still being granted when the user clicks a
button inside the popup that the action click opened. **Spike this before building the rest of the
feature** — the platform guidance is explicit that a side-panel button click does *not* carry the
grant, and if a popup button behaves the same way this falls back to `tabs` + host permissions,
which contradicts the minimal-permissions decision. If the spike fails, drop the feature rather
than widen permissions, and record that in the plan.

**Context menu.** A parent "2FAU" item with up to five children, one per recently used account,
titled `issuer — label` (falling back to whichever exists). Titles never contain codes: codes rotate
every 30 s, so live titles would mean constant menu churn, and a code sitting in an OS menu is a
needless exposure. Clicking a child makes the service worker read the session key, decrypt, compute
the current code, and copy it through an offscreen document (`reason: CLIPBOARD`) — which works on
`chrome://` pages and PDFs and needs no host permission. When locked, the submenu holds a single
disabled "Locked — open 2FAU" item.

Recency is an array of account ids in `chrome.storage.local`, updated whenever a code is copied from
either the popup or the menu. The menu is rebuilt on: recency change, account add/remove/edit, and
lock-state change.

**Options page.** Auto-lock timeout, sync on/off, change passphrase, encrypted export/import of a
`vault.dat`-format blob, and the sync-quota meter. Same UI package, wider layout.

**Keyboard shortcut.** `commands: { "_execute_action": { suggested_key: "Ctrl+Shift+U" /
"Command+Shift+U" } }`.

## Backend seam (for SP5)

```ts
// src/vault/backend.ts
export async function createVaultService(): Promise<VaultService>;
```

Today it always returns `ExtensionVaultService`. SP5 adds a desktop probe and returns a
`BridgeVaultService` when one answers. Nothing else in the extension knows which backend it has —
the popup and options page only ever see `VaultService`.

## Error handling

| Case | Behaviour |
| --- | --- |
| Wrong passphrase | `VaultError` → "Wrong passphrase" in `UnlockView`; key not written to session |
| Torn remote write | Fall back to the `local` mirror; log; next successful read repairs it |
| Revision advanced | Merge, then commit — silent, this is the normal concurrent-edit path |
| Sync quota exceeded | Distinct error, write refused, existing vault untouched, surfaced in options |
| Locked when a menu item fires | Item is already disabled; the handler re-checks and no-ops |
| WASM fails to init | Popup shows a hard error instead of an empty list — never a silent empty vault |

## Testing

- **`vault-repo`** against an in-memory fake `chrome.storage`: chunk round-trip, torn-read fallback
  to the mirror, generation cleanup, revision-guard merge path, quota-exceeded rejection.
- **`ExtensionVaultService`** against the fake storage plus real WASM (node environment), covering
  setup → add → list → code → edit → remove → lock → unlock.
- **`session-key` / `auto-lock`**: alarm fires → key gone → `isLocked()` true.
- **Existing `@twofau/ui` tests** run unchanged; the extension adds no UI components.
- **Manual checklist** (cannot be verified headlessly, and must not be claimed as verified):
  context-menu copy on a normal page and on `chrome://` , QR capture from a live enrolment page,
  keyboard shortcut, auto-lock after the timeout, and two-browser concurrent edit exercising the
  revision guard.

## Out of scope

- Autofilling codes into page inputs (needs a content script on every site — its own sub-project).
- The desktop localhost bridge and pairing (SP5).
- Firefox/Safari ports.
- Chrome Web Store submission assets — tracked separately once the extension is functional.
