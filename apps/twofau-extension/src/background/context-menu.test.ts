import { beforeEach, describe, expect, it } from "vitest";
import { type FakeChrome, installFakeChrome } from "../test/fake-chrome";
import { ExtensionVaultService } from "../vault/extension-vault-service";
import { recordUse } from "../vault/recent";
import { clearSessionKey } from "../vault/session-key";
import { accountIdFromMenuItem, MENU_CODE_PREFIX, refreshContextMenu } from "./context-menu";

const PASSPHRASE = "correct-horse-battery";
let fake: FakeChrome;

async function seed(count: number) {
  const service = await ExtensionVaultService.create();
  await service.unlock(PASSPHRASE);
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const account = await service.addManual({
      issuer: `Issuer${i}`,
      label: `label${i}`,
      secretBase32: "JBSWY3DPEHPK3PXP",
      type: "totp",
    });
    ids.push(account.id);
  }
  return ids;
}

beforeEach(() => {
  fake = installFakeChrome();
});

describe("context menu", () => {
  it("shows a single disabled item while locked", async () => {
    await seed(1);
    await clearSessionKey();

    await refreshContextMenu();
    const children = fake.contextMenus.items.filter((i) => i.parentId);
    expect(children).toHaveLength(1);
    expect(children[0].enabled).toBe(false);
    expect(children[0].title).toMatch(/locked/i);
  });

  it("lists at most five accounts, most recently used first", async () => {
    const ids = await seed(7);
    await recordUse(ids[6]);
    await recordUse(ids[3]);

    await refreshContextMenu();
    const children = fake.contextMenus.items.filter((i) => i.parentId);
    expect(children).toHaveLength(5);
    expect(accountIdFromMenuItem(children[0].id)).toBe(ids[3]);
    expect(accountIdFromMenuItem(children[1].id)).toBe(ids[6]);
  });

  it("titles items by account name and never by code", async () => {
    await seed(1);
    await refreshContextMenu();
    const child = fake.contextMenus.items.find((i) => i.id.startsWith(MENU_CODE_PREFIX));
    expect(child?.title).toBe("label0 — Issuer0");
    expect(child?.title).not.toMatch(/\d{6}/);
  });

  it("rebuilds from scratch each time", async () => {
    await seed(2);
    await refreshContextMenu();
    await refreshContextMenu();
    expect(fake.contextMenus.items.filter((i) => !i.parentId)).toHaveLength(1);
  });
});

describe("accountIdFromMenuItem", () => {
  it("ignores menu items that aren't account codes", () => {
    expect(accountIdFromMenuItem("2fau.locked")).toBeNull();
    expect(accountIdFromMenuItem(`${MENU_CODE_PREFIX}abc`)).toBe("abc");
  });
});
