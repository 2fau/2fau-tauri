# 2FAU — cross-platform TOTP/HOTP authenticator (Tauri 2)

Menu-bar/tray authenticator for macOS + Windows + Linux, plus a planned full-parity Chrome
extension. Critical logic (OTP, crypto, storage, merge) lives **once in Rust** and is shared
natively (Tauri) and via WASM (browser). Local-first; optional device↔device sync later.

This is a **rewrite** of the Swift macOS app at `~/Projects/2fau` — that repo is the
behavioural reference (UI layout, invariants) and is never modified from here.

## Stack

- **Rust** workspace: `twofau-core` (pure logic), `twofau-wasm` (wasm-bindgen wrapper),
  `twofau-app/src-tauri` (Tauri 2 desktop shell).
- **pnpm** workspace: `@twofau/core-wasm` (wasm-pack output + typed TS index),
  `@twofau/ui` (shared React components), `@twofau/app` (Tauri frontend).
- React 19 · shadcn/ui (new-york) · lucide-react · Tailwind v4 · Vite · Vitest · Storybook 8.
- Rust stable (needs ≥1.85 for edition2024 deps) · `wasm32-unknown-unknown`.

## Docs

| File | What's in it |
| --- | --- |
| `docs/ARCHITECTURE.md` | Module map, data flow, crypto/vault format, hard invariants |
| `docs/DEVELOPMENT.md` | Every command, plus the traps that already cost hours |
| `docs/ROADMAP.md` | Sub-projects SP0–SP5, what's done, what's next |
| `docs/specs/*.md` | Per-sub-project design specs (written before each was built) |

Read `docs/ARCHITECTURE.md` before touching crypto, the vault format, or the
`VaultService` port. Read `docs/DEVELOPMENT.md` before running any build.

## Hard invariants

- **`twofau-core` is pure**: no clock, no RNG, no filesystem, no network. Callers pass
  `unix_time`, ids, salts and nonces in. RNG/uuid live only in `twofau-wasm` and the app.
- **Secrets never reach `Account`** (the UI model). They live only in `StoredAccount`,
  inside the encrypted vault blob. Across the JS boundary secrets are base64 strings.
- **Vault blob is self-describing**: `b"2FAU" | version | kdf_id | salt(16) | nonce(12) |
  ciphertext`, and the 6-byte header is bound as AES-GCM associated data. Never change the
  layout without bumping `version`/`kdf_id` and handling the old one.
- **The UI never imports Tauri APIs.** All I/O goes through the `VaultService` port
  (`packages/ui/src/core/vault-service.ts`) so the same components run over Tauri IPC,
  direct WASM, or an HTTP backend. Adding a UI feature that needs I/O means extending that
  interface and every implementation.
- **Desktop vault path is `app_data_dir()/vault.dat`** (bundle id `dev.artkost.2fau`) —
  never the Swift app's `~/Library/Application Support/2fau/`. The two blobs share a magic
  but diverge after byte 5; colliding paths produce "unknown KDF id 0".
- **Codes are computed in Rust, not JS**, in the desktop app — the frontend asks for a code
  by account id and never sees a secret.

## Working style

- Match the surrounding code: comments explain *why*, not *what*; no decorative headers.
- Every behaviour change gets a test (`cargo test` for core, Vitest for UI).
- Before claiming done, actually run: `cargo fmt --check && cargo clippy --all-targets -D
  warnings && cargo test && pnpm -r test`. See `docs/DEVELOPMENT.md § Verify`.
- Conventional commits (`feat:`, `fix:`, `ci:`, `chore:`), scope optional (`fix(app):`).
- Interactive tray/popup behaviour cannot be verified headlessly — say so instead of
  claiming a GUI fix is confirmed.
