// @vitest-environment node
// Proves the key-based vault API works across the JS boundary and stays
// format-compatible with the passphrase API the desktop app uses.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deriveKey,
  ensureReady,
  newSalt,
  openVault,
  openWithKey,
  sealVault,
  sealWithKey,
  vaultSalt,
  type VaultDocument,
} from "./index";

const DOC: VaultDocument = {
  entries: [
    {
      account: {
        id: "11111111-1111-4111-8111-111111111111",
        issuer: "Acme",
        label: "me",
        otp_type: "Totp",
        algorithm: "Sha1",
        digits: 6,
        period: 30,
        counter: 0,
      },
      secret: "SGVsbG8h",
      modified_at: 42,
    },
  ],
  tombstones: [],
};

beforeAll(async () => {
  await ensureReady(readFileSync(new URL("./pkg/twofau_wasm_bg.wasm", import.meta.url)));
});

describe("key-based vault API", () => {
  it("round-trips through a derived key", async () => {
    const salt = await newSalt();
    const key = await deriveKey("hunter2hunter2", salt);
    const blob = await sealWithKey(DOC, key, salt);
    expect(await openWithKey(blob, key)).toEqual(DOC);
  });

  it("rejects a key derived from the wrong passphrase", async () => {
    const salt = await newSalt();
    const blob = await sealWithKey(DOC, await deriveKey("right-passphrase", salt), salt);
    const wrong = await deriveKey("wrong-passphrase", salt);
    await expect(openWithKey(blob, wrong)).rejects.toThrow();
  });

  it("is format-compatible with the passphrase API", async () => {
    // A blob the desktop app could have written...
    const blob = await sealVault(DOC, "shared-passphrase");
    // ...opens with a key derived from the salt in its own header.
    const key = await deriveKey("shared-passphrase", await vaultSalt(blob));
    expect(await openWithKey(blob, key)).toEqual(DOC);

    // ...and the reverse: a key-sealed blob opens by passphrase.
    const salt = await newSalt();
    const keyed = await sealWithKey(DOC, await deriveKey("shared-passphrase", salt), salt);
    expect(await openVault(keyed, "shared-passphrase")).toEqual(DOC);
  });
});
