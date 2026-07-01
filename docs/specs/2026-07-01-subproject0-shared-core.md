# 2FAU Tauri Rewrite — Sub-project 0: Monorepo scaffold + shared Rust core (design)

**Date:** 2026-07-01
**Status:** Draft (awaiting user review)
**Part of:** 2FAU cross-platform Tauri 2 rewrite (multi-sub-project effort; this spec covers Sub-project 0 only)

## Context: the whole effort

2FAU is being rewritten from a native Swift macOS menu-bar app into a **cross-platform Tauri 2**
application in a **fresh repository**. Targets: **macOS, Windows, Linux** desktop (system-tray
agents), plus a **full-parity Chrome extension (MV3)** that reuses the same React frontend.

Critical logic (OTP generation, crypto, storage, merge) is written **once in Rust** and shared two
ways: compiled **native** for the Tauri app and to **WASM** for the browser extension. The React UI
(shadcn + lucide, macOS look-and-feel) talks to a swappable **`VaultService`** port so the same
components run over Tauri IPC, direct WASM calls, or an HTTP backend.

### Companion / sync model (later sub-projects)

- Chrome extension defaults to its own built-in encrypted storage (`chrome.storage`).
- The desktop app can optionally host an **authenticated localhost server on a configurable port**,
  exposing its vault as a backend.
- When enabled, the extension can switch its backend from `chrome.storage` to that localhost server.
- **Bidirectional sync/merge** between extension ↔ desktop, using per-account `modified_at` +
  tombstones + a pure `merge` (the merge model carried over from the Swift iCloud Phase 2 plan).

### Full decomposition (each gets its own spec → plan → implementation)

| # | Sub-project | Delivers |
|---|-------------|----------|
| **0** | **Monorepo scaffold + shared Rust core** (THIS SPEC) | Cargo + pnpm workspaces; `twofau-core` pure crate (HOTP/TOTP, Base32, otpauth, model, merge); native + `wasm32` dual build; JS interop smoke test. **No encryption.** |
| 1 | Crypto + storage abstraction | Passphrase-derived key (Argon2/PBKDF2 + AES-GCM) usable in WASM & native; `VaultStore` trait; versioned blob format + migration; desktop OS-keyring caching. |
| 2 | Shared React UI | macOS-styled component kit; `VaultService` port + mock; list, add/edit, code+countdown, copy, QR import. |
| 3 | Tauri desktop app | Tray/menu-bar agent + popup; UI→core via Tauri commands; local encrypted vault + keyring. |
| 4 | Chrome extension | MV3, reuses UI + WASM core, `chrome.storage` backend, QR scan. |
| 5 | Desktop localhost server + sync | Authenticated loopback HTTP server on configurable port; extension backend switch; bidirectional sync/merge. |

The existing Swift codebase (in the separate current repo) is the **behavioral reference** — RFC test
vectors, the encrypted-vault model, and the merge plan are ported from it.

## Why Sub-project 0 exists / why it is first

Everything else depends on the shared core. It is pure logic, so it is fast to TDD against the Swift
RFC vectors, and it forces the **native + WASM dual build and the JS boundary to work early** — the
riskiest assumption in the whole rewrite. Proving it here de-risks sub-projects 2–5.

## Chosen approach (B): pure core + thin WASM wrapper

- `crates/twofau-core` — zero platform deps, pure logic + `serde` types. Compiles anywhere.
- `crates/twofau-wasm` — `wasm-bindgen` wrapper only, built by `wasm-pack` into `packages/core-wasm`.
- The Tauri app (sub-project 3) will depend on `twofau-core` **directly** — no WASM in the native path.

Rejected: (A) single crate with cfg-gated wasm (wasm-bindgen + `#[cfg]` clutter leaks into pure
logic); (C) native core + a JS reimplementation for the extension (duplicate crypto = drift + security
risk).

### Cross-cutting design rules

- **Time-pure:** OTP functions take `unix_time: u64`; the core never reads the system clock.
- **RNG-free:** the core never generates UUIDs or timestamps. The host supplies `id` and
  `modified_at`. `getrandom`/`uuid v4` live only in `twofau-wasm`.
