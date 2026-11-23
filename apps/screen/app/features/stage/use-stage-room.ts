import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ToClientMessage, View } from "./protocol";
import { ReliableSocket, type SocketStatus } from "./reliable-socket";

export type RoomConnection<V extends View> = {
  view: V | null;
  status: SocketStatus;
  rejected: number | null;
  clockOffset: number;
  send: (msg: ClientMessage) => boolean;
};

export function socketUrl(params: Record<string, string>): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws?${new URLSearchParams(params)}`;
}

export function useStageRoom<V extends View>(
  params: Record<string, string> | null,
): RoomConnection<V> {
  const [view, setView] = useState<V | null>(null);
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [rejected, setRejected] = useState<number | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const socketRef = useRef<ReliableSocket | null>(null);
  const key = params ? JSON.stringify(params) : null;

  useEffect(() => {
    if (!key) return;
    const p = JSON.parse(key) as Record<string, string>;
    setRejected(null);
    const socket = new ReliableSocket({
      url: () => socketUrl(p),
      onStatus: setStatus,
      onOpen: () => setRejected(null),
      onRejected: setRejected,
      onMessage: (data) => {
        let msg: ToClientMessage;
        try {
          msg = JSON.parse(data) as ToClientMessage;
        } catch {
          return;
        }
        if (msg.type === "state") {
          setClockOffset(msg.view.serverNow - Date.now());
          setView(msg.view as V);
        }
      },
    });
    socketRef.current = socket;
    socket.start();
    return () => {
      socket.stop();
      socketRef.current = null;
    };
  }, [key]);

  const send = useCallback(
    (msg: ClientMessage) => socketRef.current?.send(JSON.stringify(msg)) ?? false,
    [],
  );

  return { view, status, rejected, clockOffset, send };
}
