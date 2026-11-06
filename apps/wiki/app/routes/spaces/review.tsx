import { Badge, Button, Card, EmptyState, PageHeader } from "@gdgjp/design-system";
import { useTranslation } from "react-i18next";
import { Form, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs, MetaFunction } from "react-router";
import { requireUser } from "~/features/auth/utils.server";
import { requireSpace } from "~/features/spaces/access.server";
import { listOpenReviewFlags, resolveReviewFlag } from "~/features/spaces/review.server";
import { getDb } from "~/lib/db.server";

export const meta: MetaFunction = () => [{ title: "Review — GDG Japan Wiki" }];

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const { space } = await requireSpace(request, env, params.space, "editor");
  const flags = await listOpenReviewFlags(getDb(env), space.id);
  // Payloads can quote restricted source text; this list shows kind and target only.
  // Kind-specific detail views (Stage 04) re-run the inner ACL before showing payloads.
  return {
    space: { slug: space.slug, name: space.name },
    flags: flags.map((flag) => ({
      id: flag.id,
      kind: flag.kind,
      targetType: flag.targetType,
      targetId: flag.targetId,
      createdAt: flag.createdAt,
    })),
  };
}

export async function action({ request, context, params }: ActionFunctionArgs) {
  const { env } = context.cloudflare;
  const user = await requireUser(request, env);
  const { space } = await requireSpace(request, env, params.space, "editor");
  const form = await request.formData();
  if (form.get("intent") !== "resolve") return { error: "unknown_intent" };
  const ok = await resolveReviewFlag(getDb(env), space.id, String(form.get("flagId")), user.id);
  return ok ? { ok: true } : { error: "not_found" };
}

export default function SpaceReviewPage() {
  const { space, flags } = useLoaderData<typeof loader>();
  const { t, i18n } = useTranslation();
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8">
      <PageHeader title={t("spaces.review_title", { name: space.name })} />
      {flags.length === 0 ? (
        <EmptyState title={t("spaces.review_empty")} />
      ) : (
        <ul className="flex flex-col gap-2">
          {flags.map((flag) => (
            <li key={flag.id}>
              <Card className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <Badge tone="warning">
                    {t(`spaces.flag.${flag.kind}`, { defaultValue: flag.kind })}
                  </Badge>
                  <p className="mt-1 truncate text-sm text-muted">
                    {flag.targetType}: {flag.targetId} ·{" "}
                    {new Date(flag.createdAt).toLocaleString(i18n.language)}
                  </p>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="resolve" />
                  <input type="hidden" name="flagId" value={flag.id} />
                  <Button type="submit" size="sm" variant="secondary">
                    {t("spaces.resolve")}
                  </Button>
                </Form>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
