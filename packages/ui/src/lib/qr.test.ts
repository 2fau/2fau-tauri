import { describe, expect, it, vi } from "vitest";
import { decodeQrDataUrl } from "./qr";

describe("decodeQrDataUrl", () => {
  it("returns null when the image holds no QR code", async () => {
    // jsdom has no real canvas; a blank bitmap is enough to prove the plumbing.
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 2, height: 2, close() {} })),
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob([new Uint8Array(4)]))));
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 }),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    expect(await decodeQrDataUrl("data:image/png;base64,AAAA")).toBeNull();
  });
});
