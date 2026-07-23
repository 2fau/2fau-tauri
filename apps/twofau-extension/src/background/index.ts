import { createVaultService } from "../vault/backend";
import { recordUse } from "../vault/recent";
import { AUTO_LOCK_ALARM, clearSessionKey } from "../vault/session-key";
import { initWasm } from "../wasm";
import { copyToClipboard } from "./clipboard";
import { accountIdFromMenuItem, refreshContextMenu } from "./context-menu";

// No module-level state beyond these listener registrations: the worker is torn
// down whenever Chrome feels like it, so every handler re-reads from storage.

chrome.runtime.onInstalled.addListener(() => void refreshContextMenu());
chrome.runtime.onStartup.addListener(() => void refreshContextMenu());

// Lock state and the account list both live in storage; rebuild the menu when
// either changes.
chrome.storage.onChanged.addListener((changes, area) => {
  const relevant =
    (area === "session" && "vault.key" in changes) ||
    (area !== "session" && ("vault.manifest" in changes || "recent" in changes));
  if (relevant) void refreshContextMenu();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== AUTO_LOCK_ALARM) return;
  await clearSessionKey();
  await refreshContextMenu();
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const id = accountIdFromMenuItem(String(info.menuItemId));
  if (!id) return;

  await chrome.action.setBadgeText({ text: "" });
  try {
    await initWasm();
    const service = await createVaultService();
    const account = (await service.list()).find((a) => a.id === id);
    if (!account) return;

    const code = await service.code(account, Date.now());
    await copyToClipboard(code);
    if (account.otp_type === "Hotp") await service.advanceHotp(account.id);
    await recordUse(account.id);
    await flashBadge("✓", "#2f9e44");
  } catch {
    await flashBadge("!", "#e03131");
  }
});

/** Confirm the action visually — a silent copy is indistinguishable from a
 *  failure. Best-effort: the badge clears on the next copy regardless. */
async function flashBadge(text: string, color: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => void chrome.action.setBadgeText({ text: "" }), 1500);
}
