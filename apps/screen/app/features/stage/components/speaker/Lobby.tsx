import { Button, Input } from "@gdgjp/design-system";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Help } from "~/components/Help";
import { LevelBars } from "~/components/LevelBars";
import {
  Camera,
  Headphones,
  Monitor,
  MonitorUp,
  ShieldAlert,
  TriangleAlert,
  User,
} from "~/components/icons";
import { useI18n } from "~/features/i18n/i18n";
import { TrackVideo } from "~/features/rtc/components/TrackVideo";
import { canShareTabAudio } from "~/features/rtc/media";
import { useLevel } from "~/features/rtc/use-level";
import type { LocalMedia } from "~/features/rtc/use-local-media";
import { CamControl, MicControl, ShareToggle, SpeakerControl, SwitchShare } from "./MediaControls";

/** Device check before entering the room (Q16/Q23). */
export function Lobby({
  stageName,
  media,
  name,
  onName,
  onJoin,
}: {
  stageName: string;
  media: LocalMedia;
  name: string;
  onName: (name: string) => void;
  onJoin: () => void;
}) {
  const { t } = useI18n();
  const level = useLevel(media.mic, media.micOn);
  const [tabAudio, setTabAudio] = useState(true);
  useEffect(() => setTabAudio(canShareTabAudio(navigator.userAgent)), []);
  // Join is always pressable; a missing name is explained right at the field.
  const [nameError, setNameError] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(true);
      nameRef.current?.focus();
      return;
    }
    onJoin();
  };
  const share = () => void media.shareScreen();
  const kinds = [media.problem.mic, media.problem.camera];
  const problem = kinds.includes("denied")
    ? t("permissionTitle")
    : kinds.includes("inUse")
      ? t("deviceInUse")
      : kinds.includes("notFound")
        ? t("deviceMissing")
        : null;

  return (
    <form className="sc-lobby" onSubmit={submit}>
      <h1 className="sc-lobby-title">{stageName}</h1>
      <div className="sc-lobby-previews">
        <section className="sc-preview" aria-label={t("camera")}>
          <div className="sc-preview-frame">
            {media.camOn && media.camera ? (
              <TrackVideo track={media.camera} mirror fit="cover" className="sc-fill" />
            ) : (
              <Camera size={40} className="sc-preview-empty" aria-hidden="true" />
            )}
          </div>
          <div className="sc-preview-bar">
            <MicControl media={media} />
            <LevelBars level={level} />
            <CamControl media={media} />
            <SpeakerControl media={media} />
          </div>
        </section>
        <section className="sc-preview" aria-label={t("share")}>
          <div className="sc-preview-frame">
            {media.screen ? (
              <TrackVideo track={media.screen.video} fit="contain" className="sc-fill" />
            ) : (
              <button
                type="button"
                className="sc-share-cta"
                onClick={share}
                aria-label={t("share")}
              >
                <MonitorUp size={40} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="sc-preview-bar">
            <ShareToggle media={media} onShare={share} />
            {media.screen ? (
              <SwitchShare onShare={share} />
            ) : (
              <Monitor size={18} className="sc-muted" aria-hidden="true" />
            )}
          </div>
        </section>
      </div>

      <div className="sc-name-field">
        <div className="sc-name">
          <User size={18} aria-label={t("name")} />
          <Input
            ref={nameRef}
            value={name}
            onChange={(e) => {
              onName(e.target.value);
              if (e.target.value.trim()) setNameError(false);
            }}
            placeholder={t("name")}
            aria-label={t("name")}
            aria-invalid={nameError || undefined}
            aria-describedby={nameError ? "sc-name-error" : undefined}
            maxLength={40}
            autoComplete="name"
          />
        </div>
        {nameError && (
          <p id="sc-name-error" className="sc-field-error" role="alert">
            {t("nameRequired")}
          </p>
        )}
      </div>

      <ul className="sc-notes">
        {problem && (
          <li className="sc-notes-error">
            <ShieldAlert size={16} aria-hidden="true" /> {problem}
            {media.problem.mic === "denied" || media.problem.camera === "denied" ? (
              <Help label="?">
                <p>{t("permissionHelp")}</p>
              </Help>
            ) : (
              <Button size="sm" variant="secondary" onClick={media.retry}>
                {t("retry")}
              </Button>
            )}
          </li>
        )}
        {!tabAudio && (
          <li>
            <TriangleAlert size={16} aria-hidden="true" /> {t("safariAudio")}
          </li>
        )}
        <li>
          <Headphones size={16} aria-hidden="true" /> {t("earphones")}
        </li>
      </ul>

      <Button type="submit" size="lg" className="sc-join">
        {t("join")}
      </Button>
    </form>
  );
}
