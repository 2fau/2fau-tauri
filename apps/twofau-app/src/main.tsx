import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { TwoFAUApp } from "@twofau/ui";
import { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import { TauriVaultService } from "./tauri-vault-service";
import "./index.css";

function Root({ startUnlocked, needsSetup }: { startUnlocked: boolean; needsSetup: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const service = useRef(new TauriVaultService(startUnlocked, needsSetup)).current;

  // Keep the OS window's height matched to the panel content (like the Swift
  // resizePanelToFit) so the popup never has dead space or clips.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const win = getCurrentWindow();
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(el.getBoundingClientRect().height);
      if (height > 0) void win.setSize(new LogicalSize(320, height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-[320px] overflow-hidden rounded-xl border bg-background shadow-2xl"
    >
      <TwoFAUApp service={service} onQuit={() => void invoke("quit")} />
    </div>
  );
}

async function bootstrap() {
  let startUnlocked = false;
  let needsSetup = false;
  try {
    startUnlocked = await invoke<boolean>("try_auto_unlock");
    if (!startUnlocked) {
      // First run (no vault file) → show the setup screen, not unlock.
      needsSetup = !(await invoke<boolean>("has_vault"));
    }
  } catch {
    // stay locked; the unlock screen will handle it
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <Root startUnlocked={startUnlocked} needsSetup={needsSetup} />,
  );
}

void bootstrap();
