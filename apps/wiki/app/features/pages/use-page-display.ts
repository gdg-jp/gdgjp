import { useState, useSyncExternalStore } from "react";

export type PageDisplay = { smallText: boolean; fullWidth: boolean };
const defaults: PageDisplay = { smallText: false, fullWidth: false };

function subscribeToStorage(notify: () => void) {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseDisplay(raw: string | null): PageDisplay {
  try {
    const saved = JSON.parse(raw ?? "null");
    return { smallText: saved?.smallText === true, fullWidth: saved?.fullWidth === true };
  } catch {
    return defaults;
  }
}

export function usePageDisplay(pageId: string, userId: string | null) {
  const key = `wiki:page-display:${JSON.stringify([userId, pageId])}`;
  const stored = useSyncExternalStore(
    subscribeToStorage,
    () => readStored(key),
    () => null,
  );
  const [override, setOverride] = useState<{ key: string; value: PageDisplay } | null>(null);
  const value = override?.key === key ? override.value : parseDisplay(stored);
  const change = (next: PageDisplay) => {
    setOverride({ key, value: next });
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  };
  return [value, change] as const;
}
