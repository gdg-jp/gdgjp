import { Alert, Button, Card, PageHeader } from "@gdgjp/design-system";
import { Form, Link } from "react-router";
import { ClaimItems } from "~/features/claims/components/claim-items";
import { ReceiptUpload } from "~/features/claims/components/receipt-upload";
import { Header } from "~/layouts/header";

import { formatYen } from "~/features/claims/money";

import { actOnClaimDetail, loadClaimDetail } from "~/features/claims/detail.server";

import type { Route } from "./+types/claim-detail";

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.claim ? `${data.claim.applicantName} — Pay` : "Claim — Pay" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  return loadClaimDetail(context.cloudflare.env, request, params.id, params.claimId);
}

export async function action({ request, context, params }: Route.ActionArgs) {
  return actOnClaimDetail(context.cloudflare.env, request, params.id, params.claimId);
}

export default function ClaimDetailPage({ loaderData, actionData }: Route.ComponentProps) {
  const { user, event, claim, canEdit, items, categories } = loaderData;
  return (
    <div className="min-h-dvh bg-background">
      <Header user={{ name: user.name, email: user.email, image: user.image }} />
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:py-8">
        <PageHeader
          title={claim.applicantName}
          back={
            <Link to={`/events/${event.id}`} className="text-sm text-link hover:underline">
              {event.title}
            </Link>
          }
          description={
            <>
              申請日 {claim.applicationDate} / {claim.kind === "proxy" ? "代行" : "本人"} /{" "}
              {formatYen(claim.totalAmount)}
            </>
          }
        />

        {actionData && "error" in actionData && actionData.error ? (
          <Alert tone="danger" title={actionData.error} />
        ) : null}
        {actionData && "message" in actionData && actionData.message ? (
          <Alert tone="success" title={actionData.message} />
        ) : null}

        {canEdit ? <ReceiptUpload /> : null}

        <ClaimItems canEdit={canEdit} items={items} categories={categories} />

        {canEdit ? (
          <section aria-label="スプレッドシート連携">
            <Card className="flex flex-wrap gap-3">
              <Form method="post">
                <input type="hidden" name="intent" value="sync-sheets" />
                <Button type="submit">スプレッドシートに反映</Button>
              </Form>
              <Form method="post">
                <input type="hidden" name="intent" value="send-email" />
                <Button type="submit" variant="outline" disabled={!claim.sheetUrl}>
                  comm-support に確認メールを送る
                </Button>
              </Form>
              {claim.sheetUrl ? (
                <Button variant="ghost" asChild>
                  <a href={claim.sheetUrl} target="_blank" rel="noreferrer">
                    Sheets を開く
                  </a>
                </Button>
              ) : null}
              <p className="w-full text-xs text-muted">
                Sheets/Drive
                共有は通知なしで自動実行されます。メールはボタンを押したときだけ送信されます。
                {claim.emailSentAt
                  ? ` 最終送信: ${new Date(claim.emailSentAt * 1000).toLocaleString("ja-JP")}`
                  : ""}
              </p>
            </Card>
          </section>
        ) : null}
      </main>
    </div>
  );
}
