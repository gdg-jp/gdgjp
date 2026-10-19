import {
  IconButton,
  ToggleGroup,
  ToggleGroupItem,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@gdgjp/design-system";
import { LevelBars } from "~/components/LevelBars";
import {
  HeadphoneOff,
  Headphones,
  MicOff,
  Monitor,
  RefreshCw,
  Trash2,
  VideoOff,
  Wifi,
  WifiOff,
} from "~/components/icons";
import { TrackAudio } from "~/features/rtc/components/TrackVideo";
import { useLevel } from "~/features/rtc/use-level";
import type { Peer, Slot } from "../../protocol";

const QUALITY_LABEL = { good: "回線 良好", fair: "回線 やや不安定", poor: "回線 不安定" } as const;

function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="sc-hint" aria-label={label} role="img">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A speaker in the participant list: presence, level, link quality, the
 * one-click slot picker, and the personal audio monitor.
 */
export function ParticipantRow({
  peer,
  slots,
  slot,
  mic,
  screenAudio,
  monitored,
  speakerOn,
  sinkId,
  onAssign,
  onMonitor,
  onRemove,
}: {
  peer: Peer;
  slots: Slot[];
  slot: Slot | null;
  mic: MediaStreamTrack | null;
  screenAudio: MediaStreamTrack | null;
  monitored: boolean;
  /** The operator's own speaker toggle; off silences every speaker. */
  speakerOn: boolean;
  sinkId: string;
  onAssign: (slot: Slot | null) => void;
  onMonitor: (on: boolean) => void;
  onRemove: () => void;
}) {
  const level = useLevel(mic, peer.online && peer.mic);
  const reconnecting = peer.online && !peer.sfuSessionId;
  return (
    <li className="sc-person" data-online={peer.online || undefined}>
      <span className="sc-person-dot" aria-label={peer.online ? "接続中" : "切断"} />
      <span className="sc-person-name">{peer.name || "—"}</span>
      <ToggleGroup
        type="single"
        value={slot ?? ""}
        onValueChange={(v) => onAssign(v ? (v as Slot) : null)}
        aria-label={`${peer.name} の出力枠`}
        className="sc-slot-picker"
      >
        {slots.map((s) => (
          <ToggleGroupItem key={s} value={s} aria-label={`${s} に出力`}>
            {s}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <span className="sc-person-status">
        {peer.online ? (
          <>
            {peer.mic ? (
              <LevelBars level={level} />
            ) : (
              <Hint label="ミュート">
                <MicOff size={14} />
              </Hint>
            )}
            {!peer.cam && (
              <Hint label="カメラ オフ">
                <VideoOff size={14} />
              </Hint>
            )}
            {peer.screen && (
              <Hint label="画面共有中">
                <Monitor size={14} />
              </Hint>
            )}
            {reconnecting ? (
              <Hint label="再接続中">
                <RefreshCw size={14} className="sc-spin" />
              </Hint>
            ) : peer.quality ? (
              <Hint label={QUALITY_LABEL[peer.quality]}>
                <Wifi size={14} data-quality={peer.quality} className="sc-quality" />
              </Hint>
            ) : null}
          </>
        ) : (
          <Hint label="切断">
            <WifiOff size={14} className="sc-quality" data-quality="poor" />
          </Hint>
        )}
      </span>
      {peer.online ? (
        <IconButton
          aria-label={
            monitored ? `${peer.name} の音声モニターをオフ` : `${peer.name} の音声モニターをオン`
          }
          aria-pressed={monitored}
          variant="ghost"
          size="sm"
          onClick={() => onMonitor(!monitored)}
        >
          {monitored ? (
            <Headphones size={16} aria-hidden="true" />
          ) : (
            <HeadphoneOff size={16} aria-hidden="true" />
          )}
        </IconButton>
      ) : (
        <IconButton
          aria-label={`${peer.name} を一覧から外す`}
          variant="ghost"
          size="sm"
          onClick={onRemove}
        >
          <Trash2 size={16} aria-hidden="true" />
        </IconButton>
      )}
      <TrackAudio
        track={peer.online ? mic : null}
        muted={!monitored || !speakerOn}
        sinkId={sinkId}
      />
      <TrackAudio
        track={peer.online && peer.screenAudio ? screenAudio : null}
        muted={!monitored || !speakerOn}
        sinkId={sinkId}
      />
    </li>
  );
}
