import { Badge, Card, Heading, PageHeader, Stack, Table, Text } from "@gdgjp/design-system";
import { requireUserWithChapter } from "~/features/auth/access.server";
import { jobCounts, listJobs, runnerStatuses } from "~/features/jobs/job.repository.server";
import { jstDate, jstTime } from "~/features/schedule/calendar";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/runner";

export function meta() {
  return [{ title: "Runner — GDG PR" }];
}

/** Is the OCI runner alive, and what is waiting for it. No job contents, only metadata. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user } = await requireUserWithChapter(env, request);
  const [runners, counts, recent] = await Promise.all([
    runnerStatuses(env.DB),
    jobCounts(env.DB),
    listJobs(env.DB, { limit: 50 }),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const at = (t: number | null) => (t ? `${jstDate(t)} ${jstTime(t)}` : "");
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    runners: runners.map((r) => ({ ...r, ago: now - r.last_seen_at })),
    counts,
    recent: recent.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      attempts: j.attempts,
      created: at(j.createdAt),
      finished: at(j.finishedAt),
      error: j.error,
    })),
  };
}

export default function Runner({ loaderData }: Route.ComponentProps) {
  const { user, accountsUrl, runners, counts, recent } = loaderData;
  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <Stack className="[word-break:auto-phrase]">
        <PageHeader title="Runner" description="下書きを書く OCI 上の gdg pr runner の状態。" />
        <Card>
          <Stack>
            <Heading level={2} className="text-lg">
              Runner
            </Heading>
            {runners.length === 0 ? <Text tone="muted">まだ一度も応答がありません。</Text> : null}
            {runners.map((r) => (
              <div key={r.host} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={r.ago < 180 ? "success" : r.ago < 600 ? "warning" : "danger"}>
                  {r.ago < 180 ? "応答あり" : `${Math.round(r.ago / 60)} 分前`}
                </Badge>
                <span className="font-mono">{r.host}</span>
                <span className="text-muted">
                  {r.backend} {r.version}
                  {r.running_job_id ? ` · 実行中 ${r.running_job_id}` : ""}
                </span>
              </div>
            ))}
          </Stack>
        </Card>
        <Card>
          <Stack>
            <Heading level={2} className="text-lg">
              キュー
            </Heading>
            <div className="flex flex-wrap gap-2">
              {counts.map((c) => (
                <Badge
                  key={`${c.type}-${c.status}`}
                  tone={
                    c.status === "failed" ? "danger" : c.status === "queued" ? "warning" : "neutral"
                  }
                >
                  {c.type} {c.status} {c.n}
                </Badge>
              ))}
            </div>
            <Table>
              <thead>
                <tr>
                  <th>ジョブ</th>
                  <th>種類</th>
                  <th>状態</th>
                  <th>作成</th>
                  <th>終了</th>
                  <th>エラー</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((j) => (
                  <tr key={j.id}>
                    <td className="font-mono text-xs">{j.id}</td>
                    <td>{j.type}</td>
                    <td>
                      {j.status}
                      {j.attempts ? `（${j.attempts}）` : ""}
                    </td>
                    <td className="font-mono text-xs">{j.created}</td>
                    <td className="font-mono text-xs">{j.finished}</td>
                    <td className="max-w-xs truncate text-xs">{j.error}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Stack>
        </Card>
      </Stack>
    </AppLayout>
  );
}
