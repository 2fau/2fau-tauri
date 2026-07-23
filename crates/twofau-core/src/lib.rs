//! Pure OTP/model/merge logic shared by the Tauri app (native) and the Chrome
//! extension (WASM). This crate is deliberately free of I/O, the system clock,
//! and randomness: callers pass in `unix_time`, `id`, and `modified_at`. That is
//! what lets the identical crate run under `wasm32` and stay deterministic in
//! tests.

mod base32;
mod error;
mod merge;
mod model;
mod otp;
mod otpauth;
mod store;
mod vault;

pub use base32::base32_decode;
pub use error::OtpError;
pub use merge::merge;
pub use model::{
    Account, OtpAlgorithm, OtpType, ParsedOtp, StoredAccount, Tombstone, VaultDocument,
};
pub use otp::{hotp, totp};
pub use otpauth::parse_otpauth;
pub use store::{InMemoryVaultStore, StoreError, VaultStore};
pub use vault::{
    derive_key, open, open_with_passphrase, salt_of, seal, seal_with_passphrase, Kdf, Key,
    VaultError, NONCE_LEN, SALT_LEN,
};

#[cfg(not(target_arch = "wasm32"))]
pub use store::FileVaultStore;
