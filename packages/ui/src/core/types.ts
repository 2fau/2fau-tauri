// The UI's domain types come straight from the Rust core's ts-rs bindings, so
// they can never drift from the crate.
export type {
  Account,
  StoredAccount,
  Tombstone,
  VaultDocument,
  ParsedOtp,
  OtpType,
  OtpAlgorithm,
} from "@twofau/core-wasm";
