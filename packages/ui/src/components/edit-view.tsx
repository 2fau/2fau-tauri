import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Account } from "@/core/types";
import { useVault } from "@/state/vault-provider";

/** Port of the Swift `EditView`: edit issuer/label of an existing account. */
export function EditView({ account, onDone }: { account: Account; onDone: () => void }) {
  const { update } = useVault();
  const [issuer, setIssuer] = useState(account.issuer);
  const [label, setLabel] = useState(account.label);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    try {
      await update({ ...account, issuer, label });
      onDone();
    } catch (e) {
      setError(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" onClick={onDone}>
          <ChevronLeft />
        </Button>
        <span className="text-[15px] font-semibold">Edit account</span>
      </div>

      <div className="border-t" />

      <Input placeholder="Issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
      <Input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
