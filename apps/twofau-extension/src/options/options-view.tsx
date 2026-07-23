import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { readSettings, type Settings, writeSettings } from "../vault/settings";
import { syncUsage, type SyncUsage } from "../vault/usage";

export function OptionsView() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [usage, setUsage] = useState<SyncUsage | null>(null);

  useEffect(() => {
    void (async () => {
      setSettings(await readSettings());
      setUsage(await syncUsage());
    })();
  }, []);

  if (!settings) return <p className="p-6 text-[13px]">Loading…</p>;

  async function patch(next: Partial<Settings>) {
    setSettings(await writeSettings(next));
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 p-6">
      <h1 className="text-[17px] font-semibold">2FAU settings</h1>

      <section className="flex flex-col gap-1.5">
        <label className="text-[13px] font-medium" htmlFor="auto-lock">
          Auto-lock after
        </label>
        <Input
          id="auto-lock"
          type="number"
          min={1}
          max={480}
          value={settings.autoLockMinutes}
          onChange={(e) => void patch({ autoLockMinutes: Number(e.target.value) || 1 })}
        />
        <p className="text-[11px] text-muted-foreground">
          Minutes of inactivity before the passphrase is required again.
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Storage</span>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={settings.storageArea === "sync"}
            onChange={(e) => void patch({ storageArea: e.target.checked ? "sync" : "local" })}
          />
          Sync the encrypted vault across my Chrome profile
        </label>
        {usage && (
          <p className="text-[11px] text-muted-foreground">
            Using {(usage.bytes / 1024).toFixed(1)} KB of {(usage.quota / 1024).toFixed(0)} KB (
            {usage.percent.toFixed(0)}%).
          </p>
        )}
      </section>

      <VaultSection />
    </div>
  );
}

function VaultSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function service() {
    const { ExtensionVaultService } = await import("../vault/extension-vault-service");
    return ExtensionVaultService.create();
  }

  async function run(work: () => Promise<string>) {
    setError(null);
    setStatus(null);
    try {
      setStatus(await work());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <span className="text-[13px] font-medium">Vault</span>

      <div className="flex flex-col gap-1.5">
        <Input
          type="password"
          placeholder="Current passphrase"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Input
          type="password"
          placeholder="New passphrase"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Button
          size="sm"
          disabled={current.length === 0 || next.length < 8}
          onClick={() =>
            void run(async () => {
              await (await service()).changePassphrase(current, next);
              setCurrent("");
              setNext("");
              return "Passphrase changed.";
            })
          }
        >
          Change passphrase
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void run(async () => {
              const { downloadBlob } = await import("../vault/transfer");
              downloadBlob(await (await service()).exportBlob(), "2fau-vault.dat");
              return "Exported. The file is encrypted with your passphrase.";
            })
          }
        >
          Export encrypted vault
        </Button>

        <Input
          type="password"
          placeholder="Passphrase of the file to import"
          value={importPassphrase}
          onChange={(e) => setImportPassphrase(e.target.value)}
        />
        <input
          type="file"
          accept=".dat,application/octet-stream"
          className="text-[12px]"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            void run(async () => {
              const { readFileBytes } = await import("../vault/transfer");
              const count = await (await service()).importBlob(
                await readFileBytes(file),
                importPassphrase,
              );
              return `Imported. The vault now holds ${count} account${count === 1 ? "" : "s"}.`;
            });
          }}
        />
      </div>

      {status && <p className="text-[11px] text-muted-foreground">{status}</p>}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </section>
  );
}
