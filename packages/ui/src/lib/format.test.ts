import { describe, expect, it } from "vitest";
import { algorithmArg, formatCode, primaryName, secondaryName } from "./format";

describe("format", () => {
  it("splits codes down the middle", () => {
    expect(formatCode("492810")).toBe("492 810");
    expect(formatCode("49287082")).toBe("4928 7082");
  });

  it("prefers label as primary, issuer as dimmed secondary", () => {
    expect(primaryName({ issuer: "Acme", label: "me" })).toBe("me");
    expect(secondaryName({ issuer: "Acme", label: "me" })).toBe("Acme");
  });

  it("falls back to issuer when there is no label", () => {
    expect(primaryName({ issuer: "Acme", label: "" })).toBe("Acme");
    expect(secondaryName({ issuer: "Acme", label: "" })).toBe("");
  });

  it("maps the algorithm enum to the wasm string", () => {
    expect(algorithmArg("Sha1")).toBe("SHA1");
    expect(algorithmArg("Sha256")).toBe("SHA256");
    expect(algorithmArg("Sha512")).toBe("SHA512");
  });
});
