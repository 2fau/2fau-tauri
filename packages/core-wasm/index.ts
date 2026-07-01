// App-facing, typed wrapper over the wasm-pack (`--target web`) output. The raw
// module exposes a default `init()` that must resolve before any call; this
// wrapper awaits it once. The ts-rs `bindings/` types are layered over the loose
// `JsValue` returns so consumers get real types, not `any`.
//
// `import type` keeps the binding imports erasable, so this module runs even
// before `cargo test` has regenerated `bindings/` (types are checked separately).

import init, {
  totp as _totp,
  hotp as _hotp,
  base32_decode as _base32Decode,
  parse_otpauth as _parseOtpauth,
  merge as _merge,
  seal_vault as _sealVault,
  open_vault as _openVault,
  new_id as _newId,
  now_ms as _nowMs,
} from "./pkg/twofau_wasm.js";

import type { ParsedOtp } from "./bindings/ParsedOtp";
import type { VaultDocument } from "./bindings/VaultDocument";

export type { Account } from "./bindings/Account";
export type { StoredAccount } from "./bindings/StoredAccount";
export type { Tombstone } from "./bindings/Tombstone";
export type { OtpType } from "./bindings/OtpType";
export type { OtpAlgorithm } from "./bindings/OtpAlgorithm";
export type { ParsedOtp, VaultDocument };

export type Algorithm = "SHA1" | "SHA256" | "SHA512";

let ready: Promise<unknown> | null = null;

/** Initialize the wasm module once. Pass bytes/URL in non-browser hosts. */
export function ensureReady(input?: Parameters<typeof init>[0]): Promise<unknown> {
  return (ready ??= init(input));
}

export async function totp(
  secretB64: string,
  unixTime: bigint,
  period: number,
  digits: number,
  algo: Algorithm,
): Promise<string> {
  await ensureReady();
  return _totp(secretB64, unixTime, period, digits, algo);
}

export async function hotp(
  secretB64: string,
  counter: bigint,
  digits: number,
  algo: Algorithm,
): Promise<string> {
  await ensureReady();
  return _hotp(secretB64, counter, digits, algo);
}

export async function base32Decode(secret: string): Promise<string> {
  await ensureReady();
  return _base32Decode(secret);
}

export async function parseOtpauth(uri: string): Promise<ParsedOtp> {
  await ensureReady();
  return _parseOtpauth(uri) as ParsedOtp;
}

export async function merge(local: VaultDocument, remote: VaultDocument): Promise<VaultDocument> {
  await ensureReady();
  return _merge(local, remote) as VaultDocument;
}

export async function sealVault(doc: VaultDocument, passphrase: string): Promise<Uint8Array> {
  await ensureReady();
  return _sealVault(doc, passphrase);
}

export async function openVault(blob: Uint8Array, passphrase: string): Promise<VaultDocument> {
  await ensureReady();
  return _openVault(blob, passphrase) as VaultDocument;
}

export async function newId(): Promise<string> {
  await ensureReady();
  return _newId();
}

export async function nowMs(): Promise<number> {
  await ensureReady();
  return _nowMs();
}
