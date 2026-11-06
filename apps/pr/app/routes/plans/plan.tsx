import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  Heading,
  Stack,
  Table,
  Text,
  Textarea,
} from "@gdgjp/design-system";
import { Form, Link, useNavigation } from "react-router";
import { requireCampaignAccess } from "~/features/campaigns/access.server";
import { applySurvey, createSubEvent } from "~/features/connpass/actions.server";
import { ConnpassPlanCard } from "~/features/connpass/components/ConnpassPlanCard";
import { CheckResults } from "~/features/drafts/components/CheckResults";
import {
  EnqueueError,
  enqueueCopy,
  enqueuePage,
  enqueuePlan,
} from "~/features/jobs/enqueue.server";
import { openJobs } from "~/features/jobs/job.repository.server";
import { adoptPlan } from "~/features/plans/adopt.server";
import { listPlans } from "~/features/plans/plan.repository.server";
import { channelLabel } from "~/features/playbook/playbook";
import { CampaignLayout } from "~/layouts/CampaignLayout";
import type { Route } from "./+types/plan";

export function meta() {
  return [{ title: "計画 — GDG PR" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const plans = await listPlans(env.DB, access.campaign.id);
  const url = new URL(request.url);
  const version = Number(url.searchParams.get("v")) || plans[0]?.version;
  const plan = plans.find((p) => p.version === version) ?? null;
  const pending = await openJobs(env.DB, access.campaign.id, "plan");
  const { campaign } = access;
  return {
    user: { name: access.user.name, email: access.user.email, image: access.user.image },
    accountsUrl: env.ACCOUNTS_URL,
    campaign: {
      slug: campaign.slug,
      name: campaign.name,
      status: campaign.status,
      chapterSlug: campaign.chapterSlug,
    },
    versions: plans.map((p) => ({ version: p.version, status: p.status, author: p.author })),
    plan,
    generating: pending.length > 0,
    canManage: access.permissions.manage,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const access = await requireCampaignAccess(env, request, params.slug);
  const form = await request.formData();
  const intent = form.get("intent");
  const instructions = String(form.get("instructions") ?? "").trim() || undefined;
  try {
    if (intent === "generate") {
      await enqueuePlan(env.DB, access.campaign.id, access.user.id, instructions);
      return {
        message: "計画のジョブを積みました。runner が書き終えると版が増えます。",
        error: null,
      };
    }
    if (intent === "copy") {
      await enqueueCopy(env.DB, access.campaign.id, access.user.id, { instructions });
      return { message: "コピーのジョブを積みました。下書きに出ます。", error: null };
    }
    if (intent === "connpass-page") {
      await enqueuePage(env.DB, access.campaign.id, access.user.id, {
        kind: "connpass_page",
        instructions,
      });
      return { message: "connpass ページのジョブを積みました。下書きに出ます。", error: null };
    }
    if (intent === "connpass-survey" || intent === "connpass-subevent") {
      const result =
        intent === "connpass-survey"
          ? await applySurvey(env, access)
          : await createSubEvent(env, access, String(form.get("title") ?? ""));
      return result.ok
        ? { message: result.message, error: null }
        : { message: null, error: result.error };
    }
    if (intent === "adopt") {
      if (!access.permissions.manage)
        return { message: null, error: "採用できるのはリードとオーガナイザーです" };
      const result = await adoptPlan(
        env.DB,
        access.campaign.id,
        Number(form.get("version")),
        access.members,
      );
      return {
        message: `採用しました。アイテム ${result.created} 件を作り、前の計画の未着手アイテム ${result.removed} 件を消しました。`,
        error: result.problems.length ? result.problems.join(" / ") : null,
      };
    }
  } catch (error) {
    if (error instanceof EnqueueError) return { message: null, error: error.message };
    throw error;
  }
  return { message: null, error: null };
}

const yen = (n: number) => `${n.toLocaleString("ja-JP")} 円`;

export default function PlanPage({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, campaign, versions, plan, generating, canManage } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state === "submitting";
  return (
    <CampaignLayout user={user} accountsUrl={accountsUrl} campaign={campaign} title="計画">
      {actionData?.error ? (
        <Alert tone="danger" title="確認してください">
          {actionData.error}
        </Alert>
      ) : null}
      {actionData?.message ? (
        <Alert tone="success" title="受け付けました">
          {actionData.message}
        </Alert>
      ) : null}
      {generating ? (
        <Alert tone="info" title="runner が計画を書いています">
          終わると新しい版が出ます。/admin/runner で状態を見られます。
        </Alert>
      ) : null}
      <Card>
        <Form method="post">
          <Stack>
            <FormField
              label="追加の指示"
              description="任意。例: 学生向けの施策を厚く、Instagram 広告を早めに"
            >
              <Textarea name="instructions" rows={2} />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" name="intent" value="generate" loading={busy}>
                {versions.length ? "計画を作り直す" : "計画を作る"}
              </Button>
              <Button type="submit" name="intent" value="copy" variant="outline" loading={busy}>
                コピーを作る
              </Button>
            </div>
          </Stack>
        </Form>
      </Card>
      <ConnpassPlanCard
        ideas={plan?.body.segmentContentIdeas ?? []}
        hasPlan={versions.some((v) => v.status === "adopted")}
        busy={busy}
      />
      {versions.length ? (
        <nav aria-label="版" className="flex flex-wrap gap-2">
          {versions.map((v) => (
            <Link
              key={v.version}
              to={`?v=${v.version}`}
              className={`rounded-md border border-border px-2 py-1 text-sm ${plan?.version === v.version ? "bg-selected" : ""}`}
            >
              版 {v.version}
              {v.status === "adopted" ? "（採用中）" : ""}
            </Link>
          ))}
        </nav>
      ) : (
        <Text tone="muted">まだ計画がありません。</Text>
      )}
      {plan ? (
        <>
          <Card>
            <Stack>
              <div className="flex flex-wrap items-center gap-2">
                <Heading level={2} className="text-lg">
                  版 {plan.version}
                </Heading>
                <Badge tone={plan.status === "adopted" ? "success" : "neutral"}>
                  {plan.status === "adopted"
                    ? "採用中"
                    : plan.status === "draft"
                      ? "案"
                      : "差し替え済み"}
                </Badge>
                {canManage && plan.status !== "adopted" ? (
                  <Form method="post" className="ml-auto">
                    <input type="hidden" name="version" value={plan.version} />
                    <Button
                      type="submit"
                      name="intent"
                      value="adopt"
                      variant="outline"
                      loading={busy}
                    >
                      この計画を採用してスケジュールに展開
                    </Button>
                  </Form>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap text-sm">{plan.body.strategyMd}</p>
            </Stack>
          </Card>
          <Card>
            <CheckResults results={plan.checkResults} />
          </Card>
          <Card>
            <Stack>
              <Heading level={2} className="text-lg">
                予算
              </Heading>
              <Text>
                総額 {yen(plan.body.budgetAllocation.totalYen)}（広告以外{" "}
                {yen(plan.body.budgetAllocation.printYen)}、X {yen(plan.body.budgetAllocation.x)}
                、Instagram {yen(plan.body.budgetAllocation.ig)}）
              </Text>
              <Heading level={2} className="text-lg">
                手段
              </Heading>
              <Table>
                <thead>
                  <tr>
                    <th>手段</th>
                    <th>採否</th>
                    <th>理由</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.body.channelMix.map((c) => (
                    <tr key={c.channel}>
                      <td>{c.label ?? channelLabel(c.channel)}</td>
                      <td>
                        {c.adopt ? (
                          <Badge tone="success">採用</Badge>
                        ) : (
                          <Badge tone="neutral">見送り</Badge>
                        )}
                      </td>
                      <td>{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <Heading level={2} className="text-lg">
                スケジュール案（{plan.body.scheduleItems.length} 件）
              </Heading>
              <Table>
                <thead>
                  <tr>
                    <th>日時</th>
                    <th>種類</th>
                    <th>内容</th>
                    <th>条件</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.body.scheduleItems.slice(0, 200).map((item) => (
                    <tr key={item.ref}>
                      <td className="font-mono text-xs">{item.dueAt}</td>
                      <td>{item.kind}</td>
                      <td>{item.title}</td>
                      <td className="text-xs">{item.blockedBy.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Stack>
          </Card>
        </>
      ) : null}
    </CampaignLayout>
  );
}
