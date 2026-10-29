import { Alert, Heading, IconButton, Icons, Stack, Text } from "@gdgjp/design-system";
import { useEffect, useState } from "react";
import { type ShouldRevalidateFunctionArgs, data, useFetcher, useRevalidator } from "react-router";
import { Confetti, Flash, Stamp, Sunburst } from "~/features/draw/components/Celebration";
import { PrizeList } from "~/features/draw/components/PrizeList";
import { ResultCard } from "~/features/draw/components/ResultCard";
import { SpinButton } from "~/features/draw/components/SpinButton";
import { type LightMode, Wheel } from "~/features/draw/components/Wheel";
import { ensureDeviceId, readDeviceId } from "~/features/draw/device-cookie.server";
import { type SpinOutcome, getDeviceDraw, spin } from "~/features/draw/draw.server";
import { setSoundOn } from "~/features/draw/feedback";
import { restingOn, useSpin } from "~/features/draw/use-spin";
import { currentOdds, rankOf, segmentsFor } from "~/features/prizes/odds";
import { getProject } from "~/features/projects/projects.server";
import { normalizeSlug } from "~/features/projects/slug";
import type { Route } from "./+types/draw";

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: data ? `${data.project.name} — GDG Roulette` : "GDG Roulette" },
    { name: "robots", content: "noindex" },
  ];
}

