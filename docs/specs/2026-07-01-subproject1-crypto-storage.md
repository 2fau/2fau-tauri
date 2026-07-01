# Sub-project 1 — Crypto + storage abstraction (design)

**Date:** 2026-07-01
**Status:** Approved
**Part of:** 2FAU cross-platform Tauri 2 rewrite. Depends on sub-project 0 (shared core).

## Goal

Add the encryption layer and a storage abstraction so a `VaultDocument` can be sealed to an
opaque blob and recovered, identically on native (Tauri) and WASM (extension). No app, no
keyring, no sync yet.

## Decisions

- **KDF:** PBKDF2-HMAC-SHA256, 600,000 iterations, 32-byte output (AES-256). Params are pinned by
  a `kdf_id` byte in the blob so they can be revised later without breaking old blobs.
- **Cipher:** AES-256-GCM. The blob header is bound as AEAD associated data, so tampering with the
  version/salt/nonce fails decryption.
- **Root of trust is a passphrase** (not Secure Enclave): SE is Apple-only and the extension has no
  OS keyring, so a passphrase-derived key is the only cross-platform option. Sync backends see only
  ciphertext + a non-secret salt.
- **OS-keyring key caching moved to sub-project 3** (Tauri desktop): it is desktop-runtime-specific,
  can't compile to WASM, and needs the app context.
- **RNG stays in the host:** `seal` takes `salt`/`nonce` as inputs; the wasm wrapper (getrandom) and
  the native app generate them. `twofau-core` stays RNG-free, as in sub-project 0.

## Components

### Layer A — shared pure crypto (`twofau-core::vault`)

Self-describing blob layout (all fixed-size fields, big-endian where relevant):

```
magic "2FAU" (4) | version u8 (=1) | kdf_id u8 (=1) | salt (16) | nonce (12) | ciphertext(+GCM tag)
```

The first 34 bytes (through the nonce) are the header, used verbatim as AES-GCM associated data.

```rust
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;

pub struct Key([u8; 32]);            // zeroized on drop

pub enum VaultError { BadFormat, UnsupportedVersion(u8), UnknownKdf(u8), DecryptFailed, Serialization }

pub fn derive_key(passphrase: &str, salt: &[u8; SALT_LEN]) -> Key;                 // PBKDF2
pub fn seal(doc: &VaultDocument, key: &Key, salt: &[u8; SALT_LEN], nonce: &[u8; NONCE_LEN])
    -> Result<Vec<u8>, VaultError>;
pub fn open(blob: &[u8], key: &Key) -> Result<VaultDocument, VaultError>;

// convenience (still RNG-free): reads salt/kdf_id from the blob and derives the key
pub fn seal_with_passphrase(doc: &VaultDocument, passphrase: &str,
                            salt: &[u8; SALT_LEN], nonce: &[u8; NONCE_LEN]) -> Result<Vec<u8>, VaultError>;
pub fn open_with_passphrase(blob: &[u8], passphrase: &str) -> Result<VaultDocument, VaultError>;
```

`VaultDocument` is serialized to JSON before encryption (secrets already ride as base64 inside it).

### Layer B — native storage abstraction (`twofau-core::store`)

```rust
pub enum StoreError { Io(String) }
pub trait VaultStore {
    fn load(&self) -> Result<Option<Vec<u8>>, StoreError>;   // raw blob, None if absent
    fn save(&self, blob: &[u8]) -> Result<(), StoreError>;
}
pub struct InMemoryVaultStore { /* interior-mutable buffer */ }        // all platforms (tests)
#[cfg(not(target_arch = "wasm32"))]
pub struct FileVaultStore { /* path */ }                              // atomic write (temp + rename)
```

The Chrome extension does storage in JS (`chrome.storage`) via the WASM `seal_vault`/`open_vault`
functions; it does not implement this Rust trait.

### WASM wrapper additions (`twofau-wasm`)

```rust
#[wasm_bindgen] pub fn seal_vault(doc: JsValue, passphrase: &str) -> Result<Vec<u8>, JsError>;  // generates salt+nonce
#[wasm_bindgen] pub fn open_vault(blob: &[u8], passphrase: &str) -> Result<JsValue, JsError>;
```

RNG (salt/nonce) comes from `getrandom` (js), which already lives only in this crate.

### New dependencies (all pure Rust, wasm-clean)

`twofau-core`: `pbkdf2`, `aes-gcm`, `zeroize`. (`sha2`/`hmac` already present.)

## Testing / verification

**Rust (`twofau-core`):**
- `derive_key` is deterministic for the same passphrase+salt, differs across salts.
- `seal`→`open` round-trips a multi-entry `VaultDocument`.
- Wrong passphrase → `DecryptFailed`.
- Flipping any header byte (salt/nonce/version) → `DecryptFailed` (AAD binding).
- Flipping a ciphertext byte → `DecryptFailed`.
- Blob layout: magic/version/kdf_id bytes correct; a known plaintext secret does **not** appear in
  the blob.
- Truncated / wrong-magic blob → `BadFormat`; unknown version/kdf → typed errors.
- `InMemoryVaultStore` and `FileVaultStore` round-trip; load-when-absent → `None`.

**WASM interop (Vitest):** build a `VaultDocument` in JS, `seal_vault(doc, "pw")` → bytes,
`open_vault(bytes, "pw")` deep-equals the original; wrong passphrase throws.

**Gates:** `cargo test` + clippy + fmt green; `wasm-pack build` + Vitest green.

## Out of scope (later)

Keyring caching (sub-project 3), any UI, `chrome.storage` JS impl (sub-project 4), sync transport
(sub-project 5), blob compression, key rotation / re-encryption flows.
