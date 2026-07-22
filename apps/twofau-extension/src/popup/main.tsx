import { MockVaultService, TwoFAUApp } from "@twofau/ui";
import ReactDOM from "react-dom/client";
import { initWasm } from "../wasm";
import "../index.css";

async function bootstrap() {
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
  try {
    await initWasm();
  } catch (err) {
    // A blank list would look like an empty vault; say what actually happened.
    root.render(
      <p className="p-4 text-[13px] text-destructive">
        Could not start: {err instanceof Error ? err.message : String(err)}
      </p>,
    );
    return;
  }
  // Task 6 replaces this with the real storage-backed service.
  root.render(<TwoFAUApp service={new MockVaultService({ startUnlocked: true })} />);
}

void bootstrap();
