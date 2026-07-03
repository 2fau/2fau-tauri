import { ChevronLeft } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { decodeQrImage } from "@/lib/qr";
import { useVault } from "@/state/vault-provider";

/** Port of the Swift `AddView`: import row + manual fields + TOTP/HOTP toggle. */
export function AddView({ onDone }: { onDone: () => void }) {
  const { addUri, addManual, capabilities } = useVault();
  const [issuer, setIssuer] = useState("");
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [type, setType] = useState<"totp" | "hotp">("totp");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function ingest(uri: string) {
    try {
      await addUri(uri);
      onDone();
    } catch (e) {
      setError(`Could not import: ${msg(e)}`);
    }
  }

  async function importFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text.startsWith("otpauth://")) {
        await ingest(text);
        return;
      }
      setError("No otpauth URI on clipboard");
    } catch {
      setError("Could not read clipboard");
    }
  }

  async function importFromFile(file: File) {
    const uri = await decodeQrImage(file);
    if (!uri) {
      setError("No QR code found");
      return;
    }
    await ingest(uri);
  }

  async function saveManual() {
    try {
      await addManual({ issuer, label, secretBase32: secret, type });
      onDone();
    } catch (e) {
      setError(`Invalid Base32 secret: ${msg(e)}`);
    }
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" onClick={onDone}>
          <ChevronLeft />
        </Button>
        <span className="text-[15px] font-semibold">Add account</span>
      </div>

      <div className="border-t" />

      <div className="flex gap-2">
        {capabilities.paste && (
          <Button variant="secondary" size="sm" onClick={importFromClipboard}>
            Paste otpauth:// or QR
          </Button>
        )}
        {capabilities.qrImage && (
          <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
            QR image file…
          </Button>
        )}
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFromFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <Input placeholder="Issuer (e.g. GitHub)" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
      <Input placeholder="Label (e.g. me@x.com)" value={label} onChange={(e) => setLabel(e.target.value)} />
      <Input placeholder="Secret (Base32)" value={secret} onChange={(e) => setSecret(e.target.value)} />

      <ToggleGroup
        type="single"
        value={type}
        onValueChange={(v) => v && setType(v as "totp" | "hotp")}
        className="w-full"
      >
        <ToggleGroupItem value="totp" className="flex-1">
          TOTP
        </ToggleGroupItem>
        <ToggleGroupItem value="hotp" className="flex-1">
          HOTP
        </ToggleGroupItem>
      </ToggleGroup>

      {error && <p className="text-[11px] text-destructive">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={saveManual}>
          Save
        </Button>
      </div>
    </div>
  );
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
