import type { Account } from "./types";

/** Which host-specific actions the UI should surface (capability-gated). */
export interface Capabilities {
  /** Grab a QR code off the screen (desktop only). */
  scanScreen: boolean;
  /** Import a QR code from an image file. */
  qrImage: boolean;
  /** Import an otpauth:// URI / QR from the clipboard. */
  paste: boolean;
}

export interface AddManualFields {
  issuer: string;
  label: string;
  secretBase32: string;
  type: "totp" | "hotp";
}

/**
 * The only backend the UI talks to. Implemented in-memory by
 * `MockVaultService`, over Tauri IPC by the desktop app, and over WASM +
 * chrome.storage / HTTP by the extension.
 */
export interface VaultService {
  capabilities(): Capabilities;
  isLocked(): boolean;
  unlock(passphrase: string): Promise<void>;
  list(): Promise<Account[]>;
  addUri(otpauthUri: string): Promise<Account>;
  addManual(fields: AddManualFields): Promise<Account>;
  update(account: Account): Promise<void>;
  remove(id: string): Promise<void>;
  /** Current OTP for `account` at `unixTimeMs`. */
  code(account: Account, unixTimeMs: number): Promise<string>;
  advanceHotp(id: string): Promise<void>;
}
