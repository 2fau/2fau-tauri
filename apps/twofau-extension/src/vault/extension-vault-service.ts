import {
  base32Decode,
  deriveKey,
  hotp,
  merge,
  newId,
  newSalt,
  openWithKey,
  parseOtpauth,
  sealWithKey,
  totp,
  vaultSalt,
} from "@twofau/core-wasm";
import type {
  Account,
  AddManualFields,
  Capabilities,
  StoredAccount,
  VaultDocument,
  VaultService,
} from "@twofau/ui";
import { algorithmArg } from "@twofau/ui";
import { clearSessionKey, getSessionKey, setSessionKey, touchSessionKey } from "./session-key";
import { VaultRepo, type VaultManifest } from "./vault-repo";

/** PBKDF2-HMAC-SHA256; the only KDF the blob format defines today. */
export const KDF_ID = 1;

/** Confirmed by the Task 11 spike: activeTab covers a popup button click. */
const SCAN_SUPPORTED = true;

const MAX_MERGE_ATTEMPTS = 3;

/**
 * `VaultService` over the WASM core and chrome.storage.
 *
 * Nothing is persisted in the clear: the passphrase is never stored, the
 * derived key lives in session storage, and the decrypted document is held
 * only in memory, tagged with the revision it came from. That cache is what
 * makes per-second code generation viable — without it every account would
 * cost a storage read and a decrypt on every tick — and it is dropped the
 * moment the vault locks.
 */
export class ExtensionVaultService implements VaultService {
  private cached: { revision: number; doc: VaultDocument } | null = null;

  private constructor(
    private readonly repo: VaultRepo,
    private vaultExists: boolean,
    private unlocked: boolean,
  ) {}

  static async create(repo: VaultRepo = new VaultRepo()): Promise<ExtensionVaultService> {
    const vaultExists = await repo.hasVault();
    const unlocked = vaultExists && (await getSessionKey()) !== null;
    return new ExtensionVaultService(repo, vaultExists, unlocked);
  }

  capabilities(): Capabilities {
    return { scanScreen: SCAN_SUPPORTED, qrImage: true, paste: true };
  }

  isLocked(): boolean {
    return !this.unlocked;
  }

  needsSetup(): boolean {
    return !this.vaultExists;
  }

  async unlock(passphrase: string): Promise<void> {
    const loaded = await this.repo.load();
    if (!loaded) {
      // First run: this passphrase creates the vault.
      const salt = await newSalt();
      const key = await deriveKey(passphrase, salt);
      const doc: VaultDocument = { entries: [], tombstones: [] };
      const saved = await this.repo.save(await sealWithKey(doc, key, salt), salt, KDF_ID, 0);
      await setSessionKey(key);
      this.cached = saved.ok ? { revision: saved.manifest.revision, doc } : null;
      this.vaultExists = true;
      this.unlocked = true;
      return;
    }

    const salt = await vaultSalt(loaded.blob);
    const key = await deriveKey(passphrase, salt);
    let doc: VaultDocument;
    try {
      doc = await openWithKey(loaded.blob, key);
    } catch (cause) {
      // A wrong passphrase and a corrupt blob both land here; only the former
      // is actionable, so say that and keep the real cause for the console.
      throw new Error("Wrong passphrase", { cause });
    }
    await setSessionKey(key);
    this.cached = { revision: loaded.manifest.revision, doc };
    this.unlocked = true;
  }

  /** Forget the key and the decrypted copy. */
  async lock(): Promise<void> {
    this.cached = null;
    this.unlocked = false;
    await clearSessionKey();
  }

  async list(): Promise<Account[]> {
    return (await this.listStored()).map((e) => e.account);
  }

  /** Entries with their secrets — for the service worker's code generation. */
  async listStored(): Promise<StoredAccount[]> {
    return (await this.read()).doc.entries;
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
    await this.mutate((doc) => {
      doc.entries.push({ account, secret: parsed.secret, modified_at: Date.now() });
    });
    return account;
  }

  async addManual(fields: AddManualFields): Promise<Account> {
    const secret = await base32Decode(fields.secretBase32);
    const account: Account = {
      id: await newId(),
      issuer: fields.issuer,
      label: fields.label,
      otp_type: fields.type === "hotp" ? "Hotp" : "Totp",
      algorithm: "Sha1",
      digits: 6,
      period: 30,
      counter: 0,
    };
    await this.mutate((doc) => {
      doc.entries.push({ account, secret, modified_at: Date.now() });
    });
    return account;
  }

  async update(account: Account): Promise<void> {
    await this.mutate((doc) => {
      const entry = doc.entries.find((e) => e.account.id === account.id);
      if (entry) {
        entry.account = account;
        entry.modified_at = Date.now();
      }
    });
  }

  async remove(id: string): Promise<void> {
    await this.mutate((doc) => {
      doc.entries = doc.entries.filter((e) => e.account.id !== id);
      doc.tombstones.push({ id, deleted_at: Date.now() });
    });
  }

  async advanceHotp(id: string): Promise<void> {
    await this.mutate((doc) => {
      const entry = doc.entries.find((e) => e.account.id === id);
      if (entry) {
        entry.account = { ...entry.account, counter: entry.account.counter + 1 };
        entry.modified_at = Date.now();
      }
    });
  }

