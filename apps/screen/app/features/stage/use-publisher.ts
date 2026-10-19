import { useEffect, useRef, useState } from "react";
import { classifyLink, sampleFromStats } from "~/features/rtc/quality";
import type { SfuManager, SfuSnapshot } from "~/features/rtc/sfu-manager";
import type { LocalMedia } from "~/features/rtc/use-local-media";
import type { ClientMessage, Quality, SelfReport } from "./protocol";
import type { SocketStatus } from "./reliable-socket";

const QUALITY_MS = 2000;

/** Track names are fixed per page; the SFU session id tells pages apart. */
const TRACK_NAMES = { mic: "mic", camera: "camera", screen: "screen", screenAudio: "screenAudio" };

/**
 * Feeds this page's capture into its SFU session and keeps the room told
 * what it publishes. Re-reports on every socket (re)open, because operators
 * are forgotten by the room when they disconnect.
 */
export function usePublisher({
  manager,
  snapshot,
  media,
  socketStatus,
  send,
  micLive,
  talking = false,
}: {
  manager: SfuManager | null;
  snapshot: SfuSnapshot;
  media: LocalMedia;
  socketStatus: SocketStatus;
  send: (msg: ClientMessage) => boolean;
  /** Whether the mic is actually audible (mute toggle / push-to-talk). */
  micLive: boolean;
  talking?: boolean;
}): Quality | null {
  const camera = media.camOn ? media.camera : null;
  useEffect(() => manager?.setLocal("mic", media.mic), [manager, media.mic]);
  useEffect(() => manager?.setLocal("camera", camera), [manager, camera]);
  useEffect(
    () => manager?.setLocal("screen", media.screen?.video ?? null),
    [manager, media.screen],
  );
  useEffect(
    () => manager?.setLocal("screenAudio", media.screen?.audio ?? null),
    [manager, media.screen],
  );
  useEffect(() => {
    if (media.mic) media.mic.enabled = micLive;
  }, [media.mic, micLive]);

  const [quality, setQuality] = useState<Quality | null>(null);
  useEffect(() => {
    if (!manager) return;
    const timer = setInterval(async () => {
      const conn = manager.connection;
      const stats = await conn?.stats();
      if (!conn || !stats) return setQuality(null);
      const list = [...stats.values()] as Array<Record<string, unknown> & { type: string }>;
      setQuality(classifyLink(sampleFromStats(list, conn.iceState)));
    }, QUALITY_MS);
    return () => clearInterval(timer);
  }, [manager]);

  const report: SelfReport = {
    sfuSessionId: snapshot.sessionId,
    tracks: snapshot.sessionId
      ? TRACK_NAMES
      : { mic: null, camera: null, screen: null, screenAudio: null },
    mic: micLive && media.mic !== null,
    cam: camera !== null,
    screen: media.screen !== null,
    screenAudio: media.screen?.audio != null,
    quality,
    talking,
  };
  const json = JSON.stringify(report);
  const lastSent = useRef<string | null>(null);
  useEffect(() => {
    if (socketStatus !== "open") {
      lastSent.current = null;
      return;
    }
    if (lastSent.current === json) return;
    if (send({ type: "self", report: JSON.parse(json) as SelfReport })) lastSent.current = json;
  }, [json, socketStatus, send]);

  return quality;
}