/**
 * Public spin page. Sends the wheel layout, the prize names and this device's
 * past result — never stock, odds or what has been won.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const slug = normalizeSlug(params.slug);
  if (!slug) throw new Response(null, { status: 404 });
  const project = await getProject(env.DB, slug);
  if (!project) throw new Response(null, { status: 404 });
  const device = ensureDeviceId(request, { secure: new URL(request.url).protocol === "https:" });
  const mine = await getDeviceDraw(env.DB, slug, device.id);
  const odds = currentOdds(project.prizes, project.method, project.expected, project.draws);
  const status = !project.open ? "closed" : odds.every((value) => value === 0) ? "soldout" : "open";
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  if (device.setCookie) headers.append("Set-Cookie", device.setCookie);
  return data(
    {
      project: { slug, name: project.name },
      status,
      segments: segmentsFor(project.prizes, project.method, project.expected),
      prizes: project.prizes.flatMap((prize) => {
        const rank = rankOf(project.prizes, prize.id);
        return rank === null ? [] : [{ name: prize.name, rank }];
      }),
      mine,
    },
    { headers },
  );
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const slug = normalizeSlug(params.slug);
  if (!slug) throw new Response(null, { status: 404 });
  const deviceId = readDeviceId(request);
  if (!deviceId) return { status: "nocookie" } as const;
  return spin(context.cloudflare.env.DB, slug, deviceId);
}

// The page animates the spin's result itself; reloading it would jump to the end.
export function shouldRevalidate({
  formMethod,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  return formMethod === "POST" ? false : defaultShouldRevalidate;
}

const failure: Record<
  Exclude<SpinOutcome["status"], "won" | "already"> | "nocookie",
  string | null
> = {
  closed: null,
  soldout: null,
  missing: null,
  busy: "混み合っています。もう一度回してください。",
  nocookie: "Cookie を有効にしてから、ページを開き直してください。",
};

const SOUND_KEY = "roulette-sound";

function useSound() {
  const [sound, setSound] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(SOUND_KEY) === "off") setSound(false);
    } catch {
      // Storage can be unavailable (private mode); keep the default.
    }
  }, []);
  useEffect(() => setSoundOn(sound), [sound]);
  const toggle = () =>
    setSound((value) => {
      try {
        localStorage.setItem(SOUND_KEY, value ? "off" : "on");
      } catch {
        // Not remembered this time.
      }
      return !value;
    });
  return [sound, toggle] as const;
}

export default function DrawPage({ loaderData }: Route.ComponentProps) {
  const { project, status, segments, prizes, mine } = loaderData;
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [initial] = useState(() =>
    mine ? restingOn(segments, mine.prizeId) : { rotation: 8, highlight: undefined },
  );
  const wheel = useSpin(segments, initial);
  const [sound, toggleSound] = useSound();
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: react to each new spin response only
  useEffect(() => {
    const outcome = fetcher.data;
    if (!outcome) return;
    if (outcome.status === "won" || outcome.status === "already") {
      wheel.land(outcome.result);
      return;
    }
    wheel.abort();
    setError(failure[outcome.status]);
    // Closed, sold out or gone: show the page as it is now.
    revalidator.revalidate();
  }, [fetcher.data]);

  const result = wheel.result ?? mine;
  const phase =
    wheel.phase !== "idle" ? wheel.phase : mine ? "done" : status === "open" ? "idle" : status;
  const showResult = (phase === "result" || phase === "done") && result;
  const celebrating = phase === "result" && result && result.tier !== "lose" ? result.tier : null;
  const lights: LightMode =
    phase === "closed" || phase === "soldout"
      ? "off"
      : phase === "charge" || phase === "spinning"
        ? "spin"
        : celebrating
          ? "celebrate"
          : "idle";

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground [word-break:auto-phrase]">
      <div className="mx-auto flex max-w-[960px] flex-col gap-4 px-4 pt-3 pb-10">
        <header className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {/* A div, not Text: Icons renders a div, which a <p> cannot contain. */}
            <div className="flex items-center gap-1 text-sm text-muted">
              <Icons name="LoaderPinwheel" size={14} aria-hidden="true" />
              GDG Roulette
            </div>
            <Heading level={1} className="text-xl">
              {project.name}
            </Heading>
          </div>
          <IconButton
            variant="ghost"
            aria-label={sound ? "音を消す" : "音を出す"}
            onClick={toggleSound}
          >
            {sound ? (
              <Icons name="AudioLines" size={20} animateOnHover={false} aria-hidden="true" />
            ) : (
              <Icons name="Volume" size={20} animateOnHover={false} aria-hidden="true" />
            )}
          </IconButton>
        </header>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_360px] md:items-start">
          <div className="relative overflow-hidden">
            {celebrating && <Sunburst tier={celebrating} />}
            <Wheel
              segments={segments}
              rotation={wheel.rotation}
              highlight={showResult ? wheel.highlight : undefined}
              lights={lights}
              dimmed={phase === "closed" || phase === "soldout"}
              compact={phase === "done"}
              wheelRef={wheel.wheelRef}
              pointerRef={wheel.pointerRef}
            />
            {phase === "result" && result && <Stamp tier={result.tier} />}
          </div>
          <Stack>
            {phase === "done" && (
              <Alert tone="info" title="この端末ではもう抽選しました">
                {result?.tier === "lose"
                  ? "1 人 1 回までです。ご参加ありがとうございました。"
                  : "結果をスタッフに見せて、景品を受け取ってください。"}
              </Alert>
            )}
            {phase === "closed" && (
              <Alert tone="warning" title="いまは抽選を受け付けていません">
                運営スタッフの案内をお待ちください。
              </Alert>
            )}
            {phase === "soldout" && (
              <Alert tone="info" title="景品はすべてなくなりました">
                たくさんのご参加、ありがとうございました。
              </Alert>
            )}
            {error && <Alert tone="danger" title={error} />}
            {showResult ? (
              <ResultCard result={result} />
            ) : (
              phase !== "soldout" && (
                <Stack className="gap-2">
                  <SpinButton
                    label={
                      phase === "charge"
                        ? "はなして回す！"
                        : phase === "spinning"
                          ? "回転中…"
                          : "ルーレットを回す"
                    }
                    charge={wheel.charge}
                    disabled={phase === "spinning" || phase === "closed"}
                    pulse={phase === "idle"}
                    onChargeStart={wheel.startCharge}
                    onChargeCancel={wheel.cancelCharge}
                    onSpin={() => {
                      if (!wheel.release()) return;
                      setError(null);
                      fetcher.submit({}, { method: "post" });
                    }}
                  />
                  <Text size="sm" tone="muted" className="text-center">
                    {phase === "closed"
                      ? "受付が始まると回せます"
                      : "長押しで勢いをためられます · 1 人 1 回まで"}
                  </Text>
                </Stack>
              )
            )}
            <PrizeList prizes={prizes} />
          </Stack>
        </div>
      </div>
      {celebrating && <Confetti tier={celebrating} runKey={wheel.celebrateKey} />}
      {celebrating && <Flash tier={celebrating} runKey={wheel.celebrateKey} />}
    </div>
  );
}
