import { Badge, Button, Card, Heading, Icons, Progress, Stack, Text } from "@gdgjp/design-system";
import { Link, useFetcher } from "react-router";
import type { Notice } from "~/features/notifications/notice";
import { sortNotices } from "~/features/notifications/notice";
import type { Source } from "../source";
import { PHASES, PHASE_LABELS } from "../state";
import type { CampaignState } from "../state.server";

const KIND_TEXT: Record<string, string> = {
  x_post: "X",
  ig_post: "Instagram",
  connpass_mail: "connpass メール",
  live_post: "当日実況",
};

function Phase({ phase }: { phase: CampaignState["phase"] }) {
  const at = PHASES.indexOf(phase);
  return (
    <ol className="grid grid-cols-5 gap-1 text-center text-xs" aria-label="進み具合">
      {PHASES.map((p, i) => (
        <li key={p} aria-current={i === at ? "step" : undefined}>
          <span
            className={`mb-1 block h-1.5 rounded-full ${i <= at ? "bg-primary" : "bg-border"}`}
            aria-hidden="true"
          />
          <span className={i === at ? "font-semibold text-foreground" : "text-muted"}>
            {PHASE_LABELS[p]}
          </span>
        </li>
      ))}
    </ol>
  );
}

function SourceRow({ source }: { source: Source }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icons
        name={source.status === "error" ? "AlertTriangle" : "FileText"}
        size={16}
        aria-hidden="true"
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="block truncate hover:underline"
        >
          {source.title || source.url}
        </a>
        <span className="text-xs text-muted">
          {source.status === "error"
            ? source.error
            : `${source.images.length ? `画像 ${source.images.length} 枚 · ` : ""}${source.fetchedAt ? new Date(source.fetchedAt * 1000).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : ""}`}
        </span>
      </div>
      <fetcher.Form method="post" className="flex shrink-0">
        <input type="hidden" name="source" value={source.id} />
        <Button
          type="submit"
          name="intent"
          value="refresh-source"
          variant="ghost"
          size="sm"
          aria-label="読み直す"
          loading={busy}
        >
          <Icons name="RefreshCw" size={14} aria-hidden="true" />
        </Button>
        <Button
          type="submit"
          name="intent"
          value="remove-source"
          variant="ghost"
          size="sm"
          aria-label="外す"
          disabled={busy}
        >
          <Icons name="X" size={14} aria-hidden="true" />
        </Button>
      </fetcher.Form>
    </li>
  );
}

/** The right column of an event page: where things stand and what to do next. */
export function StatusPanel({
  state,
  notices,
  sources,
}: {
  state: CampaignState;
  notices: Notice[];
  sources: Source[];
}) {
  const base = state.campaign.base;
  const next = sortNotices(notices.filter((n) => n.group === "waiting" || n.group === "proposal"));
  const apps = state.applications;
  return (
    <Stack>
      <Card>
        <Stack>
          <Phase phase={state.phase} />
          {state.brief.gaps.length ? (
            <Text tone="muted" className="text-sm">
              足りない情報: {state.brief.gaps.join("、")}
            </Text>
          ) : null}
          {apps ? (
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span>申込</span>
                <span className="font-semibold">
                  {apps.count} / {apps.goal}
                </span>
              </div>
              <Progress value={apps.goal ? Math.min(100, (apps.count / apps.goal) * 100) : 0} />
              <Text tone="muted" className="mt-1 text-xs">
                目標曲線より {apps.diff >= 0 ? `+${apps.diff}` : apps.diff} · あと {apps.daysLeft}{" "}
                日
              </Text>
            </div>
          ) : null}
        </Stack>
      </Card>
      <Card>
        <Stack>
          <Heading level={2} className="text-base">
            次の一手
          </Heading>
          {next.length === 0 ? (
            <Text tone="muted" className="text-sm">
              いま人がやることはありません。
            </Text>
          ) : (
            <ul className="space-y-2 text-sm">
              {next.slice(0, 6).map((n) => (
                <li key={n.key} className="flex items-start gap-2">
                  {n.urgency === 2 ? (
                    <Icons
                      name="AlertCircle"
                      size={16}
                      className="mt-0.5 shrink-0 text-danger"
                      aria-label="急ぎ"
                    />
                  ) : (
                    <Icons
                      name="CircleDashed"
                      size={16}
                      className="mt-0.5 shrink-0 text-muted"
                      aria-hidden="true"
                    />
                  )}
                  <Link to={n.href} className="hover:underline">
                    {n.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Stack>
      </Card>
      <Card>
        <Stack>
          <div className="flex items-center justify-between">
            <Heading level={2} className="text-base">
              直近の予定
            </Heading>
            <Link to={`${base}/schedule`} className="text-sm text-link">
              予定表
            </Link>
          </div>
          {state.schedule.upcoming.length === 0 ? (
            <Text tone="muted" className="text-sm">
              {state.plan ? "予定はありません。" : "計画を採用すると、ここに予定が並びます。"}
            </Text>
          ) : (
            <ul className="space-y-1 text-sm">
              {state.schedule.upcoming.slice(0, 6).map((i) => (
                <li key={i.id} className="flex flex-wrap gap-x-2">
                  <span className="font-mono text-xs text-muted">
                    {i.dueAt.slice(5, 10).replace("-", "/")} {i.dueAt.slice(11, 16)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {KIND_TEXT[i.kind] ? `${KIND_TEXT[i.kind]}: ` : ""}
                    {i.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Stack>
      </Card>
      {state.jobs.length ? (
        <Card>
          <div className="flex items-center gap-2 text-sm">
            <Badge tone="info">作業中</Badge>
            秘書がジョブを {state.jobs.length} 件進めています
          </div>
        </Card>
      ) : null}
      <Card>
        <Stack>
          <Heading level={2} className="text-base">
            情報源
          </Heading>
          {sources.length === 0 ? (
            <Text tone="muted" className="text-sm">
              スレッドに URL を貼ると、ここに並びます。
            </Text>
          ) : (
            <ul className="space-y-2">
              {sources.map((s) => (
                <SourceRow key={s.id} source={s} />
              ))}
            </ul>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
