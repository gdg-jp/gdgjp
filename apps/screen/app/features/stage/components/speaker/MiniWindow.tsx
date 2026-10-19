import { type ReactNode, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type DocumentPip = {
  requestWindow: (options: { width: number; height: number }) => Promise<Window>;
  window: Window | null;
};

function pipApi(): DocumentPip | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { documentPictureInPicture?: DocumentPip }).documentPictureInPicture ??
    null
  );
}

/** Copy the page's stylesheets so the mini window looks like the app. */
function cloneStyles(target: Document) {
  for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
    target.head.appendChild(node.cloneNode(true));
  }
  target.documentElement.className = document.documentElement.className;
  target.documentElement.lang = document.documentElement.lang;
  target.body.className = "sc-pip-body";
}

/**
 * Always-on-top mini window (Document Picture-in-Picture, Chrome/Edge).
 * `open()` must run inside a click handler; it resolves false where the API
 * is missing or the browser refused.
 */
export function useMiniWindow() {
  const [win, setWin] = useState<Window | null>(null);
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported(pipApi() !== null), []);

  const open = useCallback(async (): Promise<boolean> => {
    const api = pipApi();
    if (!api) return false;
    if (api.window) return true;
    try {
      const w = await api.requestWindow({ width: 300, height: 170 });
      cloneStyles(w.document);
      w.addEventListener("pagehide", () => setWin(null), { once: true });
      setWin(w);
      return true;
    } catch {
      return false;
    }
  }, []);

  const close = useCallback(() => {
    win?.close();
    setWin(null);
  }, [win]);

  useEffect(() => () => win?.close(), [win]);

  return { supported, isOpen: win !== null, open, close, win };
}

export function MiniWindowPortal({ win, children }: { win: Window | null; children: ReactNode }) {
  if (!win) return null;
  return createPortal(children, win.document.body);
}
