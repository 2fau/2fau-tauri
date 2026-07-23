import type { Account } from "@twofau/ui";
import { primaryName, secondaryName } from "@twofau/ui";
import { createVaultService } from "../vault/backend";
import { RECENT_LIMIT, recentIds } from "../vault/recent";

export const MENU_PARENT_ID = "2fau";
export const MENU_CODE_PREFIX = "2fau.code.";
const MENU_LOCKED_ID = "2fau.locked";

/** The account id behind a menu item, or null for anything else. */
export function accountIdFromMenuItem(menuItemId: string): string | null {
  return menuItemId.startsWith(MENU_CODE_PREFIX)
    ? menuItemId.slice(MENU_CODE_PREFIX.length)
    : null;
}

/**
 * Rebuild the quick-copy menu: the five most recently used accounts, titled by
 * name. Codes are deliberately not in the titles — they rotate every 30s, so
 * live titles would mean constant churn, and a code sitting in an OS menu is a
 * needless exposure. The code is generated when an item is clicked.
 */
export async function refreshContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_PARENT_ID,
    title: "2FAU",
    contexts: ["all"],
  });

  const service = await createVaultService();
  if (service.isLocked()) {
    chrome.contextMenus.create({
      id: MENU_LOCKED_ID,
      parentId: MENU_PARENT_ID,
      title: "Locked — open 2FAU to unlock",
      enabled: false,
      contexts: ["all"],
    });
    return;
  }

  for (const account of orderByRecency(await service.list(), await recentIds())) {
    const secondary = secondaryName(account);
    chrome.contextMenus.create({
      id: `${MENU_CODE_PREFIX}${account.id}`,
      parentId: MENU_PARENT_ID,
      title: secondary ? `${primaryName(account)} — ${secondary}` : primaryName(account),
      contexts: ["all"],
    });
  }
}

function orderByRecency(accounts: Account[], recent: string[]): Account[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const ordered = recent.flatMap((id) => {
    const account = byId.get(id);
    return account ? [account] : [];
  });
  const seen = new Set(ordered.map((a) => a.id));
  return [...ordered, ...accounts.filter((a) => !seen.has(a.id))].slice(0, RECENT_LIMIT);
}
