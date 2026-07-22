import type { VaultService } from "@twofau/ui";
import { TwoFAUApp } from "@twofau/ui";
import ReactDOM from "react-dom/client";
import { createVaultService } from "../vault/backend";
import { initWasm } from "../wasm";
import "../index.css";

function Failed({ message }: { message: string }) {
  return <p className="p-4 text-[13px] text-destructive">Could not start: {message}</p>;
}

async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
  let service: VaultService;
  try {
    // WASM first: building the service already needs it to read the vault.
    await initWasm();
    service = await createVaultService();
  } catch (err) {
    // A blank list would read as an empty vault, which is a lie. Say what broke.
    root.render(<Failed message={err instanceof Error ? err.message : String(err)} />);
    return;
  }
  root.render(<TwoFAUApp service={service} />);
}

void bootstrap();
