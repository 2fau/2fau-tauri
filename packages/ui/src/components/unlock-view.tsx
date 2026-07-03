import { ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useVault } from "@/state/vault-provider";

/** Net-new screen (no Swift equivalent): passphrase unlock, since the
 * cross-platform root of trust is a passphrase, not the Secure Enclave. */
export function UnlockView() {
  const { unlock } = useVault();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await unlock(passphrase);
    } catch (err) {
      setError(`Could not unlock: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col items-center gap-3 px-6 py-10" onSubmit={submit}>
      <ShieldCheck className="size-9 text-primary" />
      <p className="text-[15px] font-semibold">Unlock 2FAU</p>
      <Input
        type="password"
        autoFocus
        placeholder="Passphrase"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
      />
      {error && <p className="text-[11px] text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy || passphrase.length === 0}>
        Unlock
      </Button>
    </form>
  );
}
