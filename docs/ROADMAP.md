# Roadmap

The rewrite is split into six sub-projects, built in order. Each shipped one behind a spec
in `docs/specs/`.

| # | Sub-project | Status | Spec |
| --- | --- | --- | --- |
| SP0 | Monorepo scaffold + shared Rust core (OTP, base32, otpauth, model, merge) | **done** | `specs/2026-07-01-subproject0-shared-core.md` |
| SP1 | Crypto + storage (PBKDF2 → AES-GCM vault blob, `VaultStore`) | **done** | `specs/2026-07-01-subproject1-crypto-storage.md` |
| SP2 | Shared React UI (`@twofau/ui`, `VaultService` port, Storybook) | **done** | `specs/2026-07-02-subproject2-shared-ui.md` |
| SP3 | Tauri desktop app (tray, popup, keyring, setup/unlock) | **done** | `specs/2026-07-04-subproject3-tauri-desktop.md` |
| SP4 | Chrome extension (MV3), full parity, `chrome.storage` backend | **next** | — |
| SP5 | Desktop localhost sync server + bidirectional merge | planned | — |

## SP4 — Chrome extension (next)

Scope: reuse `@twofau/ui` unchanged; implement a third `VaultService` over
`chrome.storage.local` + the WASM core (`@twofau/core-wasm`). Feature parity with desktop:
list/add/edit/delete, TOTP + HOTP, otpauth:// paste, QR from an image, passphrase
setup/unlock. Capabilities differ — no screen scan — which the existing `Capabilities` flag
on `VaultService` already models.

Open questions to settle first:
- MV3 service-worker lifetime vs. holding a decrypted vault in memory (probably: unlock per
  popup session, key held in the popup, not the worker).
- Where the WASM binary is loaded from under MV3's CSP.
- Whether the extension writes the same blob format as desktop (it should — SP5 depends on it).

## SP5 — sync

Desktop hosts a localhost HTTP server on a configured port; the extension can be pointed at
it instead of `chrome.storage`. Bidirectional sync uses `twofau-core::merge` (newest-wins +
tombstones), the same algorithm the Swift app uses, so all three can interoperate.

## Known debt

- Desktop bundle carries an unused ~600 KB WASM blob (see `DEVELOPMENT.md § Traps`).
- Continuous release runs in parallel with CI rather than gating on it.
- No code signing for Windows/macOS installers.
- No end-to-end test that drives the actual tray popup.
