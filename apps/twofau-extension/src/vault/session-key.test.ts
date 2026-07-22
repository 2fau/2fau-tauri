import { beforeEach, describe, expect, it } from "vitest";
import { type FakeChrome, installFakeChrome } from "../test/fake-chrome";
import {
  AUTO_LOCK_ALARM,
  clearSessionKey,
  DEFAULT_AUTO_LOCK_MINUTES,
  getSessionKey,
  setSessionKey,
  touchSessionKey,
} from "./session-key";
import { readSettings, writeSettings } from "./settings";

let fake: FakeChrome;

beforeEach(() => {
  fake = installFakeChrome();
});

describe("session key", () => {
  it("starts absent", async () => {
    expect(await getSessionKey()).toBeNull();
  });

  it("stores the key in session storage and arms the auto-lock alarm", async () => {
    await setSessionKey("a2V5");
    expect(await getSessionKey()).toBe("a2V5");
    expect(fake.session.data["vault.key"]).toBe("a2V5");
    expect(fake.local.data["vault.key"]).toBeUndefined();
    expect(fake.alarms.created[AUTO_LOCK_ALARM]).toBe(DEFAULT_AUTO_LOCK_MINUTES);
  });

  it("clears the key and the alarm on lock", async () => {
    await setSessionKey("a2V5");
    await clearSessionKey();
    expect(await getSessionKey()).toBeNull();
    expect(fake.alarms.created[AUTO_LOCK_ALARM]).toBeUndefined();
  });

  it("re-arms the alarm on activity, but only while unlocked", async () => {
    await touchSessionKey();
    expect(fake.alarms.created[AUTO_LOCK_ALARM]).toBeUndefined();

    await setSessionKey("a2V5");
    await writeSettings({ autoLockMinutes: 5 });
    await touchSessionKey();
    expect(fake.alarms.created[AUTO_LOCK_ALARM]).toBe(5);
  });

  // Zero means "never lock", so it must leave the alarm disarmed. Passing it
  // straight to chrome.alarms would instead lock all but immediately.
  it("arms nothing when auto-lock is switched off", async () => {
    await writeSettings({ autoLockMinutes: 0 });
    await setSessionKey("a2V5");
    expect(fake.alarms.created[AUTO_LOCK_ALARM]).toBeUndefined();
    expect(await getSessionKey()).toBe("a2V5");
  });
});

describe("settings", () => {
  it("defaults, then persists a patch", async () => {
    expect(await readSettings()).toEqual({
      autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
      storageArea: "sync",
    });
    expect(await writeSettings({ storageArea: "local" })).toEqual({
      autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
      storageArea: "local",
    });
    expect((await readSettings()).storageArea).toBe("local");
  });

  // A junk value reaching chrome.alarms.create as NaN throws, which would leave
  // the vault unlocked with no lock deadline at all.
  it("falls back to the defaults when stored values are unusable", async () => {
    fake.local.data.settings = { autoLockMinutes: "soon", storageArea: "elsewhere" };
    expect(await readSettings()).toEqual({
      autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
      storageArea: "sync",
    });
  });
});
