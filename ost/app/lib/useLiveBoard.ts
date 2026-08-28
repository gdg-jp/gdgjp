import { useEffect, useRef, useState } from "react";
import type { BoardMessage, OstBoardState } from "~/lib/topics";

type Options = {
  /** When false, the socket is closed / not opened (used for the vote dialog). */
  enabled?: boolean;
};

/**
 * Subscribe to an event board's live state over `/ws?board=<slug>`.
 *
 * Seeds from the SSR loader snapshot, then replaces state wholesale on every
 * `{ type: "state" }` frame. Reconnects with exponential backoff.
 */
export function useLiveBoard(slug: string, initial: OstBoardState, options: Options = {}) {
  const enabled = options.enabled ?? true;
  const [state, setState] = useState<OstBoardState>(initial);
  const [connected, setConnected] = useState(false);
  // Keep the latest seed without forcing a resubscribe.
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      setConnected(false);
      return;
    }

    let unmounted = false;
    let socket: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(
        `${protocol}//${window.location.host}/ws?board=${encodeURIComponent(slug)}`,
      );

      socket.addEventListener("open", () => {
        retry = 0;
        setConnected(true);
      });
      socket.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data as string) as BoardMessage;
          if (message.type === "state") setState(message.state);
        } catch {
          // ignore malformed frames
        }
      });
      socket.addEventListener("close", () => {
        setConnected(false);
        if (unmounted) return;
        const delay = Math.min(1000 * 2 ** retry, 30_000);
        retry += 1;
        timer = setTimeout(connect, delay);
      });
      socket.addEventListener("error", () => socket?.close());
    };

    connect();

    return () => {
      unmounted = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, [slug, enabled]);

  return { state, connected };
}
