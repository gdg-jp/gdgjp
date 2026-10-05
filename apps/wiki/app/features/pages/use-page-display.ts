import { useEffect, useState } from "react";

export type PageDisplay = { smallText: boolean; fullWidth: boolean };
const defaults: PageDisplay = { smallText: false, fullWidth: false };

export function usePageDisplay(pageId: string, userId: string | null) {
  const key = `wiki:page-display:${JSON.stringify([userId, pageId])}`;
  const [state, setState] = useState({ key: "", value: defaults });
  useEffect(() => {
    let value = defaults;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      value = { smallText: saved?.smallText === true, fullWidth: saved?.fullWidth === true };
    } catch {
      /* Storage is optional for viewing. */
    }
    setState({ key, value });
  }, [key]);
  const value = state.key === key ? state.value : defaults;
  const change = (next: PageDisplay) => {
    setState({ key, value: next });
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Keep session state. */
    }
  };
  return [value, change] as const;
}