- **Secret-free `Account`:** the UI model never carries a secret; secrets live only inside
  `StoredAccount`, inside the encrypted vault (encryption arrives in sub-project 1).

## Scope

**In scope**
- Fresh-repo monorepo scaffold: Cargo workspace, pnpm workspace, toolchain pin, gitignore, README,
  rustfmt/clippy config.
- `twofau-core` crate: OTP (HOTP/TOTP), Base32, otpauth parser, model types, pure `merge`, errors.
- `twofau-wasm` crate + `packages/core-wasm` build output with a thin typed TS index.
- `ts-rs` generation of shared model types into `packages/core-wasm`.
- Rust unit tests (ported RFC vectors + merge cases) and a Vitest WASM interop smoke test.
- CI with a Rust job and a WASM+Vitest job.

**Out of scope (later sub-projects)**
- Any encryption, key derivation, keyring, or on-disk persistence (sub-project 1).
- Any React UI, Tauri app, extension, tray, or localhost server (sub-projects 2–5).
- `apps/*` — reserved in the workspace layout but not created here.

## Components / artifacts

### Workspace layout

```
2fau/                            ← fresh repo
├─ Cargo.toml                    # [workspace] members = ["crates/*"]
├─ rust-toolchain.toml           # pin stable; targets = ["wasm32-unknown-unknown"]
├─ package.json                  # private root (pnpm)
├─ pnpm-workspace.yaml           # packages: ["packages/*"]
├─ rustfmt.toml
├─ .gitignore · README.md
├─ crates/
│  ├─ twofau-core/  src/{lib,otp,base32,otpauth,model,merge,error}.rs
│  └─ twofau-wasm/  src/lib.rs
└─ packages/
   └─ core-wasm/    # wasm-pack pkg/ (gitignored) + committed package.json, index.ts, vitest test
```

- Package manager **pnpm**; JS test runner **Vitest**.
- WASM build **`wasm-pack --target web`** (explicit `init()`; works in Vite, plain web, and MV3
  service-worker/offscreen contexts).
- `apps/` reserved, not created.

### `twofau-core` API (pure, RNG-free, time-pure)

```rust
enum OtpType { Totp, Hotp }
enum OtpAlgorithm { Sha1, Sha256, Sha512 }

struct Account { id: Uuid, issuer: String, label: String, otp_type: OtpType,
                 algorithm: OtpAlgorithm, digits: u8, period: u32, counter: u64 }

struct StoredAccount { account: Account, secret: Vec<u8>, modified_at: u64 } // unix ms
struct Tombstone     { id: Uuid, deleted_at: u64 }
struct VaultDocument { entries: Vec<StoredAccount>, tombstones: Vec<Tombstone> }

// otpauth parse yields fields WITHOUT an id (host assigns id → core stays RNG-free)
struct ParsedOtp { issuer: String, label: String, otp_type: OtpType, algorithm: OtpAlgorithm,
                   digits: u8, period: u32, counter: u64, secret: Vec<u8> }

fn hotp(secret: &[u8], counter: u64, digits: u8, algo: OtpAlgorithm) -> String
fn totp(secret: &[u8], unix_time: u64, period: u32, digits: u8, algo: OtpAlgorithm) -> String
fn base32_decode(s: &str) -> Result<Vec<u8>, OtpError>     // RFC 4648, padding/lowercase tolerant
fn parse_otpauth(uri: &str) -> Result<ParsedOtp, OtpError>
fn merge(local: &VaultDocument, remote: &VaultDocument) -> VaultDocument
```

- **Crypto stack:** RustCrypto `hmac` + `sha1`/`sha2` (pure Rust, wasm-clean — not `ring`).
- **otpauth parsing:** `url` + `percent-encoding`.
- **Base32:** implemented in-crate (small, ported from Swift, no dependency).
- `OtpError` enum: `InvalidBase32`, `InvalidUri`, `UnsupportedScheme`, `MissingSecret`,
  `UnsupportedAlgorithm`, `InvalidDigits`.

