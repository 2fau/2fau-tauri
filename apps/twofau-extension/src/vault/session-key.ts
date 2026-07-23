import { readSettings } from "./settings";

export { DEFAULT_AUTO_LOCK_MINUTES } from "./settings";
export const AUTO_LOCK_ALARM = "2fau.auto-lock";

const KEY = "vault.key";

/**
 * The derived vault key lives in chrome.storage.session: memory-only, wiped
 * when the browser closes, and — unlike a service-worker global — it survives
 * the worker being torn down and restarted.
 */
export async function getSessionKey(): Promise<string | null> {
  const got = await chrome.storage.session.get(KEY);
  return (got[KEY] as string | undefined) ?? null;
}

export async function setSessionKey(keyB64: string): Promise<void> {
  await chrome.storage.session.set({ [KEY]: keyB64 });
  await armAutoLock();
}

export async function clearSessionKey(): Promise<void> {
  await chrome.storage.session.remove(KEY);
  await chrome.alarms.clear(AUTO_LOCK_ALARM);
}

/** Push the auto-lock deadline back after vault activity. No-op when locked. */
export async function touchSessionKey(): Promise<void> {
  if ((await getSessionKey()) === null) return;
  await armAutoLock();
}

async function armAutoLock(): Promise<void> {
  const { autoLockMinutes } = await readSettings();
  // 0 is "never lock". Handing it to chrome.alarms would arm a deadline that
  // has already passed, locking the vault seconds after it was unlocked.
  if (autoLockMinutes <= 0) {
    await chrome.alarms.clear(AUTO_LOCK_ALARM);
    return;
  }
  chrome.alarms.create(AUTO_LOCK_ALARM, { delayInMinutes: autoLockMinutes });
}
