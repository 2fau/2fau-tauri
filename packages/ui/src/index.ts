export { TwoFAUApp } from "@/app";
export { RootView } from "@/components/root-view";
export { MenuBarView } from "@/components/menu-bar-view";
export { AccountRow } from "@/components/account-row";
export { AddView } from "@/components/add-view";
export { EditView } from "@/components/edit-view";
export { UnlockView } from "@/components/unlock-view";
export { SetupView } from "@/components/setup-view";
export { TimerRing } from "@/components/timer-ring";

export { VaultProvider, useVault } from "@/state/vault-provider";
export { MockVaultService, type MockOptions } from "@/core/mock-vault-service";
export type {
  VaultService,
  Capabilities,
  AddManualFields,
} from "@/core/vault-service";
export type {
  Account,
  StoredAccount,
  Tombstone,
  VaultDocument,
  ParsedOtp,
  OtpType,
  OtpAlgorithm,
} from "@/core/types";

// Host apps need these to render account names and call the WASM OTP functions
// exactly the way the shared components do.
export { algorithmArg, formatCode, primaryName, secondaryName } from "@/lib/format";
