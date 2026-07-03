import { ClipboardPaste, Plus, ScanLine, Search, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { AccountRow } from "@/components/account-row";
import { TimerRing } from "@/components/timer-ring";
import { Button } from "@/components/ui/button";
import type { Account } from "@/core/types";
import { useVault } from "@/state/vault-provider";

const MAX_VISIBLE_ROWS = 5;
const ROW_HEIGHT = 64;

export function MenuBarView({
  onAdd,
  onEdit,
  onScan,
  onPaste,
  onQuit,
}: {
  onAdd: () => void;
  onEdit: (a: Account) => void;
  onScan?: () => void;
  onPaste?: () => Promise<boolean>;
  onQuit?: () => void;
}) {
  const { accounts, now, capabilities } = useVault();
  const [search, setSearch] = useState("");
  const [pasteFailed, setPasteFailed] = useState(false);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? accounts.filter(
        (a) => a.issuer.toLowerCase().includes(q) || a.label.toLowerCase().includes(q),
      )
    : accounts;

  async function handlePaste() {
    if (!onPaste) return;
    const ok = await onPaste();
    if (!ok) {
      setPasteFailed(true);
      window.setTimeout(() => setPasteFailed(false), 300);
    }
  }

  return (
    <div className="flex flex-col">
      {/* header */}
      <div className="flex items-center gap-2 px-3.5 py-[11px]">
        <TimerRing now={now} />
        <ShieldCheck className="size-4 text-primary" />
        <span className="text-[15px] font-semibold">2FAU</span>
        <div className="ml-auto flex items-center gap-4">
          {capabilities.scanScreen && onScan && (
            <Button size="icon-xs" variant="ghost" title="Scan QR from screen" onClick={onScan}>
              <ScanLine />
            </Button>
          )}
          {capabilities.paste && (
            <Button
              size="icon-xs"
              variant="ghost"
              title="Paste from clipboard"
              className={pasteFailed ? "text-destructive" : undefined}
              onClick={handlePaste}
            >
              <ClipboardPaste />
            </Button>
          )}
          <Button size="icon-xs" variant="ghost" title="Add account" onClick={onAdd}>
            <Plus />
          </Button>
        </div>
      </div>

      <div className="border-t" />

      {accounts.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {accounts.length > MAX_VISIBLE_ROWS && (
            <>
              <div className="mx-2.5 my-2 flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1.5">
                <Search className="size-3.5 text-muted-foreground" />
                <input
                  className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
                  placeholder="Search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")}>
                    <X className="size-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
              <div className="border-t" />
            </>
          )}

          {filtered.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">No matches</p>
          ) : (
            <div
              className="divide-y overflow-y-auto"
              style={{ maxHeight: MAX_VISIBLE_ROWS * ROW_HEIGHT }}
            >
              {filtered.map((a) => (
                <AccountRow key={a.id} account={a} onEdit={() => onEdit(a)} />
              ))}
            </div>
          )}
        </>
      )}

      <div className="border-t" />

      {/* footer */}
      <div className="flex items-center px-3.5 py-2">
        <span className="text-[11px] text-muted-foreground">
          {accounts.length === 1 ? "1 account" : `${accounts.length} accounts`}
        </span>
        {onQuit && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto text-muted-foreground"
            onClick={onQuit}
          >
            Quit
          </Button>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-1.5 py-9">
      <ShieldCheck className="size-8 text-muted-foreground" />
      <p className="text-[13px] text-muted-foreground">No accounts yet</p>
      <p className="text-[11px] text-tertiary-foreground">Tap + to add one</p>
    </div>
  );
}
