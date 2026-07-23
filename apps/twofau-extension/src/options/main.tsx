import ReactDOM from "react-dom/client";
import { initWasm } from "../wasm";
import { OptionsView } from "./options-view";
import "../index.css";

async function bootstrap() {
  await initWasm();
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<OptionsView />);
}

void bootstrap();
