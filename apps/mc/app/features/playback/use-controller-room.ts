import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UploadedClip } from "~/features/clips/catalog";
import { AckTracker, type CommandResult } from "./ack-tracker";
import {
  type Command,
  type ControllerMessage,
  HEARTBEAT_MS,
  type LogEntry,
  type LoopSetting,
  type PlayerPresence,
  type RoomConfig,
  STALE_MS,
  type ToControllerMessage,
  parseJson,
} from "./protocol";
import { ReliableSocket, type SocketStatus } from "./reliable-socket";

export type PlayerView = PlayerPresence & { receivedAt: number; alive: boolean };

export type RoomView = {
  socket: SocketStatus;
  rtt: number | null;
  token: string | null;
  config: RoomConfig;
  players: PlayerView[];
  primary: PlayerView | null;
  log: LogEntry[];
  uploaded: UploadedClip[] | null;
};

const LOG_LIMIT = 200;

export function useControllerRoom(track: string) {
  const [socket, setSocket] = useState<SocketStatus>("connecting");
  const [rtt, setRtt] = useState<number | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [config, setConfig] = useState<RoomConfig>({ played: {}, loops: {} });
  const [players, setPlayers] = useState<Map<string, PlayerView>>(new Map());
  const [log, setLog] = useState<LogEntry[]>([]);
  const [uploaded, setUploaded] = useState<UploadedClip[] | null>(null);
  const [tick, setTick] = useState(0);
  const socketRef = useRef<ReliableSocket | null>(null);
  const acks = useMemo(() => new AckTracker(), []);

  useEffect(() => {
    const onMessage = (raw: string) => {
      const msg = parseJson<ToControllerMessage>(raw);
      if (!msg) return;
      const now = performance.now();
      switch (msg.type) {
        case "snapshot":
          setToken(msg.token);
          setConfig(msg.config);
          setLog(msg.log.slice(-LOG_LIMIT));
          setUploaded(msg.clips ?? []);
          setPlayers(
            new Map(
              msg.players.map((p) => [
                p.connId,
                { ...p, receivedAt: now - (msg.serverNow - p.lastSeenAt), alive: true },
              ]),
            ),
          );
          return;
        case "player":
          setPlayers((prev) => {
            const next = new Map(prev);
            next.set(msg.presence.connId, { ...msg.presence, receivedAt: now, alive: true });
            return next;
          });
          return;
        case "playerGone":
          setPlayers((prev) => {
            const next = new Map(prev);
            next.delete(msg.connId);
            return next;
          });
          return;
        case "config":
          setConfig(msg.config);
          return;
        case "token":
          setToken(msg.token);
          return;
        case "catalog":
          setUploaded(msg.clips);
          return;
        case "log":
          setLog((prev) => [...prev, msg.entry].slice(-LOG_LIMIT));
          return;
        case "result":
          acks.settle(
            msg.id,
            msg.ok ? { ok: true } : { ok: false, reason: msg.reason, detail: msg.detail },
          );
          return;
      }
    };

    const s = new ReliableSocket({
      url: () => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${protocol}//${window.location.host}/ws?role=controller&track=${encodeURIComponent(track)}`;
      },
      onMessage,
      onStatus: (status) => {
        setSocket(status);
        if (status !== "open") acks.failAll("offline");
      },
      onRtt: setRtt,
    });
    socketRef.current = s;
    s.start();
    const timer = setInterval(() => setTick((t) => t + 1), 500);
    const probe = setInterval(() => s.send(JSON.stringify({ type: "probe" })), HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      clearInterval(probe);
      s.stop();
      socketRef.current = null;
    };
  }, [acks, track]);

  const views = useMemo(() => {
    void tick;
    const now = performance.now();
    return [...players.values()]
      .map((p) => ({ ...p, alive: socket === "open" && now - p.receivedAt < STALE_MS }))
      .sort((a, b) => b.receivedAt - a.receivedAt);
  }, [players, socket, tick]);

  const primary = views.find((p) => p.alive && p.state) ?? null;

  const post = useCallback((msg: ControllerMessage) => {
    return socketRef.current?.send(JSON.stringify(msg)) ?? false;
  }, []);

  const send = useCallback(
    (cmd: Command): Promise<CommandResult> => {
      const id = crypto.randomUUID();
      const result = acks.track(id);
      if (!post({ type: "cmd", id, cmd })) acks.settle(id, { ok: false, reason: "offline" });
      return result;
    },
    [acks, post],
  );

  const room: RoomView = { socket, rtt, token, config, players: views, primary, log, uploaded };

  return {
    room,
    send,
    setLoop: (clipId: string, setting: LoopSetting) => post({ type: "setLoop", clipId, setting }),
    setPlayed: (clipId: string, value: boolean) => post({ type: "setPlayed", clipId, value }),
    resetPlayed: () => post({ type: "resetPlayed" }),
    rotateToken: () => post({ type: "rotateToken" }),
  };
}

export function positionAt(player: PlayerView | null, now: number): number {
  const s = player?.state;
  if (!s) return 0;
  if (s.status !== "playing") return s.positionMs;
  return Math.min(s.durationMs, s.positionMs + (now - player.receivedAt));
}
