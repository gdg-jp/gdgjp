import { IconButton } from "@gdgjp/design-system";
import { LevelBars } from "~/components/LevelBars";
import { Camera, Monitor, X } from "~/components/icons";
import { TrackVideo } from "~/features/rtc/components/TrackVideo";
import { useLevel } from "~/features/rtc/use-level";
import type { Peer, Slot } from "../../protocol";

/** One output slot: exactly what that slot's OBS sources show. */
export function SlotCard({
  slot,
  peer,
  camera,
  screen,
  mic,
  onClear,
}: {
  slot: Slot;
  peer: Peer | null;
  camera: MediaStreamTrack | null;
  screen: MediaStreamTrack | null;
  mic: MediaStreamTrack | null;
  onClear: () => void;
}) {
  const level = useLevel(mic, !!peer?.mic);
  return (
    <section className="sc-slot" data-empty={!peer || undefined} aria-label={`出力枠 ${slot}`}>
      <header className="sc-slot-head">
        <span className="sc-slot-badge">{slot}</span>
        {peer && (
          <>
            <span className="sc-slot-name" data-offline={!peer.online || undefined}>
              {peer.name}
            </span>
            <LevelBars level={level} />
            <span className="sc-spacer" />
            <IconButton
              aria-label={`${slot} の割り当てを解除`}
              variant="ghost"
              size="sm"
              onClick={onClear}
            >
              <X size={16} aria-hidden="true" />
            </IconButton>
          </>
        )}
      </header>
      {peer ? (
        <div className="sc-slot-media">
          <figure className="sc-slot-tile">
            {peer.cam && camera ? (
              <TrackVideo track={camera} fit="cover" className="sc-fill" />
            ) : (
              <Camera size={24} className="sc-muted" aria-label="カメラなし" />
            )}
          </figure>
          <figure className="sc-slot-tile sc-slot-screen">
            {peer.screen && screen ? (
              <TrackVideo track={screen} className="sc-fill" />
            ) : (
              <Monitor size={24} className="sc-muted" aria-label="画面共有なし" />
            )}
          </figure>
        </div>
      ) : (
        <div className="sc-slot-empty" aria-label="空き">
          ∅
        </div>
      )}
    </section>
  );
}
