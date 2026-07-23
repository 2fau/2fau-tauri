import type { Account } from "@twofau/ui";
import { beforeEach, describe, expect, it } from "vitest";
import { installFakeChrome } from "../test/fake-chrome";
import { ExtensionVaultService } from "./extension-vault-service";
import { clearSessionKey } from "./session-key";
import { type SaveResult, VaultRepo } from "./vault-repo";

const PASSPHRASE = "correct-horse-battery";
const URI = "otpauth://totp/Acme:me@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Acme";

const MANUAL = {
  issuer: "Other",
  label: "them",
  secretBase32: "JBSWY3DPEHPK3PXP",
  type: "totp",
} as const;

async function freshService(repo: VaultRepo = new VaultRepo()) {
  return ExtensionVaultService.create(repo);
}

beforeEach(() => {
  installFakeChrome();
});

describe("ExtensionVaultService", () => {
  it("asks for setup on first run and creates the vault on unlock", async () => {
    const service = await freshService();
    expect(service.needsSetup()).toBe(true);
    expect(service.isLocked()).toBe(true);

    await service.unlock(PASSPHRASE);
    expect(service.isLocked()).toBe(false);
    expect(await service.list()).toEqual([]);

    const reopened = await freshService();
    expect(reopened.needsSetup()).toBe(false);
  });

  it("rejects the wrong passphrase and stays locked", async () => {
    await (await freshService()).unlock(PASSPHRASE);
    await clearSessionKey();

    const service = await freshService();
    await expect(service.unlock("not-the-passphrase")).rejects.toThrow(/passphrase/i);
    expect(service.isLocked()).toBe(true);
  });

  it("adds, lists, updates, and removes accounts across instances", async () => {
    const service = await freshService();
    await service.unlock(PASSPHRASE);

    const added = await service.addUri(URI);
    expect(added.issuer).toBe("Acme");

    const reloaded = await freshService();
    await reloaded.unlock(PASSPHRASE);
    const [account] = await reloaded.list();
    expect(account.id).toBe(added.id);

    await reloaded.update({ ...account, label: "renamed" });
    expect((await reloaded.list())[0].label).toBe("renamed");

    await reloaded.remove(account.id);
    expect(await reloaded.list()).toEqual([]);
  });

  it("produces a six-digit code for a known secret and time", async () => {
    const service = await freshService();
    await service.unlock(PASSPHRASE);
    const account = await service.addUri(URI);
    expect(await service.code(account, 59_000)).toMatch(/^\d{6}$/);
  });

  it("advances the HOTP counter", async () => {
    const service = await freshService();
    await service.unlock(PASSPHRASE);
    const account = await service.addManual({ ...MANUAL, label: "counter", type: "hotp" });
    await service.advanceHotp(account.id);
    expect((await service.list())[0].counter).toBe(1);
  });

  it("refuses vault operations while locked", async () => {
    const service = await freshService();
    await expect(service.list()).rejects.toThrow(/locked/i);
  });

  it("drops its decrypted copy on lock", async () => {
    const service = await freshService();
    await service.unlock(PASSPHRASE);
    await service.addUri(URI);

    await service.lock();

    expect(service.isLocked()).toBe(true);
    await expect(service.list()).rejects.toThrow(/locked/i);
  });

  // The merge path only runs when a writer commits between our read and our
  // write. A second service instance used sequentially never triggers it —
  // every call re-reads storage — so the race has to be injected.
  it("merges instead of clobbering when another browser commits mid-write", async () => {
    const repo = new RacingRepo();
    const service = await freshService(repo);
    await service.unlock(PASSPHRASE);
    const mine = await service.addUri(URI);

    const other = await freshService();
    await other.unlock(PASSPHRASE);

    let theirs: Account | undefined;
    repo.raceOnce(async () => {
      theirs = await other.addManual(MANUAL);
    });
    await service.update({ ...mine, label: "mine-renamed" });

    // Two writes for one update: the guarded one that lost, then the retry.
    // Without this the test would still pass if the conflict never happened.
    expect(repo.saves).toBe(2);

    const final = await freshService();
    await final.unlock(PASSPHRASE);
    const accounts = await final.list();
    expect(accounts.map((a) => a.id).sort()).toEqual([mine.id, theirs?.id].sort());
    expect(accounts.find((a) => a.id === mine.id)?.label).toBe("mine-renamed");
  });

  // Codes are recomputed for every account on every tick. Decrypting the whole
  // vault per call would mean N storage reads a second.
  it("reuses one decryption across repeated reads at the same revision", async () => {
    const repo = new CountingRepo();
    const service = await freshService(repo);
    await service.unlock(PASSPHRASE);
    const account = await service.addUri(URI);

    repo.loads = 0;
    await service.code(account, 59_000);
    await service.code(account, 60_000);
    await service.list();

    expect(repo.loads).toBe(0);
  });

  // ...but a cache that outlives its revision would hide another browser's
  // writes until the popup is reopened.
  it("sees a write made by another instance", async () => {
    const service = await freshService();
    await service.unlock(PASSPHRASE);
    expect(await service.list()).toEqual([]);

    const other = await freshService();
    await other.unlock(PASSPHRASE);
    await other.addUri(URI);

    expect(await service.list()).toHaveLength(1);
  });
});

/** Lets another writer slip in between our read and our write, exactly once. */
class RacingRepo extends VaultRepo {
  saves = 0;
  private pending: (() => Promise<void>) | null = null;

  raceOnce(writer: () => Promise<void>): void {
    this.saves = 0;
    this.pending = writer;
  }

  override async save(
    blob: Uint8Array,
    salt: string,
    kdfId: number,
    baseRevision: number,
  ): Promise<SaveResult> {
    this.saves += 1;
    const writer = this.pending;
    this.pending = null;
    if (writer) await writer();
    return super.save(blob, salt, kdfId, baseRevision);
  }
}

/** Counts full vault reads (chunk fetch + decrypt), not manifest peeks. */
class CountingRepo extends VaultRepo {
  loads = 0;

  override async load() {
    this.loads += 1;
    return super.load();
  }
}
