import type { AuthUser } from "@gdgjp/gdg-lib";
import { Check, ShieldCheck, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, useActionData, useNavigation } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { SubmitButton } from "~/components/ui/submit-button";
import { buildSignInRedirect } from "~/lib/auth-redirect";
import { requireUser, runAuthHandler } from "~/lib/auth.server";
import {
  type PendingDeviceCode,
  approveDeviceCode,
  denyDeviceCode,
  findPendingDeviceCodeByUserCode,
} from "~/lib/device-authorization.server";
import { i18n } from "~/lib/i18n/i18n.server";
import { formatUserCode } from "~/lib/user-code";
import type { Route } from "./+types/device";

const KNOWN_SCOPES = new Set([
  "openid",
  "email",
  "profile",
  "offline_access",
  "https://gdgs.jp/scopes/chapters",
  "https://gdgs.jp/scopes/cli",
]);

export async function loader({ request, context }: Route.LoaderArgs) {
  const env = context.cloudflare.env;
  let user: AuthUser;
  try {
    user = await requireUser(env, request);
  } catch (error) {
    if (error instanceof Response && error.status === 401) throw buildSignInRedirect(request);
    throw error;
  }

  const t = await i18n.getFixedT(request);
  const userCode = new URL(request.url).searchParams.get("user_code") ?? "";
  const pending = userCode ? await findPendingDeviceCodeByUserCode(env, userCode) : null;
  return { user, userCode, pending, title: t("meta.device") };
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: data?.title }];
}

type ActionResult = { status: "approved" | "denied" | "failed" };

export async function action({ request, context }: Route.ActionArgs) {
  const env = context.cloudflare.env;
  let user: AuthUser;
  try {
    user = await requireUser(env, request);
  } catch (error) {
    if (error instanceof Response && error.status === 401) throw buildSignInRedirect(request);
    throw error;
  }

  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = form.get("intent");
  if (!id) return { status: "failed" } satisfies ActionResult;

  if (intent === "deny") {
    await denyDeviceCode(env, id);
    return { status: "denied" } satisfies ActionResult;
  }
  const approved = await approveDeviceCode(env, request, id, user.id, runAuthHandler);
  return { status: approved ? "approved" : "failed" } satisfies ActionResult;
}

export default function DevicePage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation();
  const actionData = useActionData<ActionResult>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state !== "idle";
  const submittedIntent = navigation.formData?.get("intent");

  return (
    <div className="relative min-h-dvh overflow-hidden bg-muted/40">
      <div className="pointer-events-none absolute -top-32 -right-32 size-[420px] rounded-full bg-gdg-blue/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-32 size-[420px] rounded-full bg-gdg-yellow/10 blur-3xl" />

      <div className="absolute top-4 right-4 flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <main className="relative grid min-h-dvh place-items-center px-4 py-10">
        <Card className="w-full max-w-lg shadow-sm">
          <CardHeader className="items-start gap-4 sm:flex-row">
            <GdgMark size="md" />
            <div className="min-w-0 space-y-2">
              <Badge variant="outline">{t("auth.device.eyebrow")}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <DeviceBody
              userCode={loaderData.userCode}
              pending={loaderData.pending}
              actionResult={actionData}
              isSubmitting={isSubmitting}
              submittedIntent={typeof submittedIntent === "string" ? submittedIntent : null}
            />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function DeviceBody({
  userCode,
  pending,
  actionResult,
  isSubmitting,
  submittedIntent,
}: {
  userCode: string;
  pending: PendingDeviceCode | null;
  actionResult: ActionResult | undefined;
  isSubmitting: boolean;
  submittedIntent: string | null;
}) {
  const { t } = useTranslation();

  if (actionResult?.status === "approved") {
    return (
      <div className="space-y-2 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-gdg-green/10 text-gdg-green">
          <Check className="size-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-medium tracking-tight">{t("auth.device.successTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("auth.device.successDescription")}</p>
      </div>
    );
  }

  if (actionResult?.status === "denied") {
    return (
      <div className="space-y-2 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <X className="size-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-medium tracking-tight">{t("auth.device.deniedTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("auth.device.deniedDescription")}</p>
      </div>
    );
  }

  if (!pending) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-medium tracking-tight">{t("auth.device.enterTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("auth.device.enterDescription")}</p>
        </div>
        {userCode ? (
          <p className="text-sm text-destructive">{t("auth.device.invalidCode")}</p>
        ) : null}
        <Form method="get" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="user_code">{t("auth.device.codeLabel")}</Label>
            <Input
              id="user_code"
              name="user_code"
              placeholder={t("auth.device.codePlaceholder")}
              autoComplete="off"
              autoCapitalize="characters"
              defaultValue={userCode}
              required
            />
          </div>
          <Button type="submit">{t("auth.device.submit")}</Button>
        </Form>
      </div>
    );
  }

  const scopes = pending.scope.split(/\s+/).filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-medium tracking-tight">
          {t("auth.device.confirmTitle", { appName: pending.clientName })}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("auth.device.confirmDescription")}</p>
        <p className="mt-2 font-mono text-sm">
          {t("auth.device.codeConfirm", { code: formatUserCode(userCode) })}
        </p>
      </div>

      {actionResult?.status === "failed" ? (
        <p className="text-sm text-destructive">{t("auth.device.approveFailed")}</p>
      ) : null}

      <section aria-labelledby="requested-permissions" className="space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-gdg-blue" aria-hidden="true" />
          <h2 id="requested-permissions" className="font-medium">
            {t("auth.device.permissions")}
          </h2>
        </div>
        <ul className="space-y-2">
          {scopes.length === 0 ? (
            <li className="rounded-lg border bg-muted/30 p-3 text-sm">
              {t("auth.device.noPermissions")}
            </li>
          ) : (
            scopes.map((scope) => (
              <li
                key={scope}
                className="flex items-start gap-3 rounded-lg border bg-card p-3 text-sm"
              >
                <Check className="mt-0.5 size-4 shrink-0 text-gdg-green" aria-hidden="true" />
                <span>{t(scopeLabelKey(scope))}</span>
              </li>
            ))
          )}
        </ul>
      </section>

      <Form method="post" className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <input type="hidden" name="id" value={pending.id} />
        <Button type="submit" name="intent" value="deny" variant="outline" disabled={isSubmitting}>
          <X className="size-4" />
          {t("auth.device.deny")}
        </Button>
        <SubmitButton
          name="intent"
          value="approve"
          pending={isSubmitting && submittedIntent === "approve"}
        >
          <Check className="size-4" />
          {t("auth.device.approve")}
        </SubmitButton>
      </Form>
    </div>
  );
}

function scopeLabelKey(scope: string): string {
  if (!KNOWN_SCOPES.has(scope)) return "auth.consent.scope.unknown";
  if (scope === "https://gdgs.jp/scopes/chapters") return "auth.consent.scope.chapters";
  if (scope === "https://gdgs.jp/scopes/cli") return "auth.device.cliScope";
  return `auth.consent.scope.${scope}`;
}