  async code(account: Account, unixTimeMs: number): Promise<string> {
    const entry = (await this.listStored()).find((e) => e.account.id === account.id);
    if (!entry) return "-".repeat(account.digits);
    const algo = algorithmArg(account.algorithm);
    if (account.otp_type === "Hotp") {
      return hotp(entry.secret, BigInt(account.counter), account.digits, algo);
    }
    return totp(
      entry.secret,
      BigInt(Math.floor(unixTimeMs / 1000)),
      account.period,
      account.digits,
      algo,
    );
  }

  /** Re-derive under a new passphrase and re-seal with a fresh salt. */
  async changePassphrase(current: string, next: string): Promise<void> {
    const loaded = await this.repo.load();
    if (!loaded) throw new Error("There is no vault to re-encrypt.");

    const currentKey = await deriveKey(current, await vaultSalt(loaded.blob));
    let doc: VaultDocument;
    try {
      doc = await openWithKey(loaded.blob, currentKey);
    } catch (cause) {
      throw new Error("Wrong passphrase", { cause });
    }

    const salt = await newSalt();
    const key = await deriveKey(next, salt);
    const blob = await sealWithKey(doc, key, salt);
    const result = await this.repo.save(blob, salt, KDF_ID, loaded.manifest.revision);
    if (!result.ok) {
      throw new Error("The vault changed in another browser — reopen and try again.");
    }
    await setSessionKey(key);
    // The stored key is now the new one, so the cache has to move with it, or
    // this instance's next read would decrypt the new blob with the old key.
    this.cached = { revision: result.manifest.revision, doc };
    this.unlocked = true;
  }

  /** The sealed blob exactly as stored — same format as the desktop vault.dat. */
  async exportBlob(): Promise<Uint8Array> {
    const loaded = await this.repo.load();
    if (!loaded) throw new Error("There is no vault to export.");
    return loaded.blob;
  }

  /** Merge an exported blob into this vault. Returns the resulting account count. */
  async importBlob(blob: Uint8Array, passphrase: string): Promise<number> {
    const importedKey = await deriveKey(passphrase, await vaultSalt(blob));
    let imported: VaultDocument;
    try {
      imported = await openWithKey(blob, importedKey);
    } catch (cause) {
      throw new Error("Wrong passphrase for that file", { cause });
    }

    // Merge through the core rather than by hand, so import obeys exactly the
    // same newest-wins/tombstone rules as concurrent sync writes.
    const { doc, manifest, key } = await this.read();
    const merged = await merge(doc, imported);
    await this.commit(merged, manifest, key);
    return merged.entries.length;
  }

  // MARK: internals

  private async requireKey(): Promise<string> {
    const key = await getSessionKey();
    if (key === null) {
      this.unlocked = false;
      this.cached = null; // never hold plaintext past a lock
      throw new Error("The vault is locked.");
    }
    return key;
  }

  /**
   * The decrypted document, its manifest, and the key. Reads the manifest
   * first — one small item — and only fetches and decrypts the chunks when the
   * revision has moved past what's cached, so another browser's write is never
   * hidden by a stale copy.
   */
  private async read(): Promise<{ doc: VaultDocument; manifest: VaultManifest; key: string }> {
    const key = await this.requireKey();
    const manifest = await this.repo.loadManifest();
    if (!manifest) throw new Error("The vault is locked.");

    if (this.cached?.revision === manifest.revision) {
      return { doc: structuredClone(this.cached.doc), manifest, key };
    }

    const loaded = await this.repo.load();
    if (!loaded) throw new Error("The vault is locked.");
    const doc = await openWithKey(loaded.blob, key);
    // The torn-read fallback can serve an older generation than the manifest
    // we just read, so cache against the revision the blob actually came from.
    this.cached = { revision: loaded.manifest.revision, doc };
    return { doc: structuredClone(doc), manifest: loaded.manifest, key };
  }

  /** Apply `change`, then commit with the revision guard from the spec. */
  private async mutate(change: (doc: VaultDocument) => void): Promise<void> {
    const { doc, manifest, key } = await this.read();
    change(doc);
    await this.commit(doc, manifest, key);
    // Only a deliberate change counts as activity. Rendering codes does not,
    // or an untouched open popup would hold the vault unlocked indefinitely.
    await touchSessionKey();
  }

  /**
   * Write `doc`, re-merging and retrying if another browser committed first.
   * This is the revision guard: the normal path is a plain overwrite.
   */
  private async commit(
    doc: VaultDocument,
    manifest: VaultManifest,
    key: string,
  ): Promise<void> {
    const salt = manifest.salt;
    let next = doc;
    let base = manifest.revision;

    for (let attempt = 0; attempt < MAX_MERGE_ATTEMPTS; attempt += 1) {
      const blob = await sealWithKey(next, key, salt);
      const result = await this.repo.save(blob, salt, KDF_ID, base);
      if (result.ok) {
        this.cached = { revision: result.manifest.revision, doc: next };
        return;
      }

      if (result.conflict.manifest.salt !== salt) {
        // A new salt means the passphrase was changed elsewhere. Our key can't
        // open that blob, and re-sealing under the old salt would lock the
        // other browser out of its own vault.
        this.cached = null;
        throw new Error("The vault passphrase was changed in another browser. Unlock again.");
      }

      // Another browser committed first: fold its document in and retry.
      const remote = await openWithKey(result.conflict.blob, key);
      next = await merge(next, remote);
      base = result.conflict.manifest.revision;
    }

    this.cached = null;
    throw new Error("The vault is being written from another browser — try again.");
  }
}
