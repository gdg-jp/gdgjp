import { IconButton } from "@gdgjp/design-system";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Help } from "~/components/Help";
import { RoundToggle } from "~/components/RoundToggle";
import { ArrowLeft, Mic, MicOff, Radio, RefreshCw, Tv, Users, WifiOff } from "~/components/icons";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { TrackVideo } from "~/features/rtc/components/TrackVideo";
import { remoteKey } from "~/features/rtc/sfu-client";
import { useLocalMedia } from "~/features/rtc/use-local-media";
import { SPEAKER_PUBLISH, useSfu } from "~/features/rtc/use-sfu";
import { ObsDialog, StageMenu } from "~/features/stage/components/StageDialogs";
import { MessagePanel } from "~/features/stage/components/control/MessagePanel";
import { OperatorName } from "~/features/stage/components/control/OperatorName";
import { ParticipantRow } from "~/features/stage/components/control/ParticipantRow";
import { SlotCard } from "~/features/stage/components/control/SlotCard";
import { TimerControl } from "~/features/stage/components/control/TimerControl";
import {
  CamControl,
  MicControl,
  ShareToggle,
  SpeakerControl,
} from "~/features/stage/components/speaker/MediaControls";
import {
  CLOSE_DELETED,
  type OperatorView,
  type Peer,
  type Slot,
  slotsOf,
} from "~/features/stage/protocol";
import { controlRoomRefs } from "~/features/stage/pulls";
import { isStageId } from "~/features/stage/stage-id";
import { getStage } from "~/features/stage/stages.server";
import { usePublisher } from "~/features/stage/use-publisher";
import { useStageRoom } from "~/features/stage/use-stage-room";
import type { Route } from "./+types/stages.$stageId";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data ? `${data.stage.name} · screen` : "screen" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  await requireUserWithChapter(env, request);
  if (!isStageId(params.stageId)) throw new Response(null, { status: 404 });
  const stage = await getStage(env.DB, params.stageId);
  if (!stage) throw new Response(null, { status: 404 });
  return {
    stage: {
      id: stage.id,
      name: stage.name,
      slotCount: stage.slotCount,
      inviteToken: stage.inviteToken,
      outputToken: stage.outputToken,
    },
  };
}

const TAB_KEY = "screen-op-tab";

function tabId(): string {
  try {
    const existing = sessionStorage.getItem(TAB_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID().replaceAll("-", "");
    sessionStorage.setItem(TAB_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID().replaceAll("-", "");
  }
}

/** Space bar push-to-talk, ignored while typing. */
function usePushToTalk(enabled: boolean): [boolean, (held: boolean) => void] {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setHeld(false);
      return;
    }
    const typing = (e: KeyboardEvent) =>
      e.target instanceof HTMLElement &&
      (e.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(e)) return;
      e.preventDefault();
      setHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setHeld(false);
    };
    const blur = () => setHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [enabled]);
  return [held, setHeld];
}

