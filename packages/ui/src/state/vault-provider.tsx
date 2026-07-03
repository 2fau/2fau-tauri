import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Account } from "@/core/types";
import type { AddManualFields, Capabilities, VaultService } from "@/core/vault-service";
import { useNow } from "@/hooks/use-now";

interface VaultContextValue {
  service: VaultService;
  capabilities: Capabilities;
  locked: boolean;
  accounts: Account[];
  /** Current code per account id, recomputed every second. */
  codes: Record<string, string>;
  now: number;
  unlock: (passphrase: string) => Promise<void>;
  addUri: (uri: string) => Promise<Account>;
  addManual: (fields: AddManualFields) => Promise<Account>;
  update: (account: Account) => Promise<void>;
  remove: (id: string) => Promise<void>;
  advanceHotp: (id: string) => Promise<void>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function VaultProvider({
  service,
  children,
}: {
  service: VaultService;
  children: ReactNode;
}) {
  const now = useNow();
  const [locked, setLocked] = useState(() => service.isLocked());
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setAccounts(await service.list());
  }, [service]);

  useEffect(() => {
    if (!locked) void refresh();
  }, [locked, refresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const pairs = await Promise.all(
        accounts.map(async (a) => [a.id, await service.code(a, now)] as const),
      );
      if (!cancelled) setCodes(Object.fromEntries(pairs));
    })();
    return () => {
      cancelled = true;
    };
  }, [accounts, now, service]);

  const value: VaultContextValue = {
    service,
    capabilities: service.capabilities(),
    locked,
    accounts,
    codes,
    now,
    unlock: async (passphrase) => {
      await service.unlock(passphrase);
      setLocked(false);
      await refresh();
    },
    addUri: async (uri) => {
      const a = await service.addUri(uri);
      await refresh();
      return a;
    },
    addManual: async (fields) => {
      const a = await service.addManual(fields);
      await refresh();
      return a;
    },
    update: async (account) => {
      await service.update(account);
      await refresh();
    },
    remove: async (id) => {
      await service.remove(id);
      await refresh();
    },
    advanceHotp: async (id) => {
      await service.advanceHotp(id);
      await refresh();
    },
  };

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used within a VaultProvider");
  return ctx;
}
