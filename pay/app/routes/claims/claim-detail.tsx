import { Form, Link } from "react-router";
import { Button } from "~/components/ui/button";
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
      <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
        <div>
          <p className="text-sm text-muted-foreground">
            <Link to={`/events/${event.id}`} className="hover:underline">
              {event.title}
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{claim.applicantName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            申請日 {claim.applicationDate} / {claim.kind === "proxy" ? "代行" : "本人"} /{" "}
            {formatYen(claim.totalAmount)}
          </p>
        </div>

        {actionData && "error" in actionData && actionData.error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {actionData.error}
          </p>
        ) : null}
        {actionData && "message" in actionData && actionData.message ? (
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100">
            {actionData.message}
          </p>
        ) : null}

        {canEdit ? <ReceiptUpload /> : null}

        <ClaimItems canEdit={canEdit} items={items} categories={categories} />

        {canEdit ? (
          <section className="flex flex-wrap gap-3 rounded-xl border p-5">
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
            <p className="w-full text-xs text-muted-foreground">
              Sheets/Drive
              共有は通知なしで自動実行されます。メールはボタンを押したときだけ送信されます。
              {claim.emailSentAt
                ? ` 最終送信: ${new Date(claim.emailSentAt * 1000).toLocaleString("ja-JP")}`
                : ""}
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