export default function ControlRoom({ loaderData }: Route.ComponentProps) {
  const { stage } = loaderData;
  const [tab, setTab] = useState("");
  useEffect(() => setTab(tabId()), []);
  const room = useStageRoom<OperatorView>(
    tab ? { role: "operator", stage: stage.id, pid: tab } : null,
  );
  const { manager, snapshot } = useSfu(stage.id, null, SPEAKER_PUBLISH, tab !== "");
  const media = useLocalMedia(true, "operator");
  const view = room.view;
  const onAir = view?.onAir ?? false;

  const [pttHeld, setPtt] = usePushToTalk(onAir);
  const micLive = onAir ? pttHeld && media.mic !== null : media.micOn;
  usePublisher({
    manager,
    snapshot,
    media,
    socketStatus: room.status,
    send: room.send,
    micLive,
    talking: micLive,
  });

  const speakers = view?.speakers ?? [];
  const slotMap = view?.slots;
  const refs = useMemo(() => controlRoomRefs(speakers, slotMap ?? {}), [speakers, slotMap]);
  useEffect(() => manager?.want(refs), [manager, refs]);
  const remote = useCallback(
    (p: Peer | undefined | null, name: string | null) =>
      p?.sfuSessionId && name
        ? (snapshot.remote.get(remoteKey({ sessionId: p.sfuSessionId, trackName: name })) ?? null)
        : null,
    [snapshot.remote],
  );

  const [muted, setMuted] = useState<ReadonlySet<string>>(new Set());
  const slots = slotsOf(view?.stage.slotCount ?? stage.slotCount);
  const slotOf = (id: string) => slots.find((s) => view?.slots[s] === id) ?? null;
  const assign = (slot: Slot, participantId: string | null) =>
    room.send({ type: "assign", slot, participantId });
  const [obsOpen, setObsOpen] = useState(false);
  const name = view?.stage.name ?? stage.name;
  const access = { ...stage, name };
  const linkDown = room.status !== "open" || snapshot.status === "reconnecting";

  if (room.rejected === CLOSE_DELETED) {
    return (
      <div className="sc-center">
        <p>このステージは削除されました</p>
        <Link to="/">screen.gdgs.jp</Link>
      </div>
    );
  }

  return (
    <div className="sc-control">
      <header className="sc-control-head">
        <IconButton asChild aria-label="ステージ一覧" variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft size={18} aria-hidden="true" />
          </Link>
        </IconButton>
        <span className="sc-control-name">{name}</span>
        <code className="sc-muted">{stage.id}</code>
        {linkDown && (
          <span className="sc-chip" data-tone="warn" aria-label="再接続中">
            {room.status === "offline" ? (
              <WifiOff size={14} />
            ) : (
              <RefreshCw size={14} className="sc-spin" />
            )}
          </span>
        )}
        <span className="sc-spacer" />
        <IconButton aria-label="OBS" variant="ghost" size="sm" onClick={() => setObsOpen(true)}>
          <Tv size={18} aria-hidden="true" />
        </IconButton>
        <StageMenu stage={access} onReset={() => room.send({ type: "reset" })} />
        <OperatorName
          current={view?.operators.find((o) => o.id === view.selfId)?.name ?? null}
          socketStatus={room.status}
          send={room.send}
        />
        <span className="sc-op-count" title="配信担当">
          <Users size={16} aria-hidden="true" /> {view?.operators.length ?? 0}
        </span>
        <button
          type="button"
          className="sc-onair-toggle"
          aria-pressed={onAir}
          onClick={() => room.send({ type: "onAir", value: !onAir })}
        >
          <Radio size={16} aria-hidden="true" /> ON AIR
        </button>
        <Help>
          <p>
            ON AIR 中は、登壇者の画面に赤い ● ON AIR が出ます。あなたのマイクはスペースキー（または
            🎤 ボタン）を押している間だけ登壇者に届きます。
          </p>
        </Help>
      </header>

      <main className="sc-control-main">
        <section className="sc-slots" aria-label="出力枠">
          <div className="sc-panel-head">
            <span>出力枠</span>
            <Help>
              <p>
                各枠は OBS の 3 つのソース（カメラ・画面・マイク）に対応します。右の参加者一覧で
                A〜D を押すと、その人がこの枠に出ます。
              </p>
            </Help>
          </div>
          <div className="sc-slot-grid" data-count={slots.length}>
            {slots.map((s) => {
              const id = view?.slots[s] ?? null;
              const peer = id ? (speakers.find((p) => p.id === id) ?? null) : null;
              return (
                <SlotCard
                  key={s}
                  slot={s}
                  peer={peer}
                  camera={remote(peer, peer?.tracks.camera ?? null)}
                  screen={remote(peer, peer?.tracks.screen ?? null)}
                  mic={remote(peer, peer?.tracks.mic ?? null)}
                  onClear={() => assign(s, null)}
                />
              );
            })}
          </div>
        </section>

        <aside className="sc-control-side">
          <section className="sc-people" aria-label="参加者">
            <div className="sc-panel-head">
              <span>参加者</span>
              <Help>
                <p>
                  登壇者は招待リンクから参加します。🎧 で各登壇者の音声をこの PC
                  で聞くかを切り替えます。切断中の人は 🗑 で一覧から外せます。
                </p>
              </Help>
            </div>
            <ul className="sc-people-list">
              {speakers.map((p) => (
                <ParticipantRow
                  key={p.id}
                  peer={p}
                  slots={slots}
                  slot={slotOf(p.id)}
                  mic={remote(p, p.tracks.mic)}
                  screenAudio={remote(p, p.tracks.screenAudio)}
                  monitored={!muted.has(p.id)}
                  speakerOn={media.speakerOn}
                  sinkId={media.speakerId}
                  onAssign={(slot) => {
                    const current = slotOf(p.id);
                    if (slot) assign(slot, p.id);
                    else if (current) assign(current, null);
                  }}
                  onMonitor={(on) =>
                    setMuted((prev) => {
                      const next = new Set(prev);
                      if (on) next.delete(p.id);
                      else next.add(p.id);
                      return next;
                    })
                  }
                  onRemove={() => room.send({ type: "remove", participantId: p.id })}
                  onDenoise={(patch) =>
                    room.send({ type: "denoise", participantId: p.id, ...patch })
                  }
                />
              ))}
            </ul>
          </section>
          <MessagePanel
            speakers={speakers}
            messages={view?.messages ?? []}
            selfId={view?.selfId ?? ""}
            send={room.send}
          />
        </aside>
      </main>

      <footer className="sc-control-bar">
        {view && (
          <TimerControl timer={view.timer} clockOffset={room.clockOffset} send={room.send} />
        )}
        <span className="sc-spacer" />
        <MicControl
          media={media}
          toggle={
            onAir ? (
              <RoundToggle
                label="押している間だけ話す（スペース）"
                off={!pttHeld}
                active={pttHeld}
                onPointerDown={() => setPtt(true)}
                onPointerUp={() => setPtt(false)}
                onPointerLeave={() => setPtt(false)}
              >
                {pttHeld ? <Mic size={20} /> : <MicOff size={20} />}
              </RoundToggle>
            ) : (
              <RoundToggle
                label={media.micOn ? "マイクをオフ" : "マイクをオン"}
                off={!media.micOn}
                onClick={media.toggleMic}
              >
                {media.micOn ? <Mic size={20} /> : <MicOff size={20} />}
              </RoundToggle>
            )
          }
        />
        <CamControl media={media} />
        <SpeakerControl media={media} />
        <ShareToggle media={media} onShare={() => void media.shareScreen()} />
        <figure className="sc-self-tile">
          {media.camOn && media.camera && (
            <TrackVideo track={media.camera} mirror fit="cover" className="sc-fill" />
          )}
        </figure>
      </footer>

      <ObsDialog stage={access} open={obsOpen} onOpenChange={setObsOpen} />
    </div>
  );
}
