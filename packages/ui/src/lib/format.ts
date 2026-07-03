import type { OtpAlgorithm } from "@/core/types";

/** Split a code down the middle with a space: "492810" -> "492 810". */
export function formatCode(code: string): string {
  const mid = Math.floor(code.length / 2);
  return `${code.slice(0, mid)} ${code.slice(mid)}`;
}

/** The row's primary name (label preferred), matching the Swift RowView. */
export function primaryName(a: { issuer: string; label: string }): string {
  return a.label.length === 0 ? a.issuer : a.label;
}

/** The dimmed secondary name (issuer, only when a label exists). */
export function secondaryName(a: { issuer: string; label: string }): string {
  return a.label.length === 0 ? "" : a.issuer;
}

/** Map the core's algorithm enum to the wasm function's string argument. */
export function algorithmArg(algo: OtpAlgorithm): "SHA1" | "SHA256" | "SHA512" {
  switch (algo) {
    case "Sha256":
      return "SHA256";
    case "Sha512":
      return "SHA512";
    default:
      return "SHA1";
  }
}
