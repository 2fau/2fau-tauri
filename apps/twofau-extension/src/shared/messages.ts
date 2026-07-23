// Shared by the service worker (sender) and the offscreen document (receiver).
// A single definition so the two ends can never drift onto different strings.
export const COPY_MESSAGE = "2fau.copy";

export interface CopyMessage {
  type: typeof COPY_MESSAGE;
  text: string;
}
