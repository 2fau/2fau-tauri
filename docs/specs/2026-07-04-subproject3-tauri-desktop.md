# Sub-project 3 — Tauri desktop app (design)

**Date:** 2026-07-04
**Status:** Approved
**Part of:** 2FAU cross-platform Tauri 2 rewrite. Depends on sub-projects 0–2.

## Goal

Turn the pre-scaffolded `apps/twofau-app` (stock create-tauri-app, React 19 / Vite / Tauri 2,
identifier `dev.artkost.2fau`) into the 2FAU menu-bar agent: a tray-toggled popup that mounts the
shared `@twofau/ui` and is backed by a Rust-owned encrypted vault.

## Decisions

- **Rust owns secrets.** The vault decrypts and computes TOTP/HOTP in the Rust process. The webview
  receives only account metadata and the current code string — never secrets. Preserves the Swift
  "UI is secret-free" invariant. `code()` is a Tauri command.
- **Keyring caches the passphrase.** The OS keyring (macOS Keychain / Windows Credential Manager /
  libsecret) stores the passphrase so it's entered once per device; silent unlock re-derives on
  launch. No `twofau-core` change.
- **Menu-bar agent:** tray icon toggles a frameless, transparent, always-on-top popup anchored at the
  tray; hidden on blur; no Dock/taskbar icon (`ActivationPolicy::Accessory` on macOS, `skipTaskbar`
  elsewhere).

## Rust (`src-tauri`)

New deps: `twofau-core` (path), `keyring = "3"`, `uuid` (v4), `getrandom`, `tauri-plugin-positioner`,
and the `tray-icon` feature on `tauri`.

- **`vault.rs` — `AppVault`** (Tauri managed state): `FileVaultStore` +
  `Mutex<Option<Unlocked>>` where `Unlocked { passphrase, doc: VaultDocument }`.
  - `unlock(pass, remember)`: load blob → `open_with_passphrase` (or start empty + seal a new one);
    keep `doc` + `passphrase` in memory; if `remember`, write the passphrase to the keyring.
  - `try_auto_unlock()`: read passphrase from keyring; unlock if present. Returns whether it unlocked.
  - Every mutation re-seals with `seal_with_passphrase` (fresh random salt+nonce from `getrandom`)
    and `store.save`.
  - `code(id, unix_ms)`: look up the stored account + secret, compute via `twofau_core::{totp,hotp}`.
- **Commands:** `try_auto_unlock`, `unlock`, `is_locked`, `list_accounts`, `code`, `add_uri`,
  `add_manual`, `update_account`, `remove_account`, `advance_hotp`, `quit`. Accounts cross the
  boundary as `twofau_core::Account` (serde) — same shape as the `@twofau/ui` `Account` type.
- **`lib.rs`:** register the vault state + commands; on `setup` set the activation policy, build the
  tray icon (toggle popup on click via `tauri-plugin-positioner`, `TrayBottomCenter`), and hide the
  window when it loses focus.

## Frontend (`src/`)

- **`TauriVaultService`** implements the `@twofau/ui` `VaultService` by `invoke`-ing the commands.
  `capabilities()` = `{ scanScreen: false, qrImage: true, paste: true }` (screen-scan deferred).
- **`main.tsx`:** bootstrap `invoke("try_auto_unlock")`, build the service with the resulting locked
  state, mount `TwoFAUApp`, wire `onQuit → invoke("quit")`. Auto-resize the OS window to content
  height via a `ResizeObserver` (mirrors the Swift `resizePanelToFit`).
- **Styling:** Tailwind v4 (`@tailwindcss/vite`) importing the `@twofau/ui` globals with
  `@source "../../../packages/ui/src"` so the shared components' classes are generated. Transparent
  window + a rounded, shadowed panel; the app maps the `@` alias to `packages/ui/src` so the shared
  package resolves as source.

## Shared-UI adjustments

- Widen `@twofau/ui` React peer to `^18.3.1 || ^19`.
- `MenuBarView` paste now goes through `useVault().addUri` + `navigator.clipboard` (gated by
  `capabilities.paste`) instead of an external `onPaste` prop, so header paste refreshes the list on
  every host. `onScan` stays an optional host prop (gated by `capabilities.scanScreen`).

## tauri.conf.json

`productName "2FAU"`; single window `main`: 320 wide, `visible:false`, `decorations:false`,
`transparent:true`, `alwaysOnTop:true`, `skipTaskbar:true`, `resizable:false`, `shadow:true`;
`macOSPrivateApi:true`. Tray configured in Rust.

## Testing / verification

- `cargo check -p twofau-app` (Rust compiles: vault + commands + tray/window setup).
- `pnpm -F @twofau/app build` (tsc + vite build of the webview).
- Interactive (user runs `pnpm tauri dev`): tray toggles the popup; first launch prompts for a
  passphrase, later launches unlock silently; add/copy/delete persist across relaunch; no Dock icon.

## Out of scope (later)

Screen-QR scan, camera scan, real vibrancy polish, notarized/signed CI builds, auto-update, the
localhost sync server (SP5).
