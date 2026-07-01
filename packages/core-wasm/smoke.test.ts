// Interop gate: proves the native → WASM dual build and the serde-wasm-bindgen
// boundary work end-to-end. Uses the raw pkg module and inits from the built
// .wasm bytes (the `--target web` init needs bytes/URL outside a browser).

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import init, { merge, totp } from "./pkg/twofau_wasm.js";

beforeAll(async () => {
  const wasm = readFileSync(new URL("./pkg/twofau_wasm_bg.wasm", import.meta.url));
  await init({ module_or_path: wasm });
});

describe("wasm interop", () => {
  it("computes a known TOTP vector (RFC 6238, SHA1, T=59, 8 digits)", () => {
    const secretB64 = Buffer.from("12345678901234567890", "ascii").toString("base64");
    expect(totp(secretB64, 59n, 30, 8, "SHA1")).toBe("94287082");
  });

  it("round-trips a VaultDocument through merge (newest wins)", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const entry = (modified_at: number) => ({
      account: {
        id,
        issuer: "Acme",
        label: "me",
        otp_type: "Totp",
        algorithm: "Sha1",
        digits: 6,
        period: 30,
        counter: 0,
      },
      secret: "", // base64 of empty bytes
      modified_at,
    });
    const out = merge({ entries: [entry(1)], tombstones: [] }, { entries: [entry(2)], tombstones: [] });
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].modified_at).toBe(2);
  });
});
