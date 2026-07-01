# 2FAU — cross-platform TOTP/HOTP authenticator (Tauri 2 rewrite)

Cross-platform rewrite of the 2FAU authenticator. Critical logic (OTP generation, crypto,
storage, merge) is written **once in Rust** (`crates/twofau-core`) and shared two ways:

- **native** — linked directly by the Tauri desktop app (macOS / Windows / Linux).
- **WASM** — via `crates/twofau-wasm` → `packages/core-wasm`, consumed by a full-parity
  Chrome extension and any web context.

A shared React UI (shadcn + lucide, macOS look) talks to a swappable `VaultService` port, so
the same components run over Tauri IPC, direct WASM calls, or an HTTP backend.

## Status — Sub-project 0: monorepo scaffold + shared core

This is the foundation. It ships the pure OTP/model/merge logic and proves the native + WASM
dual build and the JS boundary. **No encryption yet** (sub-project 1) and **no app yet**
(Tauri desktop is sub-project 3, the extension sub-project 4).

## Layout

```
crates/twofau-core   pure Rust: HOTP/TOTP, Base32, otpauth, model, merge (no I/O, no clock, no RNG)
crates/twofau-wasm   wasm-bindgen wrapper (RNG + clock helpers live only here)
packages/core-wasm   wasm-pack output + typed TS index + Vitest interop smoke test
```

## Develop

```bash
# Rust core
cargo test                       # unit tests + emits packages/core-wasm/bindings (ts-rs)
cargo clippy --all-targets -- -D warnings
cargo fmt --check

# WASM + JS interop
pnpm install
pnpm build:wasm                  # wasm-pack build --target web
pnpm --filter @twofau/core-wasm test
```

## Design invariants

- **Time-pure:** OTP functions take `unix_time`; the core never reads the clock.
- **RNG-free:** the core never generates UUIDs or timestamps; the host supplies them.
- **Secret-free `Account`:** secrets live only in `StoredAccount`, never in the UI model.
