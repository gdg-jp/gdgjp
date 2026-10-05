import { Alert, Button, Card, FormField, Input, PageHeader } from "@gdgjp/design-system";
import { Form, Link } from "react-router";
import { Header } from "~/layouts/header";

import { redirect } from "react-router";

import { requireMember } from "~/features/auth/session.server";
import { todayJstDate } from "~/features/claims/money";
import { createClaim } from "~/features/claims/repository.server";
import { canProxyForEvent } from "~/features/events/permissions";
import { getEvent } from "~/features/events/repository.server";
import { isEventId } from "~/lib/id";
import type { Route } from "./+types/proxy-claim";

export function meta() {
  return [{ title: "代行登録 — GDG Japan Pay" }];
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  if (!isEventId(params.id)) throw new Response("Not Found", { status: 404 });
  const { user, chapters } = await requireMember(env, request);
  const event = await getEvent(env.DB, params.id);
  if (!event) throw new Response("Not Found", { status: 404 });
  if (!canProxyForEvent({ userId: user.id, chapters }, event)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return { user, event };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  if (!isEventId(params.id)) throw new Response("Not Found", { status: 404 });
  const { user, chapters } = await requireMember(env, request);
  const event = await getEvent(env.DB, params.id);
  if (!event) throw new Response("Not Found", { status: 404 });
  if (!canProxyForEvent({ userId: user.id, chapters }, event)) {
    throw new Response("Forbidden", { status: 403 });
  }
  const form = await request.formData();
  const applicantName = String(form.get("applicantName") ?? "").trim();
  const bankName = String(form.get("bankName") ?? "").trim();
  const branchName = String(form.get("branchName") ?? "").trim();
  const accountType = String(form.get("accountType") ?? "普通").trim() || "普通";
  const accountNumber = String(form.get("accountNumber") ?? "").trim();
  if (!applicantName || !bankName || !branchName || !accountNumber) {
    return { error: "すべての項目を入力してください" };
  }
  const claim = await createClaim(env.DB, env.TOKEN_ENCRYPTION_KEY, {
    eventId: event.id,
    kind: "proxy",
    userId: null,
    applicantName,
    bank: { bankName, branchName, accountType, accountNumber },
    applicationDate: todayJstDate(),
    createdBy: user.id,
  });
  return redirect(`/events/${event.id}/claims/${claim.id}`);
}

export default function ProxyClaimPage({ loaderData, actionData }: Route.ComponentProps) {
  const { user, event } = loaderData;
  return (
    <div className="min-h-dvh bg-background">
      <Header user={{ name: user.name, email: user.email, image: user.image }} />
      <main className="mx-auto max-w-xl space-y-6 px-4 py-6 sm:py-8">
        <PageHeader
          back={
            <Link to={`/events/${event.id}`} className="text-sm text-link hover:underline">
              {event.title}
            </Link>
          }
          title="代行登録"
          description={<> {event.title} でアプリを使わない担当者分の経費を登録します。 </>}
        />
        {actionData && "error" in actionData ? (
          <Alert tone="danger" title={actionData.error} />
        ) : null}
        <Card>
          <Form method="post" className="space-y-4">
            <FormField id="applicantName" label="申請者氏名" required>
              <Input name="applicantName" required />
            </FormField>
            <FormField id="bankName" label="銀行名" required>
              <Input name="bankName" required />
            </FormField>
            <FormField id="branchName" label="支店名" required>
              <Input name="branchName" required />
            </FormField>
            <FormField id="accountType" label="口座種別">
              <Input name="accountType" defaultValue="普通" />
            </FormField>
            <FormField id="accountNumber" label="口座番号" required>
              <Input name="accountNumber" required inputMode="numeric" />
            </FormField>
            <Button type="submit">申請を作成する</Button>
          </Form>
        </Card>
      </main>
    </div>
  );
}
