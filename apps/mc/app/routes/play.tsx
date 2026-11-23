import { Icons } from "@gdgjp/design-system";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { buildCatalog } from "~/features/clips/catalog";
import { PlayerEngine } from "~/features/playback/player-engine";
import {
  type LogEntry,
  type PlayerMessage,
  REPORT_ACTIVE_MS,
  REPORT_IDLE_MS,
  type ToPlayerMessage,
  parseJson,
} from "~/features/playback/protocol";
import { ReliableSocket } from "~/features/playback/reliable-socket";
import type { RouteHandle } from "~/root";

export const handle: RouteHandle = { transparent: true };

export function meta() {
  return [{ title: "mc player" }, { name: "robots", content: "noindex" }];
}

export default function Play() {
  const [params] = useSearchParams();
  const token = params.get("t") ?? "";
  const track = params.get("track") ?? "";
  const engineRef = useRef<PlayerEngine | null>(null);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    const backlog: Omit<LogEntry, "at">[] = [];
    let socket: ReliableSocket | null = null;
    const post = (msg: PlayerMessage) => socket?.send(JSON.stringify(msg)) ?? false;
    const log = (entry: Omit<LogEntry, "at">) => {
      if (!post({ type: "log", entry })) backlog.push(entry);
      if (backlog.length > 50) backlog.shift();
    };

    const engine = new PlayerEngine(buildCatalog().forTrack(track), log);
    engineRef.current = engine;
    let lastReport = 0;
    const report = () => {
      if (post({ type: "state", state: engine.state })) lastReport = performance.now();
    };

    socket = new ReliableSocket({
      url: () => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        return `${protocol}//${window.location.host}/ws?role=player&track=${encodeURIComponent(track)}&t=${encodeURIComponent(token)}`;
      },
      onStatus: () => {},
      onOpen: () => {
        report();
        for (const entry of backlog.splice(0)) post({ type: "log", entry });
      },
      onMessage: (raw) => {
        const msg = parseJson<ToPlayerMessage>(raw);
        if (!msg) return;
        if (msg.type === "probe") {
          if (performance.now() - lastReport > REPORT_ACTIVE_MS) report();
          return;
        }
        if (msg.type === "config") {
          engine.setConfig(msg.config);
          return;
        }
        if (msg.type === "catalog") {
          engine.setClips(buildCatalog(msg.clips).forTrack(track));
          return;
        }
        void engine.execute(msg.cmd).then((result) => {
          const state = engine.state;
          post(
            result.ok
              ? { type: "ack", id: msg.id, ok: true, state }
              : { type: "ack", id: msg.id, ...result, state },
          );
        });
      },
    });

    const unsubscribe = engine.subscribe(() => {
      setBlocked(engine.diag.autoplay === "blocked");
      report();
    });
    const timer = setInterval(() => {
      const active = engine.state.status === "playing" || engine.state.status === "gap";
      if (performance.now() - lastReport >= (active ? REPORT_ACTIVE_MS : REPORT_IDLE_MS) - 20) {
        report();
      }
    }, REPORT_ACTIVE_MS);

    engine.probeAutoplay();
    socket.start();

    return () => {
      clearInterval(timer);
      unsubscribe();
      socket?.stop();
      engine.destroy();
      engineRef.current = null;
    };
  }, [token, track]);

  if (!blocked) return null;
  return (
    <button
      type="button"
      className="mc-unlock"
      aria-label="音声を有効にする"
      onClick={() => engineRef.current?.unlock()}
    >
      <Icons name="Volume" size={18} aria-hidden="true" />
    </button>
  );
}
