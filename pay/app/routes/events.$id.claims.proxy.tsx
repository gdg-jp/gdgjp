import { Form, redirect } from "react-router";
import { Header } from "~/components/header";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { canProxyForEvent, requireMember } from "~/lib/auth-redirect.server";
import { createClaim, getEvent } from "~/lib/db.server";
import { isEventId } from "~/lib/id";
import { todayJstDate } from "~/lib/money";
import type { Route } from "./+types/events.$id.claims.proxy";

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
      <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold">代行登録</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {event.title} でアプリを使わない担当者分の経費を登録します。
          </p>
        </div>
        {actionData && "error" in actionData ? (
          <p className="text-sm text-destructive">{actionData.error}</p>
        ) : null}
        <Form method="post" className="space-y-4 rounded-xl border p-5">
          <div className="space-y-2">
            <Label htmlFor="applicantName">申請者氏名</Label>
            <Input id="applicantName" name="applicantName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bankName">銀行名</Label>
            <Input id="bankName" name="bankName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branchName">支店名</Label>
            <Input id="branchName" name="branchName" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="accountType">口座種別</Label>
            <Input id="accountType" name="accountType" defaultValue="普通" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="accountNumber">口座番号</Label>
            <Input id="accountNumber" name="accountNumber" required inputMode="numeric" />
          </div>
          <Button type="submit">申請を作成する</Button>
        </Form>
      </main>
    </div>
  );
}
