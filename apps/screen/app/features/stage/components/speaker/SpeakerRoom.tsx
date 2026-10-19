import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  toast,
} from "@gdgjp/design-system";
import { useEffect, useMemo, useRef, useState } from "react";
import { Help } from "~/components/Help";
import { RoundToggle } from "~/components/RoundToggle";
import {
  Check,
  Mic,
  MonitorUp,
  PhoneOff,
  PictureInPicture2,
  RefreshCw,
  ShieldAlert,
  Timer as TimerIcon,
  WifiOff,
} from "~/components/icons";
import { useI18n } from "~/features/i18n/i18n";
import { TrackAudio, TrackVideo } from "~/features/rtc/components/TrackVideo";
import { type RemoteRef, remoteKey } from "~/features/rtc/sfu-client";
import type { LocalMedia } from "~/features/rtc/use-local-media";
import { SPEAKER_PUBLISH, useSfu } from "~/features/rtc/use-sfu";
import { useOpenCue } from "../../cues";
import {
  CLOSE_DELETED,
  CLOSE_REPLACED,
  type Message,
  type Peer,
  type SpeakerView,
} from "../../protocol";
import { formatRemaining, useRemaining } from "../../timer";
import { usePublisher } from "../../use-publisher";
import { useStageRoom } from "../../use-stage-room";
import { ChatLog } from "../ChatLog";
import { LangToggle } from "./LangToggle";
import { CamControl, MicControl, MicToggle, ShareToggle, SpeakerControl } from "./MediaControls";
import { MiniWindowPortal, useMiniWindow } from "./MiniWindow";

/** After this long without a working connection the yellow bar turns red. */
const OFFLINE_AFTER_MS = 30_000;

function operatorRefs(operators: Peer[]): RemoteRef[] {
  const refs: RemoteRef[] = [];
  for (const op of operators) {
    const sid = op.sfuSessionId;
    if (!op.online || !sid) continue;
    const add = (name: string | null, on: boolean) => {
      if (name && on) refs.push({ sessionId: sid, trackName: name });
    };
    add(op.tracks.mic, true);
    add(op.tracks.camera, op.cam);
    add(op.tracks.screen, op.screen);
    add(op.tracks.screenAudio, op.screenAudio);
  }
  return refs;
}

function useDisconnectedFor(connected: boolean): number {
  const [since, setSince] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (connected) return setSince(null);
    setSince((s) => s ?? Date.now());
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [connected]);
  return since === null ? 0 : Date.now() - since;
}

