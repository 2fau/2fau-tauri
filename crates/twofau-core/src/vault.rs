//! Passphrase-based encryption of a [`VaultDocument`] into a self-describing,
//! versioned blob. Pure and RNG-free: callers supply `salt` and `nonce` (the
//! host owns randomness, as in the rest of this crate).
//!
//! Blob layout:
//! ```text
//! magic "2FAU" (4) | version u8 | kdf_id u8 | salt (16) | nonce (12) | ciphertext(+GCM tag)
//! ```
//! The 34-byte header (through the nonce) is bound as AES-GCM associated data,
//! so tampering with the version/kdf/salt/nonce fails authentication.

use crate::model::VaultDocument;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use sha2::Sha256;
use zeroize::ZeroizeOnDrop;

pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;

const MAGIC: &[u8; 4] = b"2FAU";
const VERSION: u8 = 1;
const HEADER_LEN: usize = 4 + 1 + 1 + SALT_LEN + NONCE_LEN; // 34

/// Supported key-derivation schemes. The `u8` is what the blob records.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kdf {
    /// PBKDF2-HMAC-SHA256, 600,000 iterations, 32-byte output.
    Pbkdf2HmacSha256 = 1,
}

impl Kdf {
    fn from_id(id: u8) -> Option<Kdf> {
        match id {
            1 => Some(Kdf::Pbkdf2HmacSha256),
            _ => None,
        }
    }
}

const PBKDF2_ITERATIONS: u32 = 600_000;

/// A 32-byte symmetric key, wiped from memory on drop.
#[derive(Clone, ZeroizeOnDrop)]
pub struct Key([u8; 32]);

impl Key {
    pub fn from_bytes(bytes: [u8; 32]) -> Key {
        Key(bytes)
    }

    /// The raw key material. Hosts that cache a derived key instead of the
    /// passphrase (the Chrome extension's session storage) need this — treat
    /// the result as secret.
    pub fn to_bytes(&self) -> [u8; 32] {
        self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VaultError {
    BadFormat,
    UnsupportedVersion(u8),
    UnknownKdf(u8),
    DecryptFailed,
    Serialization,
}

impl std::fmt::Display for VaultError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VaultError::BadFormat => write!(f, "vault blob is malformed"),
            VaultError::UnsupportedVersion(v) => write!(f, "unsupported vault version {v}"),
            VaultError::UnknownKdf(k) => write!(f, "unknown KDF id {k}"),
            VaultError::DecryptFailed => {
                write!(f, "decryption failed (wrong passphrase or tampered)")
            }
            VaultError::Serialization => write!(f, "vault (de)serialization failed"),
        }
    }
}

impl std::error::Error for VaultError {}

/// Derive a 32-byte key from a passphrase and salt (PBKDF2-HMAC-SHA256).
pub fn derive_key(passphrase: &str, salt: &[u8; SALT_LEN]) -> Key {
    let bytes =
        pbkdf2::pbkdf2_hmac_array::<Sha256, 32>(passphrase.as_bytes(), salt, PBKDF2_ITERATIONS);
    Key(bytes)
}

/// Encrypt `doc` with `key`, embedding `salt`/`nonce` in the header.
pub fn seal(
    doc: &VaultDocument,
    key: &Key,
    salt: &[u8; SALT_LEN],
    nonce: &[u8; NONCE_LEN],
) -> Result<Vec<u8>, VaultError> {
    let plaintext = serde_json::to_vec(doc).map_err(|_| VaultError::Serialization)?;
    let header = header_bytes(Kdf::Pbkdf2HmacSha256, salt, nonce);

    let cipher = Aes256Gcm::new(key.0.as_slice().into());
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: &plaintext,
                aad: &header,
            },
        )
        .map_err(|_| VaultError::DecryptFailed)?;

    let mut out = header;
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a blob with `key`.
pub fn open(blob: &[u8], key: &Key) -> Result<VaultDocument, VaultError> {
    let parsed = parse(blob)?;
    let cipher = Aes256Gcm::new(key.0.as_slice().into());
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(parsed.nonce),
            Payload {
                msg: parsed.ciphertext,
                aad: parsed.header,
            },
        )
        .map_err(|_| VaultError::DecryptFailed)?;
    serde_json::from_slice(&plaintext).map_err(|_| VaultError::Serialization)
}

/// Derive the key from `passphrase` + supplied `salt`/`nonce`, then seal.
pub fn seal_with_passphrase(
    doc: &VaultDocument,
    passphrase: &str,
    salt: &[u8; SALT_LEN],
    nonce: &[u8; NONCE_LEN],
) -> Result<Vec<u8>, VaultError> {
    let key = derive_key(passphrase, salt);
    seal(doc, &key, salt, nonce)
}

/// Read the salt (and KDF) from the blob, derive the key from `passphrase`, open.
pub fn open_with_passphrase(blob: &[u8], passphrase: &str) -> Result<VaultDocument, VaultError> {
    let parsed = parse(blob)?;
    let salt: [u8; SALT_LEN] = parsed.salt.try_into().map_err(|_| VaultError::BadFormat)?;
    let key = match parsed.kdf {
        Kdf::Pbkdf2HmacSha256 => derive_key(passphrase, &salt),
    };
    open(blob, &key)
}

/// Read the salt out of a sealed blob's header, so a host can derive the key
/// separately from opening the blob (and cache the key).
pub fn salt_of(blob: &[u8]) -> Result<[u8; SALT_LEN], VaultError> {
    let parsed = parse(blob)?;
    parsed.salt.try_into().map_err(|_| VaultError::BadFormat)
}

