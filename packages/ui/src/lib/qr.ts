import jsQR from "jsqr";

/** Decode a QR code from an already-decoded bitmap. Browser-only (uses canvas). */
function decodeBitmap(bitmap: ImageBitmap): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(data, width, height)?.data ?? null;
}

/** Decode a QR code from an image file, returning its text (an otpauth:// URI)
 * or null if none is found. Browser-only (uses canvas). */
export async function decodeQrImage(file: File): Promise<string | null> {
  return decodeBitmap(await createImageBitmap(file));
}

/** Decode a QR code from a data: URL (e.g. a captured tab screenshot). */
export async function decodeQrDataUrl(dataUrl: string): Promise<string | null> {
  const blob = await (await fetch(dataUrl)).blob();
  return decodeBitmap(await createImageBitmap(blob));
}
