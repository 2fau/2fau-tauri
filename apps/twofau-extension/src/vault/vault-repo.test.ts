import { beforeEach, describe, expect, it } from "vitest";
import { type FakeChrome, installFakeChrome } from "../test/fake-chrome";
import { bytesToB64 } from "./base64";
import { VaultQuotaError, VaultRepo } from "./vault-repo";

const SALT = "AAAAAAAAAAAAAAAAAAAAAA==";
const KDF_ID = 1;
const SYNC_QUOTA_BYTES_PER_ITEM = 8_192;

let fake: FakeChrome;
let repo: VaultRepo;

function blobOf(size: number, fill: number): Uint8Array {
  return new Uint8Array(size).fill(fill);
}

beforeEach(() => {
  fake = installFakeChrome();
  repo = new VaultRepo();
});

describe("VaultRepo", () => {
  it("reports no vault before the first save", async () => {
    expect(await repo.hasVault()).toBe(false);
    expect(await repo.load()).toBeNull();
  });

  it("round-trips a blob larger than one chunk", async () => {
    const blob = blobOf(20_000, 7);
    const saved = await repo.save(blob, SALT, KDF_ID, 0);
    expect(saved.ok).toBe(true);

    const loaded = await repo.load();
    expect(loaded?.blob).toEqual(blob);
    expect(loaded?.manifest).toMatchObject({ revision: 1, salt: SALT, kdfId: KDF_ID });
    expect(loaded?.manifest.chunks).toBeGreaterThan(1);
  });

  it("bumps the revision and deletes the previous generation", async () => {
    await repo.save(blobOf(9_000, 1), SALT, KDF_ID, 0);
    const second = await repo.save(blobOf(300, 2), SALT, KDF_ID, 1);
    expect(second.ok && second.manifest.revision).toBe(2);

    const leftovers = Object.keys(fake.sync.data).filter((k) => k.startsWith("v1.chunk."));
    expect(leftovers).toEqual([]);
  });

  it("reports a conflict when the stored revision moved on", async () => {
    const remote = blobOf(100, 9);
    await repo.save(remote, SALT, KDF_ID, 0); // another browser got there first

    const result = await repo.save(blobOf(100, 3), SALT, KDF_ID, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.conflict.blob).toEqual(remote);
      expect(result.conflict.manifest.revision).toBe(1);
    }
  });

  it("falls back to the local mirror when a chunk is missing", async () => {
    const blob = blobOf(20_000, 5);
    await repo.save(blob, SALT, KDF_ID, 0);
    await repo.load(); // populates the mirror

    delete fake.sync.data["v1.chunk.1"]; // a torn remote write

    const loaded = await repo.load();
    expect(loaded?.blob).toEqual(blob);
  });

  it("rejects a write that exceeds the sync quota", async () => {
    await expect(repo.save(blobOf(200_000, 1), SALT, KDF_ID, 0)).rejects.toBeInstanceOf(
      VaultQuotaError,
    );
    expect(await repo.hasVault()).toBe(false);
  });

  it("stores nothing recognisable as the raw blob in a single item", async () => {
    const blob = blobOf(20_000, 4);
    await repo.save(blob, SALT, KDF_ID, 0);
    expect(Object.values(fake.sync.data)).not.toContain(bytesToB64(blob));
  });

  it("keeps every stored item under the per-item sync limit", async () => {
    await repo.save(blobOf(30_000, 6), SALT, KDF_ID, 0);
    for (const [key, value] of Object.entries(fake.sync.data)) {
      expect(key.length + JSON.stringify(value).length).toBeLessThanOrEqual(
        SYNC_QUOTA_BYTES_PER_ITEM,
      );
    }
  });

  // Both generations are briefly resident, so a vault that fits on its own can
  // still blow the total budget mid-write. The half-written generation must not
  // survive, or every retry starts with less room than the last.
  it("leaves nothing behind when the write blows the quota mid-flight", async () => {
    await repo.save(blobOf(40_000, 1), SALT, KDF_ID, 0);
    const before = Object.keys(fake.sync.data).sort();

    await expect(repo.save(blobOf(40_000, 2), SALT, KDF_ID, 1)).rejects.toBeInstanceOf(
      VaultQuotaError,
    );

    expect(Object.keys(fake.sync.data).sort()).toEqual(before);
    expect((await repo.load())?.blob).toEqual(blobOf(40_000, 1));
  });

  // A worker killed between the chunk write and the manifest write leaves an
  // uncommitted generation that no cleanup path ever ran for.
  it("sweeps chunks left by a generation that never committed", async () => {
    await repo.save(blobOf(300, 1), SALT, KDF_ID, 0);
    fake.sync.data["v9.chunk.0"] = "orphaned";

    await repo.save(blobOf(300, 2), SALT, KDF_ID, 1);

    expect(Object.keys(fake.sync.data)).not.toContain("v9.chunk.0");
  });
});
