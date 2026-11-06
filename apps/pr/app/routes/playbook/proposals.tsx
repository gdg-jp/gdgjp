import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  Input,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  Textarea,
} from "@gdgjp/design-system";
import { Form, Link, useNavigation } from "react-router";
import { requireOrganizer } from "~/features/learning/access.server";
import {
  KIND_LABELS,
  PROPOSAL_KINDS,
  type ProposalKind,
  STATUS_LABELS,
} from "~/features/learning/proposal";
import { insertProposal, listProposals } from "~/features/learning/proposal.repository.server";
import { PLAYBOOK_VERSION } from "~/features/playbook/playbook";
import { AppLayout } from "~/layouts/AppLayout";
import type { Route } from "./+types/proposals";

export function meta() {
  return [{ title: "Playbook の提案 — GDG PR" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user, chapters, chapterIds } = await requireOrganizer(env, request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const kind = url.searchParams.get("kind") ?? undefined;
  return {
    user: { name: user.name, email: user.email, image: user.image },
    accountsUrl: env.ACCOUNTS_URL,
    chapters: chapters
      .filter((c) => chapterIds.includes(c.chapterId))
      .map((c) => ({ id: c.chapterId, slug: c.chapterSlug })),
    proposals: (await listProposals(env.DB, chapterIds, { status, kind })).map((p) => ({
      id: p.id,
      kind: p.kind,
      status: p.status,
      origin: p.origin,
      summary: p.summary,
      target: p.target,
      evidence: Object.values(p.evidence).flat().length,
      playbookVersion: p.playbookVersion,
    })),
    filter: { status: status ?? "", kind: kind ?? "" },
  };
}

/** "Tips を追加": what the user teaches, kept as said (Claude Code shapes it when writing back). */
export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { chapterIds } = await requireOrganizer(env, request);
  const form = await request.formData();
  const chapterId = Number(form.get("chapter"));
  const kind = String(form.get("kind")) as ProposalKind;
  const observation = String(form.get("observation") ?? "").trim();
  if (!chapterIds.includes(chapterId) || !PROPOSAL_KINDS.includes(kind) || !observation)
    return { ok: false as const, message: "チャプター・種類・内容を入れてください" };
  await insertProposal(env.DB, {
    chapterId,
    campaignId: null,
    origin: "human",
    kind,
    target:
      String(form.get("target") ?? "").trim() ||
      (kind === "constant" ? "constants.json" : kind === "rule" ? "rules.json" : "guides/"),
    summary: observation.split("\n")[0]?.slice(0, 80) ?? observation,
    observation,
    evidence: {},
    payload: {},
    playbookVersion: PLAYBOOK_VERSION,
  });
  return { ok: true as const, message: "Tips を提案に足しました" };
}

export default function Proposals({ loaderData, actionData }: Route.ComponentProps) {
  const { user, accountsUrl, chapters, proposals, filter } = loaderData;
  const busy = useNavigation().state === "submitting";
  return (
    <AppLayout user={user} accountsUrl={accountsUrl}>
      <PageHeader
        title="Playbook の提案"
        description="振り返り・分析・人から出た提案。採用したものを書き出して skills に反映します"
      />
      {actionData?.message ? (
        <Alert
          tone={actionData.ok ? "success" : "danger"}
          title={actionData.ok ? "保存しました" : "保存できませんでした"}
        >
          {actionData.message}
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {["", "proposed", "accepted", "rejected", "applied"].map((s) => (
          <Link
            key={s || "all"}
            to={s ? `?status=${s}` : "?"}
            className={`rounded-md border border-border px-2 py-1 ${filter.status === s ? "bg-selected" : ""}`}
          >
            {s ? STATUS_LABELS[s as keyof typeof STATUS_LABELS] : "すべて"}
          </Link>
        ))}
        <a href="/playbook/proposals/export" className="ml-auto text-link">
          採用した提案を書き出す（JSON）
        </a>
      </div>
      {proposals.length === 0 ? (
        <Card>
          <EmptyState title="提案はありません" description="振り返りか、下の Tips から足せます。" />
        </Card>
      ) : (
        <Card>
          <ul className="space-y-2" aria-label="提案">
            {proposals.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge tone="neutral">{KIND_LABELS[p.kind]}</Badge>
                <Badge
                  tone={
                    p.status === "accepted" || p.status === "applied"
                      ? "success"
                      : p.status === "rejected"
                        ? "danger"
                        : "warning"
                  }
                >
                  {STATUS_LABELS[p.status]}
                </Badge>
                <Link to={`/playbook/proposals/${p.id}`} className="text-link">
                  {p.summary}
                </Link>
                <Text tone="muted">
                  {p.target}・根拠 {p.evidence}・{p.origin}・Playbook {p.playbookVersion}
                </Text>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <Form method="post">
          <Stack>
            <FormField
              label="Tips を追加"
              description="気づいたことをそのまま。書き戻すときに形にします"
            >
              <Textarea name="observation" rows={3} />
            </FormField>
            <div className="grid gap-3 md:grid-cols-3">
              <FormField label="チャプター">
                <Select name="chapter" defaultValue={String(chapters[0]?.id ?? "")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {chapters.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.slug}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="種類">
                <Select name="kind" defaultValue="guide">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROPOSAL_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="対象" description="例: guides/x.md">
                <Input name="target" />
              </FormField>
            </div>
            <div>
              <Button type="submit" loading={busy}>
                提案に足す
              </Button>
            </div>
          </Stack>
        </Form>
      </Card>
    </AppLayout>
  );
}
