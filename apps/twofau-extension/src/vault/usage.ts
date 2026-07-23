import { QUOTA_BYTES } from "./vault-repo";

export interface SyncUsage {
  bytes: number;
  quota: number;
  percent: number;
}

/**
 * How much of the 100 KB sync budget the vault occupies. Computed rather than
 * read from getBytesInUse so it works identically under test.
 */
export async function syncUsage(): Promise<SyncUsage> {
  const all = await chrome.storage.sync.get(null);
  const bytes = Object.entries(all).reduce(
    (total, [key, value]) => total + key.length + JSON.stringify(value).length,
    0,
  );
  return { bytes, quota: QUOTA_BYTES, percent: (bytes / QUOTA_BYTES) * 100 };
}
