//! The desktop vault: decrypts and computes codes entirely in the Rust process.
//! Secrets never cross to the webview — only account metadata and code strings
//! do. The OS keyring caches the passphrase so it's entered once per device.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use twofau_core::{
    base32_decode, hotp, open_with_passphrase, parse_otpauth, seal_with_passphrase, totp, Account,
    FileVaultStore, OtpAlgorithm, OtpType, StoredAccount, Tombstone, VaultDocument, VaultStore,
    NONCE_LEN, SALT_LEN,
};
use uuid::Uuid;

const KEYRING_SERVICE: &str = "dev.artkost.2fau";
const KEYRING_USER: &str = "vault-passphrase";

/// Fallback vault location if Tauri's app-data dir can't be resolved. Uses the
/// bundle identifier (not the legacy Swift app's `2fau` dir) to avoid collision.
pub fn fallback_vault_path() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("dev.artkost.2fau")
        .join("vault.dat")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn random<const N: usize>() -> [u8; N] {
    let mut bytes = [0u8; N];
    getrandom::getrandom(&mut bytes).expect("OS RNG unavailable");
    bytes
}

fn str_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

struct Unlocked {
    passphrase: String,
    doc: VaultDocument,
}

pub struct AppVault {
    store: FileVaultStore,
    inner: Mutex<Option<Unlocked>>,
}

impl AppVault {
    pub fn new(path: PathBuf) -> AppVault {
        AppVault {
            store: FileVaultStore::new(path),
            inner: Mutex::new(None),
        }
    }

    pub fn is_locked(&self) -> bool {
        self.inner.lock().expect("vault mutex").is_none()
    }

    pub fn unlock(&self, passphrase: String, remember: bool) -> Result<(), String> {
        let doc = match self.store.load().map_err(str_err)? {
            Some(blob) => open_with_passphrase(&blob, &passphrase).map_err(str_err)?,
            None => {
                // First run: create and persist an empty vault under this passphrase.
                let doc = VaultDocument::default();
                self.seal_and_save(&doc, &passphrase)?;
                doc
            }
        };
        *self.inner.lock().expect("vault mutex") = Some(Unlocked {
            passphrase: passphrase.clone(),
            doc,
        });
        if remember {
            let _ = keyring_set(&passphrase);
        }
        Ok(())
    }

    /// Try to unlock silently using a passphrase cached in the OS keyring.
    pub fn try_auto_unlock(&self) -> bool {
        match keyring_get() {
            Some(pass) => self.unlock(pass, false).is_ok(),
            None => false,
        }
    }

    pub fn list(&self) -> Result<Vec<Account>, String> {
        let guard = self.inner.lock().expect("vault mutex");
        let u = guard.as_ref().ok_or("vault is locked")?;
        Ok(u.doc.entries.iter().map(|e| e.account.clone()).collect())
    }

    pub fn code(&self, id: &str, unix_ms: u64) -> Result<String, String> {
        let uuid = Uuid::parse_str(id).map_err(str_err)?;
        let guard = self.inner.lock().expect("vault mutex");
        let u = guard.as_ref().ok_or("vault is locked")?;
        let entry = u
            .doc
            .entries
            .iter()
            .find(|e| e.account.id == uuid)
            .ok_or("no such account")?;
        let a = &entry.account;
        Ok(match a.otp_type {
            OtpType::Totp => totp(
                &entry.secret,
                unix_ms / 1000,
                a.period,
                a.digits,
                a.algorithm,
            ),
            OtpType::Hotp => hotp(&entry.secret, a.counter, a.digits, a.algorithm),
        })
    }

    pub fn add_uri(&self, uri: &str) -> Result<Account, String> {
        let parsed = parse_otpauth(uri).map_err(str_err)?;
        let account = Account {
            id: Uuid::new_v4(),
            issuer: parsed.issuer,
            label: parsed.label,
            otp_type: parsed.otp_type,
            algorithm: parsed.algorithm,
            digits: parsed.digits,
            period: parsed.period,
            counter: parsed.counter,
        };
        let stored = StoredAccount {
            account: account.clone(),
            secret: parsed.secret,
            modified_at: now_ms(),
        };
        self.mutate(|doc| doc.entries.push(stored))?;
        Ok(account)
    }

    pub fn add_manual(
        &self,
        issuer: String,
        label: String,
        secret_base32: String,
        kind: String,
    ) -> Result<Account, String> {
        let secret = base32_decode(&secret_base32).map_err(str_err)?;
        let otp_type = if kind == "hotp" {
            OtpType::Hotp
        } else {
            OtpType::Totp
        };
        let account = Account {
            id: Uuid::new_v4(),
            issuer,
            label,
            otp_type,
            algorithm: OtpAlgorithm::Sha1,
            digits: 6,
            period: 30,
            counter: 0,
        };
        let stored = StoredAccount {
            account: account.clone(),
            secret,
            modified_at: now_ms(),
        };
        self.mutate(|doc| doc.entries.push(stored))?;
        Ok(account)
    }

    pub fn update(&self, account: Account) -> Result<(), String> {
        let ts = now_ms();
        self.mutate(|doc| {
            if let Some(e) = doc.entries.iter_mut().find(|e| e.account.id == account.id) {
                e.account = account;
                e.modified_at = ts;
            }
        })
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let uuid = Uuid::parse_str(id).map_err(str_err)?;
        let ts = now_ms();
        self.mutate(|doc| {
            doc.entries.retain(|e| e.account.id != uuid);
            doc.tombstones.push(Tombstone {
                id: uuid,
                deleted_at: ts,
            });
        })
    }

    pub fn advance_hotp(&self, id: &str) -> Result<(), String> {
        let uuid = Uuid::parse_str(id).map_err(str_err)?;
        let ts = now_ms();
        self.mutate(|doc| {
            if let Some(e) = doc.entries.iter_mut().find(|e| e.account.id == uuid) {
                e.account.counter += 1;
                e.modified_at = ts;
            }
        })
    }

    // Apply `f` to the in-memory doc, then re-seal and persist under the same
    // passphrase with a fresh random salt + nonce.
    fn mutate<T>(&self, f: impl FnOnce(&mut VaultDocument) -> T) -> Result<T, String> {
        let mut guard = self.inner.lock().expect("vault mutex");
        let u = guard.as_mut().ok_or("vault is locked")?;
        let out = f(&mut u.doc);
        let doc = u.doc.clone();
        let pass = u.passphrase.clone();
        drop(guard);
        self.seal_and_save(&doc, &pass)?;
        Ok(out)
    }

    fn seal_and_save(&self, doc: &VaultDocument, passphrase: &str) -> Result<(), String> {
        let salt = random::<SALT_LEN>();
        let nonce = random::<NONCE_LEN>();
        let blob = seal_with_passphrase(doc, passphrase, &salt, &nonce).map_err(str_err)?;
        self.store.save(&blob).map_err(str_err)
    }
}

fn keyring_entry() -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
}

fn keyring_set(passphrase: &str) -> Result<(), keyring::Error> {
    keyring_entry()?.set_password(passphrase)
}

fn keyring_get() -> Option<String> {
    keyring_entry().ok()?.get_password().ok()
}
