import { beforeEach, describe, expect, it } from "vitest";
import { type FakeChrome, installFakeChrome } from "../test/fake-chrome";
import { syncUsage } from "./usage";
import { QUOTA_BYTES } from "./vault-repo";

let fake: FakeChrome;

beforeEach(() => {
  fake = installFakeChrome();
});

describe("syncUsage", () => {
  it("is zero for an empty area", async () => {
    expect(await syncUsage()).toEqual({ bytes: 0, quota: QUOTA_BYTES, percent: 0 });
  });

  it("counts key names and JSON-encoded values", async () => {
    await fake.sync.set({ ab: "cd" }); // 2 + 4 ("cd" with quotes) = 6
    const usage = await syncUsage();
    expect(usage.bytes).toBe(6);
    expect(usage.percent).toBeCloseTo((6 / QUOTA_BYTES) * 100, 5);
  });
});
