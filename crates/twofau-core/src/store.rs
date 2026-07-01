//! Storage abstraction for the encrypted vault blob. The blob is opaque here —
//! encryption lives in [`crate::vault`]. The Chrome extension stores blobs in
//! JS (`chrome.storage`) and does not use this trait.

use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    Io(String),
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StoreError::Io(m) => write!(f, "vault store I/O error: {m}"),
        }
    }
}

impl std::error::Error for StoreError {}

/// Load/save the raw (encrypted) vault blob. `load` returns `None` when no vault
/// has been written yet.
pub trait VaultStore {
    fn load(&self) -> Result<Option<Vec<u8>>, StoreError>;
    fn save(&self, blob: &[u8]) -> Result<(), StoreError>;
}

/// In-memory store for tests and ephemeral use. Works on every target.
#[derive(Default)]
pub struct InMemoryVaultStore {
    blob: Mutex<Option<Vec<u8>>>,
}

impl InMemoryVaultStore {
    pub fn new() -> InMemoryVaultStore {
        InMemoryVaultStore::default()
    }
}

impl VaultStore for InMemoryVaultStore {
    fn load(&self) -> Result<Option<Vec<u8>>, StoreError> {
        Ok(self.blob.lock().expect("store mutex poisoned").clone())
    }

    fn save(&self, blob: &[u8]) -> Result<(), StoreError> {
        *self.blob.lock().expect("store mutex poisoned") = Some(blob.to_vec());
        Ok(())
    }
}

/// File-backed store with atomic writes (temp file + rename). Native only.
#[cfg(not(target_arch = "wasm32"))]
pub struct FileVaultStore {
    path: std::path::PathBuf,
}

#[cfg(not(target_arch = "wasm32"))]
impl FileVaultStore {
    pub fn new(path: impl Into<std::path::PathBuf>) -> FileVaultStore {
        FileVaultStore { path: path.into() }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl VaultStore for FileVaultStore {
    fn load(&self) -> Result<Option<Vec<u8>>, StoreError> {
        match std::fs::read(&self.path) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(StoreError::Io(e.to_string())),
        }
    }

    fn save(&self, blob: &[u8]) -> Result<(), StoreError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| StoreError::Io(e.to_string()))?;
        }
        let tmp = self.path.with_extension("tmp");
        std::fs::write(&tmp, blob).map_err(|e| StoreError::Io(e.to_string()))?;
        std::fs::rename(&tmp, &self.path).map_err(|e| StoreError::Io(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_memory_round_trips_and_starts_empty() {
        let store = InMemoryVaultStore::new();
        assert_eq!(store.load().unwrap(), None);
        store.save(b"blob").unwrap();
        assert_eq!(store.load().unwrap(), Some(b"blob".to_vec()));
    }

    #[cfg(not(target_arch = "wasm32"))]
    #[test]
    fn file_store_round_trips_and_absent_is_none() {
        let dir = std::env::temp_dir().join(format!(
            "2fau-store-test-{}",
            uuid::Uuid::from_bytes([3; 16])
        ));
        let path = dir.join("vault.dat");
        let store = FileVaultStore::new(&path);
        assert_eq!(store.load().unwrap(), None);
        store.save(b"encrypted").unwrap();
        assert_eq!(store.load().unwrap(), Some(b"encrypted".to_vec()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
