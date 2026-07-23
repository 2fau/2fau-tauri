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

      <section className="flex flex-col gap-1.5" id="vault">
        <span className="text-[13px] font-medium">Vault</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled title="Added in the next task">
            Change passphrase
          </Button>
        </div>
      </section>
    </div>
  );
}
