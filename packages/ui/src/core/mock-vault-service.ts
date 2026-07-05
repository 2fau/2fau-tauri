import { base32Decode, hotp, newId, nowMs, parseOtpauth, totp } from "@twofau/core-wasm";
import { algorithmArg } from "@/lib/format";
import type { AddManualFields, Capabilities, VaultService } from "./vault-service";
import type { Account, StoredAccount, VaultDocument } from "./types";

export interface MockOptions {
  seed?: StoredAccount[];
  startUnlocked?: boolean;
  /** Show the passphrase-setup screen (first run) instead of unlock. */
  needsSetup?: boolean;
  capabilities?: Partial<Capabilities>;
}

/**
 * In-memory `VaultService` for the dev harness and tests. OTP generation and
 * otpauth parsing go through the real WASM core, so the UI is exercised against
 * genuine logic. Storage/unlock are simplified (any passphrase unlocks).
 */
export class MockVaultService implements VaultService {
  private doc: VaultDocument;
  private locked: boolean;
  private setup: boolean;
  private caps: Capabilities;

  constructor(opts: MockOptions = {}) {
    this.doc = { entries: opts.seed ?? [], tombstones: [] };
    this.locked = !(opts.startUnlocked ?? true);
    this.setup = opts.needsSetup ?? false;
    this.caps = { scanScreen: false, qrImage: true, paste: true, ...opts.capabilities };
  }

  capabilities(): Capabilities {
    return this.caps;
  }

  isLocked(): boolean {
    return this.locked;
  }

  needsSetup(): boolean {
    return this.setup;
  }

  async unlock(_passphrase: string): Promise<void> {
    this.locked = false;
  }

  async list(): Promise<Account[]> {
    return this.doc.entries.map((e) => e.account);
  }

  async addUri(otpauthUri: string): Promise<Account> {
    const parsed = await parseOtpauth(otpauthUri);
    const account: Account = {
      id: await newId(),
      issuer: parsed.issuer,
      label: parsed.label,
      otp_type: parsed.otp_type,
      algorithm: parsed.algorithm,
      digits: parsed.digits,
      period: parsed.period,
      counter: parsed.counter,
    };
    this.doc.entries.push({ account, secret: parsed.secret, modified_at: await nowMs() });
    return account;
  }

  async addManual(f: AddManualFields): Promise<Account> {
    const secret = await base32Decode(f.secretBase32); // base64 string
    const account: Account = {
      id: await newId(),
      issuer: f.issuer,
      label: f.label,
      otp_type: f.type === "hotp" ? "Hotp" : "Totp",
      algorithm: "Sha1",
      digits: 6,
      period: 30,
      counter: 0,
    };
    this.doc.entries.push({ account, secret, modified_at: await nowMs() });
    return account;
  }

  async update(account: Account): Promise<void> {
    const e = this.doc.entries.find((x) => x.account.id === account.id);
    if (e) {
      e.account = account;
      e.modified_at = await nowMs();
    }
  }

  async remove(id: string): Promise<void> {
    this.doc.entries = this.doc.entries.filter((e) => e.account.id !== id);
    this.doc.tombstones.push({ id, deleted_at: await nowMs() });
  }

  async code(account: Account, unixTimeMs: number): Promise<string> {
    const e = this.doc.entries.find((x) => x.account.id === account.id);
    if (!e) return "-".repeat(account.digits);
    const algo = algorithmArg(account.algorithm);
    if (account.otp_type === "Hotp") {
      return hotp(e.secret, BigInt(account.counter), account.digits, algo);
    }
    return totp(e.secret, BigInt(Math.floor(unixTimeMs / 1000)), account.period, account.digits, algo);
  }

  async advanceHotp(id: string): Promise<void> {
    const e = this.doc.entries.find((x) => x.account.id === id);
    if (e) {
      e.account = { ...e.account, counter: e.account.counter + 1 };
      e.modified_at = await nowMs();
    }
  }
}
