import { RootView } from "@/components/root-view";
import type { VaultService } from "@/core/vault-service";
import { VaultProvider } from "@/state/vault-provider";

/** Top-level entry: wraps the panel in a VaultProvider bound to a host's
 * `VaultService`. Host-specific actions (screen scan, clipboard, quit) are
 * injected as props. */
export function TwoFAUApp({
  service,
  onScan,
  onPaste,
  onQuit,
}: {
  service: VaultService;
  onScan?: () => void;
  onPaste?: () => Promise<boolean>;
  onQuit?: () => void;
}) {
  return (
    <VaultProvider service={service}>
      <RootView onScan={onScan} onPaste={onPaste} onQuit={onQuit} />
    </VaultProvider>
  );
}
