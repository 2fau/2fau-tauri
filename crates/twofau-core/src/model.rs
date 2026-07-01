use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

/// TOTP (time-based) or HOTP (counter-based).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/core-wasm/bindings/")]
pub enum OtpType {
    Totp,
    Hotp,
}

/// HMAC hash backing the OTP.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/core-wasm/bindings/")]
pub enum OtpAlgorithm {
    Sha1,
    Sha256,
    Sha512,
}

/// UI-facing account metadata. Deliberately **secret-free** — the shared secret
/// lives only inside [`StoredAccount`], inside the (later) encrypted vault.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/core-wasm/bindings/")]
pub struct Account {
    #[ts(type = "string")]
    pub id: Uuid,
    pub issuer: String,
    pub label: String,
    pub otp_type: OtpType,
    pub algorithm: OtpAlgorithm,
    pub digits: u8,
    pub period: u32,
    #[ts(type = "number")]
    pub counter: u64,
}

/// On-disk / sync record: account metadata bundled with its secret and a
/// per-account modification timestamp (unix milliseconds) used by [`merge`].
///
/// The secret crosses the serde/JS boundary as a **base64 string**, never as an
/// array of bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/core-wasm/bindings/")]
pub struct StoredAccount {
    pub account: Account,
    #[serde(with = "secret_b64")]
    #[ts(type = "string")]
    pub secret: Vec<u8>,
    #[ts(type = "number")]
    pub modified_at: u64,
}

/// Record of a deleted account, retained so a delete can win a merge and
/// propagate to other devices. `deleted_at` is unix milliseconds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/core-wasm/bindings/")]
pub struct Tombstone {
    #[ts(type = "string")]
    pub id: Uuid,
    #[ts(type = "number")]
    pub deleted_at: u64,
}

/// The full syncable vault contents.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/core-wasm/bindings/")]
pub struct VaultDocument {
    pub entries: Vec<StoredAccount>,
    pub tombstones: Vec<Tombstone>,
}

/// Fields parsed from an `otpauth://` URI. Carries **no `id`** — the host assigns
/// one (via `new_id`), keeping this crate free of randomness.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/core-wasm/bindings/")]
pub struct ParsedOtp {
    pub issuer: String,
    pub label: String,
    pub otp_type: OtpType,
    pub algorithm: OtpAlgorithm,
    pub digits: u8,
    pub period: u32,
    #[ts(type = "number")]
    pub counter: u64,
    #[serde(with = "secret_b64")]
    #[ts(type = "string")]
    pub secret: Vec<u8>,
}

/// Serialize `Vec<u8>` secrets as base64 strings on the wire.
mod secret_b64 {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(bytes: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        STANDARD
            .decode(s.as_bytes())
            .map_err(serde::de::Error::custom)
    }
}