// MARK: header/parse

fn header_bytes(kdf: Kdf, salt: &[u8; SALT_LEN], nonce: &[u8; NONCE_LEN]) -> Vec<u8> {
    let mut h = Vec::with_capacity(HEADER_LEN);
    h.extend_from_slice(MAGIC);
    h.push(VERSION);
    h.push(kdf as u8);
    h.extend_from_slice(salt);
    h.extend_from_slice(nonce);
    h
}

struct Parsed<'a> {
    kdf: Kdf,
    salt: &'a [u8],
    nonce: &'a [u8],
    header: &'a [u8],
    ciphertext: &'a [u8],
}

fn parse(blob: &[u8]) -> Result<Parsed<'_>, VaultError> {
    if blob.len() < HEADER_LEN || &blob[0..4] != MAGIC {
        return Err(VaultError::BadFormat);
    }
    let version = blob[4];
    if version != VERSION {
        return Err(VaultError::UnsupportedVersion(version));
    }
    let kdf_id = blob[5];
    let kdf = Kdf::from_id(kdf_id).ok_or(VaultError::UnknownKdf(kdf_id))?;
    Ok(Parsed {
        kdf,
        salt: &blob[6..6 + SALT_LEN],
        nonce: &blob[6 + SALT_LEN..HEADER_LEN],
        header: &blob[0..HEADER_LEN],
        ciphertext: &blob[HEADER_LEN..],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Account, OtpAlgorithm, OtpType, StoredAccount};
    use uuid::Uuid;

    fn sample_doc() -> VaultDocument {
        VaultDocument {
            entries: vec![StoredAccount {
                account: Account {
                    id: Uuid::from_bytes([7; 16]),
                    issuer: "Acme".into(),
                    label: "me".into(),
                    otp_type: OtpType::Totp,
                    algorithm: OtpAlgorithm::Sha1,
                    digits: 6,
                    period: 30,
                    counter: 0,
                },
                secret: b"TOPSECRETVALUE".to_vec(),
                modified_at: 42,
            }],
            tombstones: vec![],
        }
    }

    const SALT: [u8; SALT_LEN] = [1; SALT_LEN];
    const NONCE: [u8; NONCE_LEN] = [2; NONCE_LEN];

    #[test]
    fn derive_key_is_deterministic_and_salt_sensitive() {
        let a = derive_key("hunter2", &SALT);
        let b = derive_key("hunter2", &SALT);
        let c = derive_key("hunter2", &[9; SALT_LEN]);
        assert_eq!(a.0, b.0);
        assert_ne!(a.0, c.0);
    }

    #[test]
    fn seal_open_round_trips() {
        let doc = sample_doc();
        let blob = seal_with_passphrase(&doc, "pw", &SALT, &NONCE).unwrap();
        assert_eq!(open_with_passphrase(&blob, "pw").unwrap(), doc);
    }

    #[test]
    fn wrong_passphrase_fails() {
        let blob = seal_with_passphrase(&sample_doc(), "right", &SALT, &NONCE).unwrap();
        assert_eq!(
            open_with_passphrase(&blob, "wrong"),
            Err(VaultError::DecryptFailed)
        );
    }

    #[test]
    fn header_is_authenticated() {
        let mut blob = seal_with_passphrase(&sample_doc(), "pw", &SALT, &NONCE).unwrap();
        blob[6] ^= 0xff; // flip a salt byte inside the AAD-bound header
        assert_eq!(
            open_with_passphrase(&blob, "pw"),
            Err(VaultError::DecryptFailed)
        );
    }

    #[test]
    fn ciphertext_tampering_fails() {
        let mut blob = seal_with_passphrase(&sample_doc(), "pw", &SALT, &NONCE).unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0x01;
        assert_eq!(
            open_with_passphrase(&blob, "pw"),
            Err(VaultError::DecryptFailed)
        );
    }

    #[test]
    fn salt_of_reads_the_header_salt() {
        let blob = seal_with_passphrase(&sample_doc(), "pw", &SALT, &NONCE).unwrap();
        assert_eq!(salt_of(&blob).unwrap(), SALT);
        assert_eq!(salt_of(b"short"), Err(VaultError::BadFormat));
    }

    #[test]
    fn derived_key_bytes_round_trip_through_from_bytes() {
        let key = derive_key("pw", &SALT);
        let same = Key::from_bytes(key.to_bytes());
        let blob = seal(&sample_doc(), &key, &SALT, &NONCE).unwrap();
        assert_eq!(open(&blob, &same).unwrap(), sample_doc());
    }

    #[test]
    fn blob_layout_and_no_plaintext_secret() {
        let blob = seal_with_passphrase(&sample_doc(), "pw", &SALT, &NONCE).unwrap();
        assert_eq!(&blob[0..4], MAGIC);
        assert_eq!(blob[4], VERSION);
        assert_eq!(blob[5], Kdf::Pbkdf2HmacSha256 as u8);
        assert_eq!(&blob[6..6 + SALT_LEN], &SALT);
        // The secret must not be observable in the blob.
        assert!(blob.windows(14).all(|w| w != b"TOPSECRETVALUE"));
    }

    #[test]
    fn rejects_malformed_blobs() {
        assert_eq!(
            open_with_passphrase(b"short", "pw"),
            Err(VaultError::BadFormat)
        );
        let mut blob = seal_with_passphrase(&sample_doc(), "pw", &SALT, &NONCE).unwrap();
        blob[4] = 9; // bogus version
        assert_eq!(
            open_with_passphrase(&blob, "pw"),
            Err(VaultError::UnsupportedVersion(9))
        );
    }
}
