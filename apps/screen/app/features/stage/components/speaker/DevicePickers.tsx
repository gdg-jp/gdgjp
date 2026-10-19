import { IconButton, NativeSelect, NativeSelectOption } from "@gdgjp/design-system";
import { Camera, Mic, Play, Volume2 } from "~/components/icons";
import { useI18n } from "~/features/i18n/i18n";
import type { LocalMedia } from "~/features/rtc/use-local-media";

/** A short 660 Hz beep on the chosen output device. */
export function playTestTone(sinkId: string) {
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const dest = ctx.createMediaStreamDestination();
  osc.frequency.value = 660;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.8);
  osc.connect(gain).connect(dest);
  const audio = new Audio() as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
  audio.srcObject = dest.stream;
  const start = () => {
    void audio.play();
    osc.start();
    osc.stop(ctx.currentTime + 0.85);
    setTimeout(() => void ctx.close(), 1200);
  };
  if (sinkId && audio.setSinkId) void audio.setSinkId(sinkId).then(start, start);
  else start();
}

function label(d: MediaDeviceInfo, i: number, fallback: string) {
  return d.label || `${fallback} ${i + 1}`;
}

export function DevicePickers({ media }: { media: LocalMedia }) {
  const { t } = useI18n();
  const { devices } = media;
  return (
    <div className="sc-devices">
      <div className="sc-device">
        <Mic size={16} aria-label={t("mic")} />
        <NativeSelect
          aria-label={t("mic")}
          value={media.micId}
          onChange={(e) => media.selectMic(e.target.value)}
        >
          <NativeSelectOption value="">{t("defaultDevice")}</NativeSelectOption>
          {devices.mics.map((d, i) => (
            <NativeSelectOption key={d.deviceId} value={d.deviceId}>
              {label(d, i, t("mic"))}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="sc-device">
        <Camera size={16} aria-label={t("camera")} />
        <NativeSelect
          aria-label={t("camera")}
          value={media.camId}
          onChange={(e) => media.selectCam(e.target.value)}
        >
          <NativeSelectOption value="">{t("defaultDevice")}</NativeSelectOption>
          {devices.cameras.map((d, i) => (
            <NativeSelectOption key={d.deviceId} value={d.deviceId}>
              {label(d, i, t("camera"))}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <div className="sc-device">
        <Volume2 size={16} aria-label={t("speaker")} />
        {devices.speakers.length > 0 ? (
          <NativeSelect
            aria-label={t("speaker")}
            value={media.speakerId}
            onChange={(e) => media.selectSpeaker(e.target.value)}
          >
            <NativeSelectOption value="">{t("defaultDevice")}</NativeSelectOption>
            {devices.speakers.map((d, i) => (
              <NativeSelectOption key={d.deviceId} value={d.deviceId}>
                {label(d, i, t("speaker"))}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : (
          <span className="sc-muted">{t("defaultDevice")}</span>
        )}
        <IconButton
          aria-label={t("testSound")}
          variant="ghost"
          size="sm"
          onClick={() => playTestTone(media.speakerId)}
        >
          <Play size={14} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}
