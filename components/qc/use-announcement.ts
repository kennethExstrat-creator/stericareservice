// A message for a polite live region that is spoken again when it repeats.
// Setting the same string twice would not change the DOM, so nothing would be
// announced; a repeat alternates a trailing no-break space instead.
import { useCallback, useState } from "react";

const NO_BREAK_SPACE = " ";

export function nextAnnouncement(current: string, next: string): string {
  return current === next ? `${next}${NO_BREAK_SPACE}` : next;
}

export function useAnnouncement(): readonly [message: string, announce: (message: string) => void] {
  const [message, setMessage] = useState("");
  const announce = useCallback((next: string) => setMessage((current) => nextAnnouncement(current, next)), []);
  return [message, announce] as const;
}
