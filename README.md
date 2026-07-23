# 2FAU — cross-platform TOTP/HOTP authenticator (Tauri 2 rewrite)

Cross-platform rewrite of the 2FAU authenticator. Critical logic (OTP generation, crypto,
storage, merge) is written **once in Rust** (`crates/twofau-core`) and shared two ways:

- **native** — linked directly by the Tauri desktop app (macOS / Windows / Linux).
- **WASM** — via `crates/twofau-wasm` → `packages/core-wasm`, consumed by a full-parity
  Chrome extension and any web context.

A shared React UI (shadcn + lucide, macOS look) talks to a swappable `VaultService` port, so
the same components run over Tauri IPC, direct WASM calls, or an HTTP backend.

## Status

Sub-projects 0–4 are done: shared core, encrypted vault, shared React UI, a
menu-bar/tray desktop app, and a Manifest V3 Chrome extension with the same
encrypted vault synced through `chrome.storage.sync`. Next up is the desktop
localhost bridge and device sync (SP5) — see [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Layout

```
crates/twofau-core     pure Rust: HOTP/TOTP, base32, otpauth, model, vault crypto, merge
crates/twofau-wasm     wasm-bindgen wrapper (RNG + clock helpers live only here)
packages/core-wasm     wasm-pack output + ts-rs bindings + typed TS index
packages/ui            shared React UI (@twofau/ui) + Storybook + Vitest
apps/twofau-app        Tauri 2 desktop app (tray agent + popup)
apps/twofau-extension  Chrome extension (MV3): popup, options, service worker
```

## Develop

```bash
pnpm install
cargo test -p twofau-core        # unit tests + emits packages/core-wasm/bindings (ts-rs)
pnpm build:core-wasm             # wasm-pack build --target web
pnpm tauri dev                   # run the desktop tray app
```

Full command list and the platform gotchas: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Docs

- [`CLAUDE.md`](CLAUDE.md) — orientation + hard invariants
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module map, data flow, vault format
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — commands, verification, traps
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — sub-projects and known debt
- [`docs/specs/`](docs/specs) — per-sub-project design specs

## Design invariants

- **Time-pure:** OTP functions take `unix_time`; the core never reads the clock.
- **RNG-free:** the core never generates UUIDs, salts or nonces; the host supplies them.
- **Secret-free `Account`:** secrets live only in `StoredAccount`, never in the UI model.
- **UI knows no backend:** every component goes through the `VaultService` port.

## License

MIT — see [`LICENSE`](LICENSE).
