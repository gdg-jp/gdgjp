import {
  Alert,
  Button,
  Card,
  Checkbox,
  FormField,
  Heading,
  IconButton,
  Icons,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
} from "@gdgjp/design-system";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { OptionalLabel, RequiredLabel, RequiredMark } from "./field-labels";
import { UriListField } from "./uri-list-field";

export const CHAPTERS_SCOPE = "https://gdgs.jp/scopes/chapters";

export type DeveloperClientView = {
  clientId: string;
  name: string;
  appUrl: string | null;
  redirectUris: string[];
  postLogoutRedirectUris: string[];
  scopes: string[];
  disabled: boolean;
  createdAt: Date | string | number;
  updatedAt?: Date | string | number;
};

export function DeveloperAccessRequired({ user }: { user: { email: string } }) {
  const { t } = useTranslation();
  return (
    <Card>
      <Stack align="start" className="gap-4 sm:flex-row">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-gdg-blue/10 text-gdg-blue">
          <Icons name="LockKeyhole" size={20} aria-hidden="true" />
        </div>
        <Stack className="gap-2">
          <Heading level={2}>{t("developerApps.access.title")}</Heading>
          <Text tone="muted">{t("developerApps.access.description")}</Text>
        </Stack>
      </Stack>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Text size="sm" tone="muted">
          {t("developerApps.access.signedInAs", { email: user.email })}
        </Text>
        <Button asChild>
          <Link to="/chapters">{t("developerApps.access.cta")}</Link>
        </Button>
      </div>
    </Card>
  );
}

export function ClientSecret({ clientId, secret }: { clientId: string; secret: string }) {
  const { t } = useTranslation();
  return (
    <Alert tone="warning" title={t("developerApps.secret.title")}>
      <Stack className="mt-2 gap-3">
        <Text>{t("developerApps.secret.description")}</Text>
        <SecretRow id="client-id" label={t("developerApps.fields.clientId")} value={clientId} />
        <SecretRow
          id="client-secret"
          label={t("developerApps.fields.clientSecret")}
          value={secret}
        />
      </Stack>
    </Alert>
  );
}

export function SecretRow({ id, label, value }: { id: string; label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <FormField id={id} label={label}>
      <div className="flex gap-2">
        <Input readOnly value={value} className="min-w-0 flex-1 font-mono text-xs" />
        <IconButton
          variant="outline"
          onClick={copy}
          aria-label={t("developerApps.copy", { label })}
        >
          <Icons name={copied ? "Check" : "Copy"} size={16} aria-hidden="true" />
        </IconButton>
      </div>
    </FormField>
  );
}

