use crate::model::{StoredAccount, Tombstone, VaultDocument};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

/// Merge two vault documents deterministically, per account `id`:
///
/// - The entry with the greatest `modified_at` and the tombstone with the
///   greatest `deleted_at` are the candidates for that id.
/// - **Newest wins.** An entry survives only if its `modified_at` is strictly
///   greater than the latest tombstone's `deleted_at` — so a **tombstone wins on
///   a tie** (a delete beats a concurrent edit), and a re-add after delete wins
///   only when it is genuinely newer.
///
/// Output is sorted by id for reproducibility.
pub fn merge(local: &VaultDocument, remote: &VaultDocument) -> VaultDocument {
    let mut latest_entry: BTreeMap<Uuid, &StoredAccount> = BTreeMap::new();
    for e in local.entries.iter().chain(remote.entries.iter()) {
        latest_entry
            .entry(e.account.id)
            .and_modify(|cur| {
                if e.modified_at > cur.modified_at {
                    *cur = e;
                }
            })
            .or_insert(e);
    }

    let mut latest_tomb: BTreeMap<Uuid, &Tombstone> = BTreeMap::new();
    for t in local.tombstones.iter().chain(remote.tombstones.iter()) {
        latest_tomb
            .entry(t.id)
            .and_modify(|cur| {
                if t.deleted_at > cur.deleted_at {
                    *cur = t;
                }
            })
            .or_insert(t);
    }

    let ids: BTreeSet<Uuid> = latest_entry
        .keys()
        .chain(latest_tomb.keys())
        .copied()
        .collect();

    let mut entries = Vec::new();
    let mut tombstones = Vec::new();
    for id in ids {
        match (latest_entry.get(&id), latest_tomb.get(&id)) {
            (Some(e), Some(t)) => {
                if e.modified_at > t.deleted_at {
                    entries.push((*e).clone());
                } else {
                    tombstones.push((*t).clone());
                }
            }
            (Some(e), None) => entries.push((*e).clone()),
            (None, Some(t)) => tombstones.push((*t).clone()),
            (None, None) => unreachable!("id came from one of the two maps"),
        }
    }

    VaultDocument {
        entries,
        tombstones,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Account, OtpAlgorithm, OtpType};

    fn id(n: u8) -> Uuid {
        Uuid::from_bytes([n; 16])
    }

    fn entry(n: u8, modified_at: u64) -> StoredAccount {
        StoredAccount {
            account: Account {
                id: id(n),
                issuer: "Acme".into(),
                label: "me".into(),
                otp_type: OtpType::Totp,
                algorithm: OtpAlgorithm::Sha1,
                digits: 6,
                period: 30,
                counter: 0,
            },
            secret: vec![1, 2, 3],
            modified_at,
        }
    }

    fn doc(entries: Vec<StoredAccount>, tombstones: Vec<Tombstone>) -> VaultDocument {
        VaultDocument {
            entries,
            tombstones,
        }
    }

    #[test]
    fn newest_entry_wins() {
        let local = doc(vec![entry(1, 100)], vec![]);
        let remote = doc(vec![entry(1, 200)], vec![]);
        let out = merge(&local, &remote);
        assert_eq!(out.entries, vec![entry(1, 200)]);
        assert!(out.tombstones.is_empty());
    }

    #[test]
    fn disjoint_union_is_preserved_and_sorted() {
        let local = doc(vec![entry(2, 10)], vec![]);
        let remote = doc(vec![entry(1, 10)], vec![]);
        let out = merge(&local, &remote);
        assert_eq!(out.entries, vec![entry(1, 10), entry(2, 10)]);
    }

    #[test]
    fn tombstone_wins_on_tie() {
        let local = doc(vec![entry(1, 100)], vec![]);
        let remote = doc(
            vec![],
            vec![Tombstone {
                id: id(1),
                deleted_at: 100,
            }],
        );
        let out = merge(&local, &remote);
        assert!(out.entries.is_empty());
        assert_eq!(
            out.tombstones,
            vec![Tombstone {
                id: id(1),
                deleted_at: 100
            }]
        );
    }

    #[test]
    fn re_add_after_delete_wins_when_newer() {
        let local = doc(
            vec![],
            vec![Tombstone {
                id: id(1),
                deleted_at: 100,
            }],
        );
        let remote = doc(vec![entry(1, 101)], vec![]);
        let out = merge(&local, &remote);
        assert_eq!(out.entries, vec![entry(1, 101)]);
        assert!(out.tombstones.is_empty());
    }

    #[test]
    fn empty_sides_merge_to_empty() {
        let out = merge(&VaultDocument::default(), &VaultDocument::default());
        assert_eq!(out, VaultDocument::default());
    }
}
