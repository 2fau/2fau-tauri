# Architecture

## Layout

```
crates/
  twofau-core/          pure Rust — no I/O, no clock, no RNG
    otp.rs              RFC 4226/6238 HOTP + TOTP
    base32.rs           RFC 4648 base32 (no padding, lenient input)
    otpauth.rs          otpauth:// URI  ->  ParsedOtp
    model.rs            Account, StoredAccount, Tombstone, VaultDocument, ParsedOtp,
                        OtpType, OtpAlgorithm   (+ ts-rs exports to packages/core-wasm/bindings)
    vault.rs            PBKDF2 -> AES-256-GCM seal/open of the whole vault
    merge.rs            newest-wins merge with tombstones
    store.rs            VaultStore trait, InMemoryVaultStore, FileVaultStore (non-wasm)
    error.rs            OtpError / VaultError
  twofau-wasm/          wasm-bindgen wrapper; the ONLY crate with getrandom + uuid v4

packages/
  core-wasm/            wasm-pack output (pkg/), ts-rs bindings/, typed index.ts, smoke test
  ui/                   shared React UI (see below)

apps/
  twofau-app/           Tauri 2 desktop app
    src/                thin frontend: bootstrap, TauriVaultService, styles
    src-tauri/          Rust shell: tray, popup window, commands, AppVault
```

## Data flow

```
React component
  └─ useVault()                     packages/ui/src/state/vault-provider.tsx
       └─ VaultService (port)       packages/ui/src/core/vault-service.ts
            ├─ MockVaultService     in-memory, for Storybook + tests
            ├─ TauriVaultService    apps/twofau-app/src/tauri-vault-service.ts  -> invoke()
            └─ (planned) extension  chrome.storage + WASM, and an HTTP client for sync
```

`VaultProvider` owns the account list and re-derives codes once per second from a shared
`useNow()` tick, so N rows cause one timer, not N.

On the desktop side, `invoke()` lands in `src-tauri/src/lib.rs` commands, which delegate to
`AppVault` (`src-tauri/src/vault.rs`). `AppVault` holds the decrypted `VaultDocument` in
memory behind a lock, computes codes with `twofau-core`, and re-seals the whole blob to disk
on every mutation.

## Vault format & crypto

```
b"2FAU" | version:u8 | kdf_id:u8 | salt[16] | nonce[12] | AES-256-GCM ciphertext
^-------------------- 6-byte header, bound as AEAD associated data --------------^
```

- KDF: PBKDF2-HMAC-SHA256, 600 000 iterations, `kdf_id = 1`. The id is versioned so a
  future Argon2id can be added without breaking existing vaults.
- Cipher: AES-256-GCM. Key material is `Zeroize`d on drop.
- The plaintext is a JSON `VaultDocument` (accounts + tombstones + revision metadata).
- `salt` and `nonce` are supplied by the caller — the core never generates them.

Rationale for PBKDF2 over Argon2: available everywhere including WASM without threads, and
identical behaviour across the three desktop OSes and the browser.

## Passphrase & unlock

The Swift app used a Secure Enclave key and unlocked silently. Cross-platform has no such
primitive, so the vault is passphrase-derived:

- **First run** → `SetupView` (create passphrase, confirm, optional "remember").
- **Later runs** → `try_auto_unlock()` reads the passphrase from the OS keyring
  (`keyring` crate, service `dev.artkost.2fau`, user `vault-passphrase`); on miss →
  `UnlockView`.

## Merge (for sync, SP5)

`merge.rs` is newest-wins per account id, with tombstones beating a same-timestamp edit so a
delete is never resurrected by a stale device. Tombstones are pruned past a retention
window. This mirrors the Swift `VaultMerge` semantics exactly, so the two implementations
can interoperate.

## Desktop shell specifics

- macOS: `ActivationPolicy::Accessory` (no Dock icon), `macOSPrivateApi` for transparency.
- The popup is a borderless, transparent, always-on-top, non-resizable `main` window that
  starts hidden and hides on blur.
- Positioning: `move_window_constrained(Position::TrayCenter)` — `TrayCenter` has the
  per-OS flip (below a top macOS menu bar, above a bottom Windows/Linux taskbar) and the
  `_constrained` variant clamps to the monitor. Do not switch to `TrayBottomCenter`: it
  anchors unconditionally and pushes the popup off-screen on bottom-taskbar systems.
- Height is driven from the frontend via a `ResizeObserver` that resizes the window to the
  content.

## Type generation

`cargo test -p twofau-core` runs the ts-rs export tests, writing
`packages/core-wasm/bindings/*.ts`. The UI's `core/types.ts` re-exports those, so **Rust is
the single source of truth for shared types** — never hand-edit `bindings/`.

The `export_to` paths are relative to the *crate* (`../../../packages/core-wasm/bindings/`);
getting them wrong once created a bogus `crates/packages/` tree that broke the Cargo
workspace glob. That's why workspace members are listed explicitly.
