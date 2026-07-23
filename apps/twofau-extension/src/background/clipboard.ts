import { COPY_MESSAGE, type CopyMessage } from "../shared/messages";

export { COPY_MESSAGE };

const OFFSCREEN_PATH = "offscreen.html";

/** Copy `text` via the offscreen document. Works on chrome:// pages and PDFs,
 *  and needs no host permission. */
export async function copyToClipboard(text: string): Promise<void> {
  await ensureOffscreen();
  const message: CopyMessage = { type: COPY_MESSAGE, text };
  const response = (await chrome.runtime.sendMessage(message)) as { ok: boolean } | undefined;
  if (!response?.ok) throw new Error("Could not write to the clipboard.");
}

async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.CLIPBOARD],
    justification: "Copy a one-time code to the clipboard from the context menu.",
  });
}