export function DeveloperClientForm({
  client,
  variant = "settings",
}: {
  client?: DeveloperClientView;
  variant?: "create" | "settings";
}) {
  const { t } = useTranslation();
  const selected = new Set(client?.scopes ?? ["openid", "email", "profile", CHAPTERS_SCOPE]);
  const optionalScopes = ["email", "profile", "offline_access", CHAPTERS_SCOPE] as const;

  if (variant === "create") {
    return (
      <div className="space-y-12">
        <section aria-labelledby="client-details-heading" className="space-y-6">
          <div>
            <Heading level={2} id="client-details-heading">
              {t("developerApps.create.basics")}
            </Heading>
            <Text size="sm" tone="muted">
              {t("developerApps.create.basicsDescription")}
            </Text>
          </div>
          <div className="space-y-5">
            <FormField
              id="applicationType"
              label={t("developerApps.fields.applicationType")}
              required
              description={t("developerApps.fields.applicationTypeDescription")}
            >
              <Select defaultValue="web">
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="web">{t("developerApps.fields.webApplication")}</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField
              id="name"
              label={t("developerApps.fields.name")}
              required
              description={t("developerApps.fields.nameDescription")}
            >
              <Input
                name="name"
                maxLength={100}
                autoComplete="off"
                placeholder={t("developerApps.fields.namePlaceholder")}
                defaultValue={client?.name}
                className="w-full"
              />
            </FormField>
            <FormField
              id="appUrl"
              label={t("developerApps.fields.appUrl")}
              required
              description={t("developerApps.fields.appUrlDescription")}
            >
              <Input
                name="appUrl"
                type="url"
                inputMode="url"
                placeholder="https://example.com"
                defaultValue={client?.appUrl ?? ""}
                className="w-full font-mono text-sm"
              />
            </FormField>
          </div>
        </section>

        <section aria-labelledby="redirect-uri-heading" className="space-y-7">
          <UriListField
            id="redirectUris"
            headingId="redirect-uri-heading"
            label={t("developerApps.fields.redirectUris")}
            description={t("developerApps.fields.redirectUrisDescription")}
            required
            spacious
            values={client?.redirectUris}
          />
          <UriListField
            id="postLogoutRedirectUris"
            label={t("developerApps.fields.postLogoutRedirectUris")}
            description={t("developerApps.fields.postLogoutRedirectUrisDescription")}
            spacious
            values={client?.postLogoutRedirectUris}
          />
        </section>

        <fieldset className="space-y-4">
          <div>
            <legend className="gdg-heading text-xl">{t("developerApps.create.permissions")}</legend>
            <Text size="sm" tone="muted">
              {t("developerApps.fields.scopesDescription")}
            </Text>
          </div>
          <input type="hidden" name="scopes" value="openid" />
          <div className="divide-y border-y">
            <div className="flex items-start gap-3 py-3.5">
              <Checkbox id="scope-openid-create" checked disabled />
              <span>
                <span className="block font-mono text-sm">openid</span>
                <span className="text-xs text-muted">{t("developerApps.scope.openid")}</span>
              </span>
            </div>
            {optionalScopes.map((scope) => (
              <label
                key={scope}
                htmlFor={`scope-${scope}`}
                className="flex cursor-pointer items-start gap-3 py-3.5"
              >
                <Checkbox
                  id={`scope-${scope}`}
                  name="scopes"
                  value={scope}
                  defaultChecked={selected.has(scope)}
                />
                <span>
                  <span className="block break-all font-mono text-sm">{scope}</span>
                  <span className="text-xs text-muted">
                    {t(`developerApps.scope.${scope === CHAPTERS_SCOPE ? "chapters" : scope}`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Alert tone="info" title={t("developerApps.security.title")}>
          {t("developerApps.security.description")}
        </Alert>
      </div>
    );
  }

  return (
    <div className="divide-y">
      <section
        aria-labelledby="app-basics-heading"
        className="developer-settings-section grid gap-5 pb-8 md:gap-8"
      >
        <div>
          <Heading level={2} id="app-basics-heading" className="text-lg">
            {t("developerApps.create.basics")}
          </Heading>
          <Text size="sm" tone="muted">
            {t("developerApps.create.basicsDescription")}
          </Text>
        </div>
        <div className="max-w-2xl space-y-5">
          <FormField
            id="applicationType"
            label={t("developerApps.fields.applicationType")}
            required
            description={t("developerApps.fields.applicationTypeDescription")}
          >
            <Input
              readOnly
              value={t("developerApps.fields.webApplication")}
              className="w-full bg-neutral"
            />
          </FormField>
          <FormField
            id="name"
            label={t("developerApps.fields.name")}
            required
            description={t("developerApps.fields.nameDescription")}
          >
            <Input name="name" maxLength={100} defaultValue={client?.name} className="w-full" />
          </FormField>
          <FormField
            id="appUrl"
            label={t("developerApps.fields.appUrl")}
            required
            description={t("developerApps.fields.appUrlDescription")}
          >
            <Input
              name="appUrl"
              type="url"
              placeholder="https://example.com"
              defaultValue={client?.appUrl ?? ""}
              className="w-full"
            />
          </FormField>
        </div>
      </section>

      <section
        aria-labelledby="app-redirects-heading"
        className="developer-settings-section grid gap-5 py-8 md:gap-8"
      >
        <div>
          <Heading level={2} id="app-redirects-heading" className="text-lg">
            {t("developerApps.create.redirects")}
          </Heading>
          <Text size="sm" tone="muted">
            {t("developerApps.create.redirectsDescription")}
          </Text>
        </div>
        <div className="max-w-2xl space-y-8">
          <UriListField
            id="redirectUris"
            label={t("developerApps.fields.redirectUris")}
            description={t("developerApps.fields.redirectUrisDescription")}
            required
            values={client?.redirectUris}
          />
          <UriListField
            id="postLogoutRedirectUris"
            label={t("developerApps.fields.postLogoutRedirectUris")}
            description={t("developerApps.fields.postLogoutRedirectUrisDescription")}
            values={client?.postLogoutRedirectUris}
          />
        </div>
      </section>

      <fieldset className="developer-settings-section grid gap-5 py-8 md:gap-8">
        <div>
          <legend className="gdg-heading text-lg">{t("developerApps.create.permissions")}</legend>
          <Text size="sm" tone="muted">
            {t("developerApps.fields.scopesDescription")}
          </Text>
        </div>
        <div className="max-w-2xl space-y-3">
          <div className="flex items-start gap-3 rounded-md border border-border bg-neutral p-3 opacity-80">
            <Checkbox id="scope-openid-settings" checked disabled />
            <span>
              <span className="block font-mono text-sm">openid</span>
              <span className="text-xs text-muted">{t("developerApps.scope.openid")}</span>
            </span>
          </div>
          <input type="hidden" name="scopes" value="openid" />
          <div className="grid gap-2 sm:grid-cols-2">
            {optionalScopes.map((scope) => (
              <label
                key={scope}
                htmlFor={`settings-scope-${scope}`}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-neutral"
              >
                <Checkbox
                  id={`settings-scope-${scope}`}
                  name="scopes"
                  value={scope}
                  defaultChecked={selected.has(scope)}
                />
                <span>
                  <span className="block break-all font-mono text-sm">{scope}</span>
                  <span className="text-xs text-muted">
                    {t(`developerApps.scope.${scope === CHAPTERS_SCOPE ? "chapters" : scope}`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <div className="pt-8">
        <Alert
          tone="info"
          title={t("developerApps.security.title")}
          className="developer-settings-alert max-w-2xl"
        >
          {t("developerApps.security.description")}
        </Alert>
      </div>
    </div>
  );
}
