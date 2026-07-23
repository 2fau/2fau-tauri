import { beforeEach, describe, expect, it } from "vitest";
import { installFakeChrome } from "../test/fake-chrome";
import { ExtensionVaultService } from "./extension-vault-service";

const PASSPHRASE = "correct-horse-battery";
const NEXT = "tr0ubador-and-more";

const ACME = {
  issuer: "Acme",
  label: "me",
  secretBase32: "JBSWY3DPEHPK3PXP",
  type: "totp",
} as const;

async function unlocked() {
  const service = await ExtensionVaultService.create();
  await service.unlock(PASSPHRASE);
  return service;
}

beforeEach(() => {
  installFakeChrome();
});

describe("changePassphrase", () => {
  it("re-seals under the new passphrase and rejects the old one", async () => {
    const service = await unlocked();
    await service.addManual(ACME);

    await service.changePassphrase(PASSPHRASE, NEXT);

    const reopened = await ExtensionVaultService.create();
    await expect(reopened.unlock(PASSPHRASE)).rejects.toThrow(/passphrase/i);
    await reopened.unlock(NEXT);
    expect(await reopened.list()).toHaveLength(1);
  });

  it("refuses a wrong current passphrase", async () => {
    const service = await unlocked();
    await expect(service.changePassphrase("wrong", NEXT)).rejects.toThrow(/passphrase/i);
  });

  // The change re-derives the key and re-seals; a stale cache keyed to the old
  // revision would keep the vault usable but under the wrong key.
  it("leaves the same instance able to add under the new passphrase", async () => {
    const service = await unlocked();
    await service.addManual(ACME);
    await service.changePassphrase(PASSPHRASE, NEXT);

    await service.addManual({ ...ACME, label: "after" });

    const reopened = await ExtensionVaultService.create();
    await reopened.unlock(NEXT);
    expect(await reopened.list()).toHaveLength(2);
  });
});

describe("export / import", () => {
  it("exports a blob that imports back, merging rather than replacing", async () => {
    const source = await unlocked();
    const exported = await source.addManual({ ...ACME, issuer: "Exported", label: "one" });
    const blob = await source.exportBlob();

    // A different browser with a different vault and its own account.
    installFakeChrome();
    const target = await ExtensionVaultService.create();
    await target.unlock("another-passphrase-x");
    await target.addManual({ ...ACME, issuer: "Local", label: "two" });

    expect(await target.importBlob(blob, PASSPHRASE)).toBe(2);
    const ids = (await target.list()).map((a) => a.id);
    expect(ids).toContain(exported.id);
  });

  it("rejects an import with the wrong passphrase", async () => {
    const service = await unlocked();
    const blob = await service.exportBlob();
    await expect(service.importBlob(blob, "nope-nope-nope")).rejects.toThrow(/passphrase/i);
  });
});
