import { useCallback, useEffect, useRef, useState } from "react";
import type { DeckLayout } from "~/features/deck/model";
import type { ObsState } from "~/features/obs/state";
import type { ControllerMessage, DeckInfo, LogEntry, ToControllerMessage } from "./protocol";
import { LOG_LIMIT } from "./protocol";
import { ReliableSocket, type SocketStatus } from "./reliable-socket";

export type DeckRoomState = {
  deck: DeckInfo;
  layout: DeckLayout;
  obs: ObsState;
  dockOnline: boolean;
  switches: Record<string, boolean>;
  log: LogEntry[];
};

export type DeckRoomConnection = {
  room: DeckRoomState | null;
  status: SocketStatus;
  /** Close code when the server refused us for good (deleted…). */
  rejected: number | null;
  /** Server clock minus local clock, for output timers. */
  clockOffset: number;
  send: (msg: ControllerMessage) => boolean;
};

/** Build the deck socket URL (same origin; ws/wss follows the page). */
export function socketUrl(params: Record<string, string>): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws?${new URLSearchParams(params)}`;
}

/** One id per tab, so the room can tell controllers apart. */
export function tabId(): string {
  const key = "deck-tab-id";
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID().replaceAll("-", "");
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID().replaceAll("-", "");
  }
}

export function upsertLog(log: LogEntry[], entry: LogEntry): LogEntry[] {
  const index = log.findIndex((e) => e.id === entry.id);
  if (index === -1) return [...log, entry].slice(-LOG_LIMIT);
  const next = log.slice();
  next[index] = entry;
  return next;
}

export function reduceRoom(
  room: DeckRoomState | null,
  msg: ToControllerMessage,
): DeckRoomState | null {
  if (msg.type === "hello") {
    return {
      deck: msg.deck,
      layout: msg.layout,
      obs: msg.obs,
      dockOnline: msg.dockOnline,
      switches: msg.switches,
      log: msg.log,
    };
  }
  if (!room) return room;
  switch (msg.type) {
    case "layout":
      return { ...room, deck: msg.deck, layout: msg.layout };
    case "obs":
      return { ...room, obs: msg.obs };
    case "dock":
      return {
        ...room,
        dockOnline: msg.online,
        obs: msg.online ? room.obs : { ...room.obs, connected: false },
      };
    case "switches":
      return { ...room, switches: msg.switches };
    case "log":
      return { ...room, log: upsertLog(room.log, msg.entry) };
    default:
      return room;
  }
}

/** Live view of a deck over an endlessly reconnecting socket. */
export function useDeckRoom(deckId: string): DeckRoomConnection {
  const [room, setRoom] = useState<DeckRoomState | null>(null);
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [rejected, setRejected] = useState<number | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const socketRef = useRef<ReliableSocket | null>(null);

  useEffect(() => {
    const pid = tabId();
    const socket = new ReliableSocket({
      url: () => socketUrl({ deck: deckId, role: "controller", pid }),
      onStatus: setStatus,
      onOpen: () => setRejected(null),
      onRejected: setRejected,
      onMessage: (data) => {
        let msg: ToControllerMessage;
        try {
          msg = JSON.parse(data) as ToControllerMessage;
        } catch {
          return;
        }
        if (msg.type === "hello" || msg.type === "obs") setClockOffset(msg.serverNow - Date.now());
        setRoom((prev) => reduceRoom(prev, msg));
      },
    });
    socketRef.current = socket;
    socket.start();
    return () => {
      socket.stop();
      socketRef.current = null;
    };
  }, [deckId]);

  const send = useCallback(
    (msg: ControllerMessage) => socketRef.current?.send(JSON.stringify(msg)) ?? false,
    [],
  );

  return { room, status, rejected, clockOffset, send };
}
