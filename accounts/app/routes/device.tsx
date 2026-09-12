import type { AuthUser } from "@gdgjp/gdg-lib";
import {
  Alert,
  Badge,
  Button,
  Card,
  FormField,
  Heading,
  Icons,
  Input,
  Stack,
  Text,
} from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Form, useActionData, useNavigation } from "react-router";
import { GdgMark } from "~/components/gdg-mark";
import { LocaleSwitcher } from "~/components/locale-switcher";
import { ThemeToggle } from "~/components/theme-toggle";
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
    <div className="min-h-dvh bg-background">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <main className="grid min-h-dvh place-items-center px-4 py-10">
        <Card className="w-full max-w-lg">
          <Stack align="start" className="gap-4 sm:flex-row">
            <GdgMark size="md" />
            <Badge tone="info">{t("auth.device.eyebrow")}</Badge>
          </Stack>
          <div className="mt-6">
            <DeviceBody
              userCode={loaderData.userCode}
              pending={loaderData.pending}
              actionResult={actionData}
              isSubmitting={isSubmitting}
              submittedIntent={typeof submittedIntent === "string" ? submittedIntent : null}
            />
          </div>
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
      <Stack align="center" className="text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-gdg-green/10 text-gdg-green">
          <Icons name="Check" size={24} aria-hidden="true" />
        </div>
        <Heading level={1}>{t("auth.device.successTitle")}</Heading>
        <Text size="sm" tone="muted">
          {t("auth.device.successDescription")}
        </Text>
      </Stack>
    );
  }

  if (actionResult?.status === "denied") {
    return (
      <Stack align="center" className="text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-neutral text-muted">
          <Icons name="X" size={24} aria-hidden="true" />
        </div>
        <Heading level={1}>{t("auth.device.deniedTitle")}</Heading>
        <Text size="sm" tone="muted">
          {t("auth.device.deniedDescription")}
        </Text>
      </Stack>
    );
  }

  if (!pending) {
    return (
      <Stack>
        <div>
          <Heading level={1}>{t("auth.device.enterTitle")}</Heading>
          <Text size="sm" tone="muted">
            {t("auth.device.enterDescription")}
          </Text>
        </div>
        {userCode ? <Alert tone="danger" title={t("auth.device.invalidCode")} /> : null}
        <Form method="get" className="space-y-4">
          <FormField id="user_code" label={t("auth.device.codeLabel")} required>
            <Input
              id="user_code"
              name="user_code"
              placeholder={t("auth.device.codePlaceholder")}
              autoComplete="off"
              autoCapitalize="characters"
              defaultValue={userCode}
              required
              className="w-full"
            />
          </FormField>
          <Button type="submit">{t("auth.device.submit")}</Button>
        </Form>
      </Stack>
    );
  }

  const scopes = pending.scope.split(/\s+/).filter(Boolean);

  return (
    <Stack>
      <div>
        <Heading level={1}>
          {t("auth.device.confirmTitle", { appName: pending.clientName })}
        </Heading>
        <Text size="sm" tone="muted">
          {t("auth.device.confirmDescription")}
        </Text>
        <Text size="sm" className="mt-2 font-mono">
          {t("auth.device.codeConfirm", { code: formatUserCode(userCode) })}
        </Text>
      </div>

      {actionResult?.status === "failed" ? (
        <Alert tone="danger" title={t("auth.device.approveFailed")} />
      ) : null}

      <section aria-labelledby="requested-permissions">
        <div className="flex items-center gap-2">
          <Icons name="ShieldCheck" size={16} aria-hidden="true" />
          <Heading level={2} id="requested-permissions" className="text-base">
            {t("auth.device.permissions")}
          </Heading>
        </div>
        <ul className="mt-3 space-y-2">
          {scopes.length === 0 ? (
            <li className="rounded-md border border-border bg-background p-3 text-sm">
              {t("auth.device.noPermissions")}
            </li>
          ) : (
            scopes.map((scope) => (
              <li
                key={scope}
                className="flex items-start gap-3 rounded-md border border-border bg-surface p-3 text-sm"
              >
                <Icons name="Check" size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{t(scopeLabelKey(scope))}</span>
              </li>
            ))
          )}
        </ul>
      </section>

      <Form method="post" className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <input type="hidden" name="id" value={pending.id} />
        <Button
          type="submit"
          name="intent"
          value="deny"
          variant="outline"
          disabled={isSubmitting}
          loading={isSubmitting && submittedIntent === "deny"}
        >
          <Icons name="X" size={16} aria-hidden="true" />
          {t("auth.device.deny")}
        </Button>
        <Button
          type="submit"
          name="intent"
          value="approve"
          disabled={isSubmitting}
          loading={isSubmitting && submittedIntent === "approve"}
        >
          <Icons name="Check" size={16} aria-hidden="true" />
          {t("auth.device.approve")}
        </Button>
      </Form>
    </Stack>
  );
}

function scopeLabelKey(scope: string): string {
  if (!KNOWN_SCOPES.has(scope)) return "auth.consent.scope.unknown";
  if (scope === "https://gdgs.jp/scopes/chapters") return "auth.consent.scope.chapters";
  if (scope === "https://gdgs.jp/scopes/cli") return "auth.device.cliScope";
  return `auth.consent.scope.${scope}`;
}
