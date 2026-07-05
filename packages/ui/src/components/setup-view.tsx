import { ShieldPlus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useVault } from "@/state/vault-provider";

const MIN_LENGTH = 8;

/** First-run screen: create the passphrase that encrypts the vault on this
 * device. Distinct from UnlockView, which enters an existing passphrase. */
export function SetupView() {
  const { unlock } = useVault();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = passphrase.length > 0 && passphrase.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== passphrase;
  const valid = passphrase.length >= MIN_LENGTH && confirm === passphrase;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await unlock(passphrase);
    } catch (err) {
      setError(`Could not create vault: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col items-center gap-3 px-6 py-8" onSubmit={submit}>
      <ShieldPlus className="size-9 text-primary" />
      <p className="text-[15px] font-semibold">Create a passphrase</p>
      <p className="text-center text-[11px] text-muted-foreground">
        It encrypts your accounts on this device and can’t be recovered — don’t forget it.
      </p>

      <Input
        type="password"
        autoFocus
        placeholder="Passphrase"
        value={passphrase}
        aria-invalid={tooShort}
        onChange={(e) => setPassphrase(e.target.value)}
      />
      <Input
        type="password"
        placeholder="Confirm passphrase"
        value={confirm}
        aria-invalid={mismatch}
        onChange={(e) => setConfirm(e.target.value)}
      />

      {tooShort && (
        <p className="text-[11px] text-muted-foreground">
          Use at least {MIN_LENGTH} characters.
        </p>
      )}
      {mismatch && <p className="text-[11px] text-destructive">Passphrases don’t match.</p>}
      {error && <p className="text-[11px] text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={busy || !valid}>
        Create vault
      </Button>
    </form>
  );
}
