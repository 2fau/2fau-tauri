import type { VaultService } from "@twofau/ui";
import { ExtensionVaultService } from "./extension-vault-service";
import { readSettings } from "./settings";
import { VaultRepo } from "./vault-repo";

/**
 * Picks the backend the UI talks to.
 *
 * Sub-project 5 adds the desktop app's localhost bridge here: probe it, and
 * return a `BridgeVaultService` when it answers. Nothing else in the extension
 * knows which backend it got.
 */
export async function createVaultService(): Promise<VaultService> {
  const { storageArea } = await readSettings();
  return ExtensionVaultService.create(new VaultRepo(storageArea));
}
