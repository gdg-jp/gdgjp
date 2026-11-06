import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  Heading,
  Input,
  PageHeader,
  Stack,
  Text,
  Textarea,
} from "@gdgjp/design-system";
import { Form, Link, useNavigation } from "react-router";
import { requireOrganizer } from "~/features/learning/access.server";
import { editGroups } from "~/features/learning/edits.server";
import { KIND_LABELS, STATUS_LABELS } from "~/features/learning/proposal";
import {
  decideProposal,
  getProposal,
  markApplied,
} from "~/features/learning/proposal.repository.server";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/proposal";

export function meta() {
  return [{ title: "提案 — GDG PR" }];
}

async function load(env: Env, request: Request, id: string | undefined) {
  const organizer = await requireOrganizer(env, request);
  const proposal = id ? await getProposal(env.DB, id) : null;
  if (!proposal || !organizer.chapterIds.includes(proposal.chapterId))
    throw new Response(null, { status: 404 });
  return { ...organizer, proposal };
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, proposal } = await load(env, request, params.id);
  const keys = (proposal.evidence.editGroupKeys as string[] | undefined) ?? [];
  const groups =
    proposal.campaignId && keys.length
      ? (await editGroups(env.DB, proposal.campaignId, proposal.chapterId)).filter((g) =>
          keys.includes(g.key),
        )
      : [];
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    proposal,
    groups,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { user, proposal } = await load(env, request, params.id);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "applied") {
    const version = String(form.get("version") ?? "").trim();
    if (!/^[0-9a-f]{7,40}$/.test(version))
      return { ok: false as const, message: "skills のコミットを入れてください" };
    await markApplied(env.DB, proposal.id, version);
    return { ok: true as const, message: "適用済みにしました" };
  }
  const reason = String(form.get("reason") ?? "").trim();
  if (!reason) return { ok: false as const, message: "理由を書いてください" };
  const decided = await decideProposal(
    env.DB,
    proposal.id,
    intent === "accept" ? "accepted" : "rejected",
    user.id,
    reason,
  );
  return decided
    ? { ok: true as const, message: intent === "accept" ? "採用しました" : "却下しました" }
    : { ok: false as const, message: "もう決まっています" };
}

export default function ProposalDetail({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, proposal, groups } = loaderData;
  const busy = useNavigation().state === "submitting";
  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <PageHeader
        title={proposal.summary}
        description={`${KIND_LABELS[proposal.kind]} → ${proposal.target}`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{STATUS_LABELS[proposal.status]}</Badge>
        <Text tone="muted">
          {proposal.origin}・Playbook {proposal.playbookVersion}
          {proposal.decisionReason ? `・理由: ${proposal.decisionReason}` : ""}
          {proposal.appliedPlaybookVersion ? `・適用 ${proposal.appliedPlaybookVersion}` : ""}
        </Text>
        <Link to="/playbook/proposals" className="ml-auto text-link text-sm">
          一覧へ
        </Link>
      </div>
      {actionData?.message ? (
        <Alert
          tone={actionData.ok ? "success" : "danger"}
          title={actionData.ok ? "完了" : "できませんでした"}
        >
          {actionData.message}
        </Alert>
      ) : null}
      <Card>
        <Stack>
          <Heading level={2} className="text-lg">
            観察
          </Heading>
          <Text>{proposal.observation}</Text>
          {groups.map((g) => (
            <div key={g.key} className="space-y-1">
              <Text tone="muted">
                {g.key}（{g.count} 件{g.recurring ? "、前のキャンペーンでも" : ""}）
              </Text>
              {g.examples.map((e) => (
                <div key={`${e.before}-${e.after}`} className="grid gap-2 text-sm md:grid-cols-2">
                  <pre className="whitespace-pre-wrap border border-border p-2">{e.before}</pre>
                  <pre className="whitespace-pre-wrap border border-border p-2">{e.after}</pre>
                </div>
              ))}
            </div>
          ))}
          <Heading level={3} className="text-base">
            内容
          </Heading>
          <pre className="whitespace-pre-wrap text-xs">
            {JSON.stringify(proposal.payload, null, 2)}
          </pre>
        </Stack>
      </Card>
      {proposal.status === "proposed" ? (
        <Card>
          <Form method="post">
            <Stack>
              <FormField label="理由" required>
                <Textarea name="reason" rows={2} />
              </FormField>
              <div className="flex gap-2">
                <Button type="submit" name="intent" value="accept" loading={busy}>
                  採用
                </Button>
                <Button type="submit" name="intent" value="reject" variant="outline" loading={busy}>
                  却下
                </Button>
              </div>
            </Stack>
          </Form>
        </Card>
      ) : null}
      {proposal.status === "accepted" ? (
        <Card>
          <Form method="post" className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <FormField label="反映した skills のコミット" description="feedback.mjs apply のあと">
              <Input name="version" />
            </FormField>
            <Button type="submit" name="intent" value="applied" variant="outline" loading={busy}>
              適用した
            </Button>
          </Form>
        </Card>
      ) : null}
    </AppLayout>
  );
}
