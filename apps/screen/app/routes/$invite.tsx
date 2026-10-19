import { Button } from "@gdgjp/design-system";
import { useEffect, useState } from "react";
import { Help } from "~/components/Help";
import { LogIn } from "~/components/icons";
import { I18nProvider, useI18n } from "~/features/i18n/i18n";
import { type Lang, MESSAGES, pickLang } from "~/features/i18n/messages";
import { useLocalMedia } from "~/features/rtc/use-local-media";
import { LangToggle } from "~/features/stage/components/speaker/LangToggle";
import { Lobby } from "~/features/stage/components/speaker/Lobby";
import { SpeakerRoom } from "~/features/stage/components/speaker/SpeakerRoom";
import { getStageByInvite } from "~/features/stage/stages.server";
import type { Route } from "./+types/$invite";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.stage ? `${data.stage.name} · screen` : "screen" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const lang = pickLang(request.headers.get("cookie"), request.headers.get("accept-language"));
  const stage = await getStageByInvite(context.cloudflare.env.DB, params.invite);
  const ua = request.headers.get("user-agent") ?? "";
  return {
    lang,
    token: params.invite,
    stage: stage ? { id: stage.id, name: stage.name } : null,
    mobile: /Android|iPhone|iPad|iPod|Mobile/i.test(ua),
  };
}

const PID_KEY = "screen-pid";
const NAME_KEY = "screen-name";
const joinedKey = (token: string) => `screen-joined:${token}`;

function participantId(): string {
  try {
    const existing = localStorage.getItem(PID_KEY);
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
    const id = crypto.randomUUID().replaceAll("-", "");
    localStorage.setItem(PID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID().replaceAll("-", "");
  }
}

export default function Join({ loaderData }: Route.ComponentProps) {
  return (
    <I18nProvider initial={loaderData.lang as Lang}>
      <JoinPage {...loaderData} />
    </I18nProvider>
  );
}

function JoinPage({
  token,
  stage,
  mobile,
}: {
  token: string;
  stage: { id: string; name: string } | null;
  mobile: boolean;
}) {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<"lobby" | "room" | "left">("lobby");
  const [name, setName] = useState("");
  const [pid, setPid] = useState("");
  const media = useLocalMedia(stage !== null && !mobile && phase !== "left");

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    setPid(participantId());
    try {
      const saved = localStorage.getItem(NAME_KEY) ?? "";
      setName(saved);
      // A reload mid-talk goes straight back into the room (and its slot).
      if (saved && sessionStorage.getItem(joinedKey(token)) === "1") setPhase("room");
    } catch {
      // private mode
    }
  }, [token]);

  if (!stage) return <Notice text={MESSAGES[lang].invalid} />;
  if (mobile) return <Notice text={t("useDesktop")} />;

  if (phase === "left") {
    return (
      <div className="sc-center">
        <p>{t("left")}</p>
        <Button onClick={() => setPhase("lobby")}>
          <LogIn size={16} aria-hidden="true" /> {t("rejoin")}
        </Button>
      </div>
    );
  }

  if (phase === "room" && pid) {
    return (
      <SpeakerRoom
        stage={stage}
        inviteToken={token}
        participantId={pid}
        name={name.trim()}
        media={media}
        onLeave={() => {
          media.stopScreen();
          try {
            sessionStorage.removeItem(joinedKey(token));
          } catch {
            // private mode
          }
          setPhase("left");
        }}
      />
    );
  }

  return (
    <div className="sc-page">
      <header className="sc-topbar">
        <span className="sc-brand">screen.gdgs.jp</span>
        <span className="sc-spacer" />
        <LangToggle />
        <Help label="?">
          <p>{t("helpLobby")}</p>
        </Help>
      </header>
      <Lobby
        stageName={stage.name}
        media={media}
        name={name}
        onName={setName}
        onJoin={() => {
          try {
            localStorage.setItem(NAME_KEY, name.trim());
            sessionStorage.setItem(joinedKey(token), "1");
          } catch {
            // private mode
          }
          setPhase("room");
        }}
      />
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="sc-center">
      <p>{text}</p>
    </div>
  );
}
