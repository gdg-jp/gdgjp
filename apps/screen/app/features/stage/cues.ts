import { useCallback, useEffect, useState } from "react";
import type { Message } from "./protocol";

const ACK_KEY = "screen-acked-cues";

function readAcked(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ACK_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** The newest cue the speaker has not dismissed yet (older cues are superseded). */
export function latestOpenCue(messages: Message[], acked: ReadonlySet<string>): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.kind !== "cue") continue;
    return acked.has(m.id) ? null : m;
  }
  return null;
}

/** Dismissed cue ids survive reloads, so a reconnect never re-shows old cues. */
export function useOpenCue(messages: Message[]) {
  const [acked, setAcked] = useState<Set<string>>(() => new Set());
  useEffect(() => setAcked(new Set(readAcked())), []);
  const cue = latestOpenCue(messages, acked);
  const ack = useCallback((id: string) => {
    setAcked((prev) => {
      const next = new Set(prev).add(id);
      try {
        localStorage.setItem(ACK_KEY, JSON.stringify([...next].slice(-200)));
      } catch {
        // private mode
      }
      return next;
    });
  }, []);
  return { cue, ack };
}
