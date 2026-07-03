import jsQR from "jsqr";

/** Decode a QR code from an image file, returning its text (an otpauth:// URI)
 * or null if none is found. Browser-only (uses canvas). */
export async function decodeQrImage(file: File): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(data, width, height);
  return result?.data ?? null;
}
