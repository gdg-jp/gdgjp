import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@gdgjp/design-system";
import type { ReactNode } from "react";
import { RoundToggle } from "~/components/RoundToggle";
import {
  ChevronUp,
  Ellipsis,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  Play,
  Repeat,
  Video,
  VideoOff,
} from "~/components/icons";
import { useI18n } from "~/features/i18n/i18n";
import { type DeviceOption, deviceOptions, selectedDevice } from "~/features/rtc/devices";
import { playTestTone } from "~/features/rtc/test-tone";
import type { LocalMedia } from "~/features/rtc/use-local-media";

function DeviceItems({
  options,
  value,
  onChange,
}: {
  options: DeviceOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <DropdownMenuRadioGroup
      value={value}
      // Always pin the exact device: an empty "follow the OS" id lets the browser
      // pick for itself, which is not necessarily the device marked default.
      onValueChange={onChange}
    >
      {options.map((o) => (
        <DropdownMenuRadioItem key={o.deviceId} value={o.deviceId} className="sc-device-item">
          <span>{o.label}</span>
          {o.isDefault && <span className="sc-device-default">{t("systemDefault")}</span>}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/**
 * Meet-style split control: a menu button on the left (device choice) joined
 * to the round on/off toggle on the right.
 */
function Split({
  menuLabel,
  menuIcon,
  menu,
  children,
}: {
  menuLabel: string;
  menuIcon: ReactNode;
  menu: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="sc-split">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="sc-split-menu" aria-label={menuLabel} title={menuLabel}>
            {menuIcon}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="sc-device-menu">
          {menu}
        </DropdownMenuContent>
      </DropdownMenu>
      {children}
    </div>
  );
}

/**
 * Mic toggle plus a menu for microphone and speaker. `toggle` replaces the
 * plain mute button (the control room swaps in push-to-talk while ON AIR).
 */
export function MicControl({ media, toggle }: { media: LocalMedia; toggle?: ReactNode }) {
  const { t } = useI18n();
  const mics = deviceOptions(media.devices.mics, t("mic"));
  const speakers = deviceOptions(media.devices.speakers, t("speaker"));
  const mic = selectedDevice(mics, media.micId, media.mic?.getSettings().deviceId);
  const speaker = selectedDevice(speakers, media.speakerId, undefined);
  return (
    <Split
      menuLabel={t("micSettings")}
      menuIcon={<Ellipsis size={18} />}
      menu={
        <>
          <DropdownMenuLabel>{t("mic")}</DropdownMenuLabel>
          <DeviceItems options={mics} value={mic} onChange={media.selectMic} />
          {speakers.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t("speaker")}</DropdownMenuLabel>
              <DeviceItems options={speakers} value={speaker} onChange={media.selectSpeaker} />
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              playTestTone(media.speakerId);
            }}
          >
            <Play size={16} aria-hidden="true" /> {t("testSound")}
          </DropdownMenuItem>
        </>
      }
    >
      {toggle ?? <MicToggle media={media} />}
    </Split>
  );
}

export function CamControl({ media }: { media: LocalMedia }) {
  const { t } = useI18n();
  const cams = deviceOptions(media.devices.cameras, t("camera"));
  const cam = selectedDevice(cams, media.camId, media.camera?.getSettings().deviceId);
  return (
    <Split
      menuLabel={t("camSettings")}
      menuIcon={<ChevronUp size={18} />}
      menu={
        <>
          <DropdownMenuLabel>{t("camera")}</DropdownMenuLabel>
          <DeviceItems options={cams} value={cam} onChange={media.selectCam} />
        </>
      }
    >
      <RoundToggle
        label={media.camOn ? t("camOn") : t("camOff")}
        off={!media.camOn}
        onClick={media.toggleCam}
      >
        {media.camOn ? <Video size={20} /> : <VideoOff size={20} />}
      </RoundToggle>
    </Split>
  );
}

/** Mute toggle alone (the mini window has no room for the menu). */
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
