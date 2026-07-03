import { useEffect, useState } from "react";

/** Re-render every `intervalMs`, returning the current time in unix ms. Drives
 * the countdown ring and per-second code refresh. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
