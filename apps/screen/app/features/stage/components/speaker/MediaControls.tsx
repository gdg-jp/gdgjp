import { RoundToggle } from "~/components/RoundToggle";
import { Mic, MicOff, MonitorOff, MonitorUp, Repeat, Video, VideoOff } from "~/components/icons";
import { useI18n } from "~/features/i18n/i18n";
import type { LocalMedia } from "~/features/rtc/use-local-media";

export function MicToggle({ media }: { media: LocalMedia }) {
  const { t } = useI18n();
  return (
    <RoundToggle
      label={media.micOn ? t("micOn") : t("micOff")}
      off={!media.micOn}
      onClick={media.toggleMic}
    >
      {media.micOn ? <Mic size={20} /> : <MicOff size={20} />}
    </RoundToggle>
  );
}

export function CamToggle({ media }: { media: LocalMedia }) {
  const { t } = useI18n();
  return (
    <RoundToggle
      label={media.camOn ? t("camOn") : t("camOff")}
      off={!media.camOn}
      onClick={media.toggleCam}
    >
      {media.camOn ? <Video size={20} /> : <VideoOff size={20} />}
    </RoundToggle>
  );
}

/** Share / stop. `onShare` must start the capture synchronously (user activation). */
export function ShareToggle({ media, onShare }: { media: LocalMedia; onShare: () => void }) {
  const { t } = useI18n();
  return media.screen ? (
    <RoundToggle label={t("stopShare")} active onClick={media.stopScreen}>
      <MonitorOff size={20} />
    </RoundToggle>
  ) : (
    <RoundToggle label={t("share")} onClick={onShare}>
      <MonitorUp size={20} />
    </RoundToggle>
  );
}

export function SwitchShare({ onShare }: { onShare: () => void }) {
  const { t } = useI18n();
  return (
    <RoundToggle label={t("switchShare")} onClick={onShare} className="sc-round-sm">
      <Repeat size={16} />
    </RoundToggle>
  );
}
