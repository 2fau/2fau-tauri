// A service worker has no DOM, so clipboard writes happen here. execCommand is
// deprecated on the web but is the supported path for offscreen documents:
// navigator.clipboard requires document focus, which an offscreen document
// never has.
import { COPY_MESSAGE } from "../shared/messages";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== COPY_MESSAGE) return undefined;
  const sink = document.getElementById("sink") as HTMLTextAreaElement;
  sink.value = String(message.text ?? "");
  sink.select();
  const ok = document.execCommand("copy");
  sink.value = ""; // don't leave the code sitting in the DOM
  sendResponse({ ok });
  return true;
});
