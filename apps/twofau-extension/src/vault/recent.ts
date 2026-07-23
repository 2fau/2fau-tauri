const RECENT_KEY = "recent";

/** How many accounts the context menu offers. */
export const RECENT_LIMIT = 5;

/** Account ids, most recently used first. Ids only — no secrets, no codes. */
export async function recentIds(): Promise<string[]> {
  const got = await chrome.storage.local.get(RECENT_KEY);
  return (got[RECENT_KEY] as string[] | undefined) ?? [];
}

export async function recordUse(id: string): Promise<void> {
  // Keep a little more than the menu shows so a recently-used account that
  // isn't in the current top five still survives a churn of others.
  const next = [id, ...(await recentIds()).filter((x) => x !== id)].slice(0, RECENT_LIMIT * 2);
  await chrome.storage.local.set({ [RECENT_KEY]: next });
}
