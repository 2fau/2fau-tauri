export const DEFAULT_AUTO_LOCK_MINUTES = 15;

const SETTINGS_KEY = "settings";

export interface Settings {
  /** Minutes of inactivity before the session key is dropped. 0 means never. */
  autoLockMinutes: number;
  /** Where the vault lives. "local" keeps it on this browser only. */
  storageArea: "sync" | "local";
}

const DEFAULTS: Settings = {
  autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
  storageArea: "sync",
};

/**
 * Settings live in local storage, not sync: the storage-area choice itself has
 * to be answerable before we know where the vault is, and the lock timeout is
 * a property of this browser.
 *
 * Stored values are validated rather than trusted — a junk `autoLockMinutes`
 * reaching `chrome.alarms.create` as NaN throws, which would leave the vault
 * unlocked with no lock deadline at all.
 */
export async function readSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = (got[SETTINGS_KEY] ?? {}) as Partial<Record<keyof Settings, unknown>>;
  const minutes = stored.autoLockMinutes;
  return {
    autoLockMinutes:
      typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 0
        ? minutes
        : DEFAULTS.autoLockMinutes,
    storageArea: stored.storageArea === "local" ? "local" : DEFAULTS.storageArea,
  };
}

export async function writeSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await readSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}
