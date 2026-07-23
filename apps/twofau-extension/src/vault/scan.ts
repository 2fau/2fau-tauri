import { decodeQrDataUrl } from "@twofau/ui";

/**
 * Screenshot the active tab and decode a QR code from it. Relies on `activeTab`,
 * which the action click that opened the popup grants for this tab only — no
 * host permissions, no content script. (Confirmed by the Task 11 spike.)
 */
export async function scanCurrentTab(): Promise<string> {
  const dataUrl = await chrome.tabs.captureVisibleTab();
  const text = await decodeQrDataUrl(dataUrl);
  if (!text) throw new Error("No QR code found on this page.");
  if (!text.startsWith("otpauth://")) throw new Error("That QR code isn't a 2FA enrolment code.");
  return text;
}
