import {
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@gdgjp/design-system";
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

function deviceLabel(d: MediaDeviceInfo, i: number, fallback: string) {
  return d.label || `${fallback} ${i + 1}`;
}

/** Radix Select items cannot have an empty value; this stands for "browser default". */
const DEFAULT = "default";

function DeviceSelect({
  label,
  value,
  devices,
  onChange,
}: {
  label: string;
  value: string;
  devices: MediaDeviceInfo[];
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <Select value={value || DEFAULT} onValueChange={(v) => onChange(v === DEFAULT ? "" : v)}>
      <SelectTrigger aria-label={label} className="sc-device-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT}>{t("defaultDevice")}</SelectItem>
        {devices.map((d, i) => (
          <SelectItem key={d.deviceId} value={d.deviceId}>
            {deviceLabel(d, i, label)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function DevicePickers({ media }: { media: LocalMedia }) {
  const { t } = useI18n();
  const { devices } = media;
  return (
    <div className="sc-devices">
      <div className="sc-device">
        <Mic size={16} aria-label={t("mic")} />
        <DeviceSelect
          label={t("mic")}
          value={media.micId}
          devices={devices.mics}
          onChange={media.selectMic}
        />
      </div>
      <div className="sc-device">
        <Camera size={16} aria-label={t("camera")} />
        <DeviceSelect
          label={t("camera")}
          value={media.camId}
          devices={devices.cameras}
          onChange={media.selectCam}
        />
      </div>
      <div className="sc-device">
        <Volume2 size={16} aria-label={t("speaker")} />
        {devices.speakers.length > 0 ? (
          <DeviceSelect
            label={t("speaker")}
            value={media.speakerId}
            devices={devices.speakers}
            onChange={media.selectSpeaker}
          />
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
