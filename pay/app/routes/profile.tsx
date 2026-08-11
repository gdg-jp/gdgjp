import { Form, redirect } from "react-router";
import { Header } from "~/components/header";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { requireMember } from "~/lib/auth-redirect.server";
import { getProfile, upsertProfile } from "~/lib/db.server";
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
      <main className="mx-auto max-w-xl space-y-6 px-4 py-10">
        <div>
          <h1 className="text-2xl font-semibold">本名・振込先口座</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            経費精算スプレッドシートに転記される情報です。口座番号は暗号化して保存されます。
          </p>
        </div>
        {actionData && "error" in actionData ? (
          <p className="text-sm text-destructive">{actionData.error}</p>
        ) : null}
        <Form method="post" className="space-y-4 rounded-xl border p-5">
          <div className="space-y-2">
            <Label htmlFor="legalName">申請者氏名（本名）</Label>
            <Input
              id="legalName"
              name="legalName"
              required
              defaultValue={profile?.legalName ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="bankName">銀行名</Label>
            <Input id="bankName" name="bankName" required defaultValue={profile?.bankName ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="branchName">支店名</Label>
            <Input
              id="branchName"
              name="branchName"
              required
              defaultValue={profile?.branchName ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="accountType">口座種別</Label>
            <Input
              id="accountType"
              name="accountType"
              defaultValue={profile?.accountType ?? "普通"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="accountNumber">口座番号</Label>
            <Input
              id="accountNumber"
              name="accountNumber"
              required
              inputMode="numeric"
              defaultValue={profile?.accountNumber ?? ""}
            />
          </div>
          <Button type="submit">保存する</Button>
        </Form>
      </main>
    </div>
  );
}