export function SpeakerRoom({
  stage,
  inviteToken,
  participantId,
  name,
  media,
  onLeave,
}: {
  stage: { id: string; name: string };
  inviteToken: string;
  participantId: string;
  name: string;
  media: LocalMedia;
  onLeave: () => void;
}) {
  const { t } = useI18n();
  const room = useStageRoom<SpeakerView>({
    role: "speaker",
    invite: inviteToken,
    pid: participantId,
    name,
  });
  const { manager, snapshot } = useSfu(stage.id, `invite:${inviteToken}`, SPEAKER_PUBLISH, true);
  const view = room.view;
  usePublisher({
    manager,
    snapshot,
    media,
    socketStatus: room.status,
    send: room.send,
    micLive: media.micOn,
    denoise: view?.denoise,
  });

  const operators = view?.operators ?? [];
  const refs = useMemo(() => operatorRefs(operators), [operators]);
  useEffect(() => manager?.want(refs), [manager, refs]);
  const track = (sid: string | null, name: string | null) =>
    sid && name
      ? (snapshot.remote.get(remoteKey({ sessionId: sid, trackName: name })) ?? null)
      : null;

  const sharingOp = operators.find((o) => o.online && o.screen);
  const opScreen = sharingOp ? track(sharingOp.sfuSessionId, sharingOp.tracks.screen) : null;
  const camOps = operators.filter((o) => o.online && o.cam);
  const talking = operators.filter((o) => o.online && o.talking);

  const connected = room.status === "open" && snapshot.status === "connected";
  const downFor = useDisconnectedFor(connected);
  const linkState = connected ? "ok" : downFor >= OFFLINE_AFTER_MS ? "down" : "retrying";
  const onAir = !!view?.onAir && !!view.slot;
  const remaining = useRemaining(view?.timer, room.clockOffset);

  // ─── cues & notifications ────────────────────────────────────────────
  const messages = view?.messages ?? [];
  const { cue, ack } = useOpenCue(messages);
  const pip = useMiniWindow();
  useCueAlerts(cue, pip.isOpen);

  // ─── screen share (+ mini window in the same click) ─────────────────
  const share = () => {
    void media.shareScreen();
    if (pip.supported && !pip.isOpen) {
      void pip.open().then((ok) => ok && toast(t("pipHint")));
    } else if (!pip.supported && typeof Notification !== "undefined") {
      if (Notification.permission === "default") void Notification.requestPermission();
    }
  };
  useEffect(() => {
    if (!media.screenEndedByBrowser) return;
    toast(t("shareStopped"), {
      action: { label: t("reshare"), onClick: () => void media.shareScreen() },
      duration: 10_000,
    });
  }, [media.screenEndedByBrowser, media.shareScreen, t]);

  const denied = media.problem.mic === "denied" || media.problem.camera === "denied";

  if (room.rejected === CLOSE_REPLACED || room.rejected === CLOSE_DELETED) {
    return (
      <div className="sc-center">
        <p>{room.rejected === CLOSE_REPLACED ? t("replaced") : t("deleted")}</p>
        {room.rejected === CLOSE_REPLACED && (
          <Button onClick={() => window.location.reload()}>{t("reload")}</Button>
        )}
      </div>
    );
  }

  const timerText = remaining === null ? null : formatRemaining(remaining);
  const status = (
    <>
      {view?.slot && <span className="sc-slot-badge">{view.slot}</span>}
      <span className="sc-chip" data-tone={onAir ? "onair" : "idle"}>
        <span className="sc-dot" /> {t("onAir")}
      </span>
      <span
        className="sc-chip"
        data-tone={linkState === "ok" ? "ok" : linkState === "down" ? "down" : "warn"}
      >
        <span className="sc-dot" /> {t("connected")}
      </span>
      {timerText && (
        <span
          className="sc-timer"
          data-over={remaining !== null && remaining < 0 ? true : undefined}
        >
          <TimerIcon size={16} aria-label={t("remaining")} />
          {timerText}
        </span>
      )}
    </>
  );

  return (
    <div className="sc-room">
      <header className="sc-room-head">
        <span className="sc-room-name">{stage.name}</span>
        {status}
        {talking.map((o) => (
          <span key={o.id} className="sc-talking">
            <Mic size={14} aria-hidden="true" /> {o.name}
          </span>
        ))}
        <span className="sc-spacer" />
        <LangToggle />
        <Help label="?">
          <p>{t("helpRoom")}</p>
          <p>{t("helpPip")}</p>
        </Help>
      </header>

      {linkState !== "ok" && (
        <div
          className="sc-bar"
          data-tone={linkState === "down" ? "down" : "warn"}
          aria-live="polite"
        >
          {linkState === "down" ? (
            <>
              <WifiOff size={16} aria-hidden="true" /> {t("offline")}
              <Button size="sm" variant="secondary" onClick={() => window.location.reload()}>
                {t("retry")}
              </Button>
            </>
          ) : (
            <>
              <RefreshCw size={16} className="sc-spin" aria-hidden="true" /> {t("reconnecting")}
            </>
          )}
        </div>
      )}

      {cue && (
        <div className="sc-cue" role="alert">
          <span className="sc-cue-text">{cue.text}</span>
          <Button onClick={() => ack(cue.id)} aria-label={t("ok")}>
            <Check size={18} aria-hidden="true" /> {t("ok")}
          </Button>
        </div>
      )}

      <main className="sc-room-main">
        <section className="sc-room-stage">
          {opScreen ? (
            <TrackVideo track={opScreen} className="sc-fill" label={t("operator")} />
          ) : media.screen ? (
            <TrackVideo track={media.screen.video} className="sc-fill" label={t("you")} />
          ) : (
            <button type="button" className="sc-share-cta sc-share-cta-lg" onClick={share}>
              <MonitorUp size={56} aria-hidden="true" />
              <span>{t("share")}</span>
            </button>
          )}
        </section>
        <aside className="sc-room-side">
          {camOps.map((o) => (
            <figure key={o.id} className="sc-tile">
              <TrackVideo
                track={track(o.sfuSessionId, o.tracks.camera)}
                fit="cover"
                className="sc-fill"
              />
              <figcaption>{o.name}</figcaption>
            </figure>
          ))}
          <figure className="sc-tile">
            {media.camOn && media.camera ? (
              <TrackVideo track={media.camera} mirror fit="cover" className="sc-fill" />
            ) : null}
            <figcaption>{t("you")}</figcaption>
          </figure>
        </aside>
        <aside className="sc-room-chat" aria-label={t("chat")}>
          <ChatLog
            messages={messages.filter((m) => m.kind === "chat")}
            selfId={view?.selfId ?? ""}
            sendLabel={t("send")}
            onSend={(text) => room.send({ type: "message", kind: "chat", to: null, text })}
          />
        </aside>
      </main>

      <footer className="sc-room-bar">
        <MicControl media={media} />
        <CamControl media={media} />
        <SpeakerControl media={media} />
        <ShareToggle media={media} onShare={share} />
        {pip.supported && (
          <RoundToggle
            label={t("miniWindow")}
            active={pip.isOpen}
            onClick={() => (pip.isOpen ? pip.close() : void pip.open())}
          >
            <PictureInPicture2 size={20} />
          </RoundToggle>
        )}
        <RoundToggle label={t("leave")} danger onClick={onLeave}>
          <PhoneOff size={20} />
        </RoundToggle>
      </footer>

      {operators
        .filter((o) => o.online)
        .flatMap((o) => [
          <TrackAudio
            key={`${o.id}-mic`}
            track={track(o.sfuSessionId, o.tracks.mic)}
            sinkId={media.speakerId}
            muted={!media.speakerOn}
          />,
          <TrackAudio
            key={`${o.id}-sa`}
            track={o.screenAudio ? track(o.sfuSessionId, o.tracks.screenAudio) : null}
            sinkId={media.speakerId}
            muted={!media.speakerOn}
          />,
        ])}

      <MiniWindowPortal win={pip.win}>
        <div className="sc-mini">
          <div className="sc-mini-head">{status}</div>
          {cue ? (
            <div className="sc-mini-cue">
              <span>{cue.text}</span>
              <button
                type="button"
                className="sc-round sc-round-sm"
                aria-label={t("ok")}
                onClick={() => ack(cue.id)}
              >
                <Check size={16} />
              </button>
            </div>
          ) : (
            <div className="sc-mini-idle">{stage.name}</div>
          )}
          <div className="sc-mini-bar">
            <MicToggle media={media} />
          </div>
        </div>
      </MiniWindowPortal>

      <Dialog open={denied}>
        <DialogContent className="sc-dialog" closeLabel={t("ok")}>
          <DialogTitle>
            <ShieldAlert size={20} aria-hidden="true" /> {t("permissionTitle")}
          </DialogTitle>
          <DialogDescription>{t("permissionHelp")}</DialogDescription>
          <Button onClick={() => window.location.reload()}>{t("reload")}</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Without a mini window the speaker may be looking at slides: surface new
 * cues through a system notification and a blinking tab title.
 */
function useCueAlerts(cue: Message | null, pipOpen: boolean) {
  const lastId = useRef<string | null>(null);
  useEffect(() => {
    if (!cue || cue.id === lastId.current) return;
    lastId.current = cue.id;
    if (pipOpen || document.visibilityState === "visible") return;
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification(cue.text, { tag: "screen-cue" });
      } catch {
        // some browsers require a service worker
      }
    }
  }, [cue, pipOpen]);

  useEffect(() => {
    if (!cue) return;
    const original = document.title;
    let on = false;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") {
        document.title = original;
        return;
      }
      on = !on;
      document.title = on ? `● ${cue.text}` : original;
    }, 1000);
    return () => {
      clearInterval(timer);
      document.title = original;
    };
  }, [cue]);
}
