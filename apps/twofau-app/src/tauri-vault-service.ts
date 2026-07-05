import { invoke } from "@tauri-apps/api/core";
import type { Account, AddManualFields, Capabilities, VaultService } from "@twofau/ui";

/**
 * Desktop VaultService: every operation is a Tauri command handled by the
 * Rust-owned vault. Secrets stay in Rust — only account metadata and code
 * strings cross the boundary.
 */
export class TauriVaultService implements VaultService {
  private locked: boolean;

  constructor(startUnlocked: boolean) {
    this.locked = !startUnlocked;
  }

  capabilities(): Capabilities {
    // Screen-scan is deferred; clipboard paste + QR image import work in the webview.
    return { scanScreen: false, qrImage: true, paste: true };
  }

  isLocked(): boolean {
    return this.locked;
  }

  async unlock(passphrase: string): Promise<void> {
    await invoke("unlock", { passphrase, remember: true });
    this.locked = false;
  }

  list(): Promise<Account[]> {
    return invoke("list_accounts");
  }

  addUri(otpauthUri: string): Promise<Account> {
    return invoke("add_uri", { uri: otpauthUri });
  }

  addManual(f: AddManualFields): Promise<Account> {
    return invoke("add_manual", {
      issuer: f.issuer,
      label: f.label,
      secretBase32: f.secretBase32,
      kind: f.type,
    });
  }

  async update(account: Account): Promise<void> {
    await invoke("update_account", { account });
  }

  async remove(id: string): Promise<void> {
    await invoke("remove_account", { id });
  }

  code(account: Account, unixTimeMs: number): Promise<string> {
    return invoke("code", { id: account.id, unixMs: Math.floor(unixTimeMs) });
  }

  async advanceHotp(id: string): Promise<void> {
    await invoke("advance_hotp", { id });
  }
}
