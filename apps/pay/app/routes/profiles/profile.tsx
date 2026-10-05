import { Alert, Button, Card, FormField, Input, PageHeader } from "@gdgjp/design-system";
import { Form, Link } from "react-router";
import { Header } from "~/layouts/header";

import { redirect } from "react-router";

import { requireMember } from "~/features/auth/session.server";
import { getProfile, upsertProfile } from "~/features/profiles/repository.server";
import type { Route } from "./+types/profile";

export function meta() {
  return [{ title: "口座情報 — GDG Japan Pay" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  const { user } = await requireMember(env, request);
  const profile = await getProfile(env.DB, env.TOKEN_ENCRYPTION_KEY, user.id);
  return {
    user,
    profile: profile
      ? {
          legalName: profile.legalName,
          bankName: profile.bank.bankName,
          branchName: profile.bank.branchName,
          accountType: profile.bank.accountType,
          accountNumber: profile.bank.accountNumber,
        }
      : null,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  const { user } = await requireMember(env, request);
  const form = await request.formData();
  const legalName = String(form.get("legalName") ?? "").trim();
  const bankName = String(form.get("bankName") ?? "").trim();
  const branchName = String(form.get("branchName") ?? "").trim();
  const accountType = String(form.get("accountType") ?? "普通").trim() || "普通";
  const accountNumber = String(form.get("accountNumber") ?? "").trim();
  if (!legalName || !bankName || !branchName || !accountNumber) {
    return { error: "すべての項目を入力してください" };
  }
  await upsertProfile(env.DB, env.TOKEN_ENCRYPTION_KEY, {
    userId: user.id,
    legalName,
    bank: { bankName, branchName, accountType, accountNumber },
  });
  return redirect("/profile?saved=1");
}

export default function ProfilePage({ loaderData, actionData }: Route.ComponentProps) {
  const { user, profile } = loaderData;
  return (
    <div className="min-h-dvh bg-background">
      <Header user={{ name: user.name, email: user.email, image: user.image }} />
      <main className="mx-auto max-w-xl space-y-6 px-4 py-6 sm:py-8">
        <PageHeader
          back={
            <Link to="/" className="text-sm text-link hover:underline">
              イベント一覧
            </Link>
          }
          title="本名・振込先口座"
          description={
            <> 経費精算スプレッドシートに転記される情報です。口座番号は暗号化して保存されます。 </>
          }
        />
        {actionData && "error" in actionData ? (
          <Alert tone="danger" title={actionData.error} />
        ) : null}
        <Card>
          <Form method="post" className="space-y-4">
            <FormField id="legalName" label="申請者氏名（本名）" required>
              <Input name="legalName" required defaultValue={profile?.legalName ?? ""} />
            </FormField>
            <FormField id="bankName" label="銀行名" required>
              <Input name="bankName" required defaultValue={profile?.bankName ?? ""} />
            </FormField>
            <FormField id="branchName" label="支店名" required>
              <Input name="branchName" required defaultValue={profile?.branchName ?? ""} />
            </FormField>
            <FormField id="accountType" label="口座種別">
              <Input name="accountType" defaultValue={profile?.accountType ?? "普通"} />
            </FormField>
            <FormField id="accountNumber" label="口座番号" required>
              <Input
                name="accountNumber"
                required
                inputMode="numeric"
                defaultValue={profile?.accountNumber ?? ""}
              />
            </FormField>
            <Button type="submit">保存する</Button>
          </Form>
        </Card>
      </main>
    </div>
  );
}
