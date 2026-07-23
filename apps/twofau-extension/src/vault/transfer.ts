/** Trigger a download of the sealed blob from an extension page. */
export function downloadBlob(blob: Uint8Array, filename: string): void {
  // Copy into a fresh ArrayBuffer-backed view: a WASM-produced Uint8Array can
  // be typed over ArrayBufferLike (possibly SharedArrayBuffer), which BlobPart
  // rejects.
  const bytes = new Uint8Array(blob);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
