import { CheckCircle2, Pencil, RotateCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Account } from "@/core/types";
import { cn } from "@/lib/utils";
import { formatCode, primaryName, secondaryName } from "@/lib/format";
import { useVault } from "@/state/vault-provider";

/** Port of the Swift `RowView`: two-line account cell, tap-to-copy, hover
 * actions (HOTP refresh / edit / delete-with-confirm). */
export function AccountRow({ account, onEdit }: { account: Account; onEdit: () => void }) {
  const { codes, remove, advanceHotp } = useVault();
  const [copied, setCopied] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const raw = codes[account.id] ?? "";
  const secondary = secondaryName(account);

  async function copy() {
    if (!raw) return;
    try {
      await navigator.clipboard.writeText(raw);
    } catch {
      // clipboard may be unavailable; still flash feedback
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1000);
  }

  async function advance() {
    try {
      await advanceHotp(account.id);
    } catch (e) {
      setActionError(`Could not advance code: ${msg(e)}`);
    }
  }

  async function del() {
    try {
      await remove(account.id);
    } catch (e) {
      setActionError(`Could not delete account: ${msg(e)}`);
      setConfirmingDelete(false);
    }
  }

  return (
    <div
      className="flex cursor-default flex-col gap-1 px-2 py-2"
      onClick={copy}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className="flex h-12 items-center gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-baseline gap-1.5">
            <span className="truncate text-[13px] font-semibold">{primaryName(account)}</span>
            {secondary && (
              <span className="truncate text-[11px] text-muted-foreground">{secondary}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "font-mono text-2xl font-medium tabular-nums",
                copied && "text-success",
              )}
            >
              {formatCode(raw)}
            </span>
            {copied && <CheckCircle2 className="size-4 text-success" />}
          </div>
        </div>

        <div className="ml-auto" />

        {(hovering || confirmingDelete) && (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {confirmingDelete ? (
              <>
                <Button size="xs" variant="destructive" onClick={del}>
                  Delete
                </Button>
                <Button size="xs" variant="secondary" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                {account.otp_type === "Hotp" && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    title="Next code"
                    onClick={advance}
                  >
                    <RotateCw />
                  </Button>
                )}
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  title="Edit"
                  onClick={onEdit}
                >
                  <Pencil />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-destructive"
                  title="Delete"
                  onClick={() => setConfirmingDelete(true)}
                >
                  <Trash2 />
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {actionError && <p className="text-[10px] text-destructive">{actionError}</p>}
    </div>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
