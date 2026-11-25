import { useClientValue } from "@gdgjp/gdg-lib/react";
import { useCallback, useMemo, useState } from "react";
import type { Message } from "./protocol";

const ACK_KEY = "screen-acked-cues";

function readStoredAcked(): string {
  try {
    return localStorage.getItem(ACK_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

function parseAcked(stored: string): string[] {
  try {
    const raw = JSON.parse(stored);
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function latestOpenCue(messages: Message[], acked: ReadonlySet<string>): Message | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.kind !== "cue") continue;
    return acked.has(m.id) ? null : m;
  }
  return null;
}

export function useOpenCue(messages: Message[]) {
  const stored = useClientValue(readStoredAcked, "[]");
  const [added, setAdded] = useState<ReadonlySet<string>>(() => new Set());
  const acked = useMemo(() => new Set([...parseAcked(stored), ...added]), [stored, added]);
  const cue = latestOpenCue(messages, acked);
  const ack = useCallback((id: string) => {
    setAdded((prev) => new Set(prev).add(id));
    const next = new Set(parseAcked(readStoredAcked())).add(id);
    try {
      localStorage.setItem(ACK_KEY, JSON.stringify([...next].slice(-200)));
    } catch {}
  }, []);
  return { cue, ack };
}
