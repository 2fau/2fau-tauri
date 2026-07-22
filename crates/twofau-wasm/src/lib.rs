//! Thin `wasm-bindgen` wrapper over `twofau-core`. This is the ONLY crate that
//! pulls in randomness (`uuid v4` / `getrandom` js) and the host clock
//! (`js_sys::Date`), keeping `twofau-core` pure.
//!
//! Complex values cross via `serde-wasm-bindgen`. Secrets cross as base64
//! strings, never as byte arrays.

use base64::{engine::general_purpose::STANDARD, Engine};
use twofau_core::{OtpAlgorithm, VaultDocument, NONCE_LEN, SALT_LEN};
use wasm_bindgen::prelude::*;

fn parse_algo(s: &str) -> Result<OtpAlgorithm, JsError> {
    match s.to_ascii_uppercase().as_str() {
        "SHA1" => Ok(OtpAlgorithm::Sha1),
        "SHA256" => Ok(OtpAlgorithm::Sha256),
        "SHA512" => Ok(OtpAlgorithm::Sha512),
        _ => Err(JsError::new("unsupported algorithm")),
    }
}

fn decode_secret(b64: &str) -> Result<Vec<u8>, JsError> {
    STANDARD
        .decode(b64)
        .map_err(|_| JsError::new("invalid base64 secret"))
}

fn decode_b64_array<const N: usize>(b64: &str, what: &str) -> Result<[u8; N], JsError> {
    let bytes = STANDARD
        .decode(b64)
        .map_err(|_| JsError::new(&format!("invalid base64 {what}")))?;
    bytes
        .try_into()
        .map_err(|_| JsError::new(&format!("{what} must be {N} bytes")))
}

#[wasm_bindgen]
pub fn totp(
    secret_b64: &str,
    unix_time: u64,
    period: u32,
    digits: u8,
    algorithm: &str,
) -> Result<String, JsError> {
    let secret = decode_secret(secret_b64)?;
    Ok(twofau_core::totp(
        &secret,
        unix_time,
        period,
        digits,
        parse_algo(algorithm)?,
    ))
}

#[wasm_bindgen]
pub fn hotp(
    secret_b64: &str,
    counter: u64,
    digits: u8,
    algorithm: &str,
) -> Result<String, JsError> {
    let secret = decode_secret(secret_b64)?;
    Ok(twofau_core::hotp(
        &secret,
        counter,
        digits,
        parse_algo(algorithm)?,
    ))
}

/// Decode a Base32 secret and return it as base64 (the wire form for secrets).
#[wasm_bindgen]
pub fn base32_decode(s: &str) -> Result<String, JsError> {
    let bytes = twofau_core::base32_decode(s).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(STANDARD.encode(bytes))
}

/// Parse an `otpauth://` URI. Returns a `ParsedOtp` object.
#[wasm_bindgen]
pub fn parse_otpauth(uri: &str) -> Result<JsValue, JsError> {
    let parsed = twofau_core::parse_otpauth(uri).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(serde_wasm_bindgen::to_value(&parsed)?)
}

/// Merge two `VaultDocument` objects. Returns the merged `VaultDocument`.
#[wasm_bindgen]
pub fn merge(local: JsValue, remote: JsValue) -> Result<JsValue, JsError> {
    let local: VaultDocument = serde_wasm_bindgen::from_value(local)?;
    let remote: VaultDocument = serde_wasm_bindgen::from_value(remote)?;
    Ok(serde_wasm_bindgen::to_value(&twofau_core::merge(
        &local, &remote,
    ))?)
}

/// Encrypt a `VaultDocument` under `passphrase`, returning the opaque blob.
/// The random salt + nonce are generated here (the extension stores the blob).
#[wasm_bindgen]
pub fn seal_vault(doc: JsValue, passphrase: &str) -> Result<Vec<u8>, JsError> {
    let doc: VaultDocument = serde_wasm_bindgen::from_value(doc)?;
    let mut salt = [0u8; SALT_LEN];
    let mut nonce = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut salt).map_err(|_| JsError::new("RNG failure"))?;
    getrandom::getrandom(&mut nonce).map_err(|_| JsError::new("RNG failure"))?;
    twofau_core::seal_with_passphrase(&doc, passphrase, &salt, &nonce)
        .map_err(|e| JsError::new(&e.to_string()))
}

/// Decrypt a blob under `passphrase`, returning the `VaultDocument`.
#[wasm_bindgen]
pub fn open_vault(blob: &[u8], passphrase: &str) -> Result<JsValue, JsError> {
    let doc = twofau_core::open_with_passphrase(blob, passphrase)
        .map_err(|e| JsError::new(&e.to_string()))?;
    Ok(serde_wasm_bindgen::to_value(&doc)?)
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

/// Generate a fresh account id (UUID v4). Randomness lives only here.
#[wasm_bindgen]
pub fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Current time in unix milliseconds, for `modified_at` / `deleted_at`.
#[wasm_bindgen]
pub fn now_ms() -> f64 {
    js_sys::Date::now()
}
