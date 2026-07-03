import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { Account } from "@/core/types";
import type { Capabilities, VaultService } from "@/core/vault-service";
import { VaultProvider } from "@/state/vault-provider";

/** A dependency-free VaultService for component tests (no WASM). */
export function fakeService(
  accounts: Account[],
  codes: Record<string, string> = {},
  caps?: Partial<Capabilities>,
): VaultService {
  let list = [...accounts];
  return {
    capabilities: () => ({ scanScreen: false, qrImage: true, paste: true, ...caps }),
    isLocked: () => false,
    unlock: async () => {},
    list: async () => list,
    addUri: async () => list[0] as Account,
    addManual: async () => list[0] as Account,
    update: async (a) => {
      list = list.map((x) => (x.id === a.id ? a : x));
    },
    remove: async (id) => {
      list = list.filter((x) => x.id !== id);
    },
    code: async (a) => codes[a.id] ?? "000000",
    advanceHotp: async () => {},
  };
}

export function renderWithVault(ui: ReactElement, service: VaultService) {
  return render(<VaultProvider service={service}>{ui}</VaultProvider>);
}

export function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "a",
    issuer: "Google",
    label: "alice@gmail",
    otp_type: "Totp",
    algorithm: "Sha1",
    digits: 6,
    period: 30,
    counter: 0,
    ...overrides,
  };
}
