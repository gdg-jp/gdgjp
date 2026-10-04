import { Alert, Button, FormField, Heading, Icons, Input, Stack, Text } from "@gdgjp/ui";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";
import type { PendingDeviceCode } from "~/features/oauth/device-authorization.server";
import type { ActionResult } from "~/features/oauth/device-shared";
import { formatUserCode } from "~/features/oauth/user-code";

export const KNOWN_SCOPES = new Set([
  "openid",
  "email",
  "profile",
  "offline_access",
  "https://gdgs.jp/scopes/chapters",
  "https://gdgs.jp/scopes/cli",
]);

export function DeviceBody({
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

export function scopeLabelKey(scope: string): string {
  if (!KNOWN_SCOPES.has(scope)) return "auth.consent.scope.unknown";
  if (scope === "https://gdgs.jp/scopes/chapters") return "auth.consent.scope.chapters";
  if (scope === "https://gdgs.jp/scopes/cli") return "auth.device.cliScope";
  return `auth.consent.scope.${scope}`;
}
