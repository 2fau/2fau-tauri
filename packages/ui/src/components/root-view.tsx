import { useState } from "react";
import { AddView } from "@/components/add-view";
import { EditView } from "@/components/edit-view";
import { MenuBarView } from "@/components/menu-bar-view";
import { UnlockView } from "@/components/unlock-view";
import type { Account } from "@/core/types";
import { useVault } from "@/state/vault-provider";

type Screen = { name: "list" } | { name: "add" } | { name: "edit"; account: Account };

/** Port of the Swift `RootView`: inline list/add/edit navigation within a fixed
 * 320px panel (no modals). Gated by the unlock screen when locked. */
export function RootView({
  onScan,
  onQuit,
}: {
  onScan?: () => void;
  onQuit?: () => void;
}) {
  const { locked } = useVault();
  const [screen, setScreen] = useState<Screen>({ name: "list" });

  return (
    <div className="w-[320px] bg-background text-foreground">
      {locked ? (
        <UnlockView />
      ) : screen.name === "add" ? (
        <AddView onDone={() => setScreen({ name: "list" })} />
      ) : screen.name === "edit" ? (
        <EditView account={screen.account} onDone={() => setScreen({ name: "list" })} />
      ) : (
        <MenuBarView
          onAdd={() => setScreen({ name: "add" })}
          onEdit={(account) => setScreen({ name: "edit", account })}
          onScan={onScan}
          onQuit={onQuit}
        />
      )}
    </div>
  );
}
