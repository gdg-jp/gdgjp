import { useEffect, useMemo, useState } from "react";
import { TrackAudio, TrackVideo } from "~/features/rtc/components/TrackVideo";
import { type RemoteRef, remoteKey } from "~/features/rtc/sfu-client";
import { useSfu } from "~/features/rtc/use-sfu";
import { type OutputView, isOutputKind, isSlot } from "~/features/stage/protocol";
import { isStageId } from "~/features/stage/stage-id";
import { useStageRoom } from "~/features/stage/use-stage-room";
import type { RouteHandle } from "~/root";
import type { Route } from "./+types/out.$stageId.$slot.$kind";

export const handle: RouteHandle = { transparent: true };

export function meta() {
  return [{ title: "screen output" }];
}

export function loader({ params, request }: Route.LoaderArgs) {
  const { stageId, slot, kind } = params;
  if (!isStageId(stageId) || !isSlot(slot) || !isOutputKind(kind)) {
    throw new Response(null, { status: 404 });
  }
  const url = new URL(request.url);
  return {
    stageId,
    slot,
    kind,
    token: url.searchParams.get("t") ?? "",
    debug: url.searchParams.has("debug"),
  };
}

/** A disconnected speaker's last frame stays up this long before fading out. */
const HOLD_MS = 10_000;

/**
 * OBS Browser Source. Renders nothing but the assigned speaker's camera or
 * screen (contain-fit on a transparent page), or plays its mic. Everything
 * reconnects on its own; nothing here ever needs a click.
 */
export default function Output({ loaderData }: Route.ComponentProps) {
  const { stageId, slot, kind, token, debug } = loaderData;
  const room = useStageRoom<OutputView>({ role: "output", stage: stageId, slot, t: token });
  const { manager, snapshot } = useSfu(stageId, `output:${token}`, [], true);
  const peer = room.view?.peer ?? null;

  const refs = useMemo(() => {
    const list: RemoteRef[] = [];
    if (!peer?.online || !peer.sfuSessionId) return list;
    const add = (name: string | null) => {
      if (name && peer.sfuSessionId) list.push({ sessionId: peer.sfuSessionId, trackName: name });
    };
    if (kind === "camera" && peer.cam) add(peer.tracks.camera);
    if (kind === "screen" && peer.screen) {
      add(peer.tracks.screen);
      if (peer.screenAudio) add(peer.tracks.screenAudio);
    }
    if (kind === "mic") add(peer.tracks.mic);
    return list;
  }, [peer, kind]);

  useEffect(() => {
    manager?.want(refs);
  }, [manager, refs]);

  const main = refs[0] ? (snapshot.remote.get(remoteKey(refs[0])) ?? null) : null;
  const extra = refs[1] ? (snapshot.remote.get(remoteKey(refs[1])) ?? null) : null;

  const wanted = peer !== null && (kind === "mic" || (kind === "camera" ? peer.cam : peer.screen));
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!wanted) {
      setHeld(false);
      return;
    }
    if (main) {
      setHeld(true);
      return;
    }
    const timer = setTimeout(() => setHeld(false), HOLD_MS);
    return () => clearTimeout(timer);
  }, [wanted, main]);
  const visible = wanted && (main !== null || held);

  return (
    <div className="sc-out">
      {kind === "mic" ? (
        <TrackAudio track={visible ? main : null} />
      ) : (
        <>
          <div className="sc-out-frame" style={{ opacity: visible ? 1 : 0 }}>
            <TrackVideo
              track={main}
              holdLastFrame
              className="sc-out-video"
              fit="contain"
              label={`${slot} ${kind}`}
            />
          </div>
          {kind === "screen" && <TrackAudio track={visible ? extra : null} />}
        </>
      )}
      {debug && (
        <pre className="sc-out-debug">
          {JSON.stringify(
            {
              slot,
              kind,
              socket: room.status,
              rejected: room.rejected,
              sfu: snapshot.status,
              session: snapshot.sessionId,
              peer: peer && { name: peer.name, online: peer.online, session: peer.sfuSessionId },
              tracks: refs.map((r) => r.trackName),
              receiving: [...snapshot.remote.keys()],
              visible,
            },
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}
