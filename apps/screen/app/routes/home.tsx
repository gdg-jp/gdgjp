import { IconButton } from "@gdgjp/design-system";
import { useEffect } from "react";
import { Link, useRevalidator } from "react-router";
import { Help } from "~/components/Help";
import { Plus, Radio, Users } from "~/components/icons";
import { requireUserWithChapter } from "~/features/auth/auth-redirect.server";
import { CreateStageDialog, StageMenu } from "~/features/stage/components/StageDialogs";
import type { StageSummary } from "~/features/stage/room-state";
import { listStages, metaOf } from "~/features/stage/stages.server";
import { TopBar } from "~/layouts/TopBar";
import type { Route } from "./+types/home";

export function meta() {
  return [{ title: "screen.gdgs.jp" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user } = await requireUserWithChapter(env, request);
  const stages = await listStages(env.DB);
  const summaries = await Promise.all(
    stages.map((s) =>
      env.STAGE.getByName(s.id)
        .summary(metaOf(s))
        .catch((): StageSummary => ({ onAir: false, outputs: 0, participants: 0 })),
    ),
  );
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    stages: stages.map((s, i) => ({
      id: s.id,
      name: s.name,
      slotCount: s.slotCount,
      inviteToken: s.inviteToken,
      outputToken: s.outputToken,
      summary: summaries[i] ?? { onAir: false, outputs: 0, participants: 0 },
    })),
  };
}

const POLL_MS = 5000;

export default function Home({ loaderData }: Route.ComponentProps) {
  const { stages, user, accountsUrl } = loaderData;
  const revalidator = useRevalidator();

  // Live counts: re-read the summaries while the list is on screen.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && revalidator.state === "idle") {
        void revalidator.revalidate();
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [revalidator]);

  return (
    <div className="sc-page">
      <TopBar user={user} accountsUrl={accountsUrl} />
      <main className="sc-home">
        <div className="sc-home-actions">
          <CreateStageDialog
            trigger={
              <IconButton aria-label="ステージを作成" variant="primary">
                <Plus size={20} aria-hidden="true" />
              </IconButton>
            }
          />
          <Help>
            <p>
              ステージは会場のトラックごとに 1 つ作ります。OBS の URL
              と招待リンクは、削除・再発行するまで変わりません。
            </p>
            <p className="sc-help-legend">
              <Radio size={14} aria-hidden="true" /> 出力中の枠
              <Users size={14} aria-hidden="true" /> 参加中の登壇者
            </p>
          </Help>
        </div>
        <ul className="sc-stage-list">
          {stages.map((s) => (
            <li key={s.id} className="sc-stage-row" data-on-air={s.summary.onAir || undefined}>
              <Link to={`/stages/${s.id}`} className="sc-stage-link">
                <span
                  className="sc-onair-dot"
                  aria-label={s.summary.onAir ? "ON AIR" : undefined}
                />
                <span className="sc-stage-name">
                  <strong>{s.name}</strong>
                  <code>{s.id}</code>
                </span>
                <span className="sc-stage-count" title="出力中の枠">
                  <Radio size={16} aria-hidden="true" />
                  {s.summary.outputs}
                </span>
                <span className="sc-stage-count" title="参加中の登壇者">
                  <Users size={16} aria-hidden="true" />
                  {s.summary.participants}
                </span>
              </Link>
              <StageMenu stage={s} />
            </li>
          ))}
        </ul>
        {stages.length === 0 && (
          <div className="sc-empty">
            <CreateStageDialog
              trigger={
                <button type="button" className="sc-empty-add">
                  <Plus size={32} aria-hidden="true" />
                  <span>ステージを作成</span>
                </button>
              }
            />
          </div>
        )}
      </main>
    </div>
  );
}