**`merge` semantics:** union by `id`. For each id compute the latest `modified_at` entry and the
latest `deleted_at` tombstone. **Newest wins; tombstone wins on a tie** (a delete beats a concurrent
edit). Re-add after delete works when the entry's `modified_at` exceeds the tombstone's `deleted_at`.
Deterministic and fully unit-testable.

### `twofau-wasm` boundary → `packages/core-wasm`

Thin wrapper; `twofau-core` never sees `wasm-bindgen`. Complex types cross via
**`serde-wasm-bindgen`**. **Secrets cross as base64 strings**, never `number[]`.

```rust
#[wasm_bindgen] pub fn totp(secret_b64: &str, unix_time: u64, period: u32, digits: u8, algo: &str) -> Result<String, JsError>
#[wasm_bindgen] pub fn hotp(secret_b64: &str, counter: u64, digits: u8, algo: &str) -> Result<String, JsError>
#[wasm_bindgen] pub fn base32_decode(s: &str) -> Result<String /*b64*/, JsError>
#[wasm_bindgen] pub fn parse_otpauth(uri: &str) -> Result<JsValue /*ParsedOtp*/, JsError>
#[wasm_bindgen] pub fn merge(local: JsValue, remote: JsValue) -> Result<JsValue /*VaultDocument*/, JsError>
#[wasm_bindgen] pub fn new_id() -> String              // uuid v4 — getrandom "js" lives here only
#[wasm_bindgen] pub fn now_ms() -> f64                 // host clock helper for modified_at
```

- **Only** `twofau-wasm` enables `getrandom/js` + `uuid/v4`.
- **Type sharing:** `ts-rs` emits `Account`, `StoredAccount`, `Tombstone`, `VaultDocument`,
  `ParsedOtp` as `.ts`. `wasm-bindgen` emits function `.d.ts`. A committed hand-thin `index.ts`
  re-exports init + functions with the ts-rs types layered over the loose `JsValue` returns, so
  consumers see `Promise<VaultDocument>` rather than `any`.
- **Build:** `wasm-pack build crates/twofau-wasm --target web --out-dir ../../packages/core-wasm/pkg`.
  `pkg/` gitignored; `package.json` + `index.ts` + the Vitest test committed.

## Testing / verification

**Rust unit tests in `twofau-core`** (ported from the Swift suite):
- HOTP — RFC 4226 Appendix D vectors (counter 0–9).
- TOTP — RFC 6238 Appendix B vectors across SHA1/256/512 at canonical times (59, 1111111109,
  1234567890, 2000000000, 20000000000).
- Base32 — RFC 4648 vectors + padding/lowercase tolerance.
- otpauth — totp/hotp URIs, custom digits/period/algorithm, URL-encoded issuer/label, error cases.
- merge — newest-wins, tombstone-wins-on-tie, re-add-after-delete, disjoint union, empty sides.

**Interop smoke test (Vitest, `packages/core-wasm`)** — imports the built WASM, asserts one TOTP RFC
vector and one `merge` round-trip through `serde-wasm-bindgen`. This gate proves the dual native+WASM
build and the JS boundary work end-to-end.

**CI (GitHub Actions), two jobs:**
1. `rust` — `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`.
2. `wasm` — add `wasm32-unknown-unknown`, install `wasm-pack`, build `twofau-wasm`, `pnpm i`,
   `pnpm vitest run`.

**Definition of done:** `cargo test` green; `wasm-pack build` green; Vitest interop green in CI; no
encryption present (deferred to sub-project 1).

## Risks / notes

- **wasm-pack target choice** (`web`) is deliberate for MV3 compatibility; if a later bundler setup
  prefers `bundler`, the wrapper API is unchanged — only the build flag and `index.ts` init differ.
- **`ts-rs` vs `wasm-bindgen` types** — wasm-bindgen types the functions; ts-rs types the model. The
  thin `index.ts` is the single place that marries them; keep it in sync when the model changes.
- **RNG/time out of core** is a hard rule, not a convenience — it is what makes the identical crate
  run in WASM and stay deterministic under test. Any later "just call `SystemTime` here" is a smell.
```