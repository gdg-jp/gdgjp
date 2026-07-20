import { Check, Copy, Info, LockKeyhole, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

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
    <Card className="border-dashed">
      <CardHeader className="items-start gap-4 sm:flex-row">
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-gdg-blue/10 text-gdg-blue">
          <LockKeyhole className="size-5" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <CardTitle>{t("developerApps.access.title")}</CardTitle>
          <CardDescription>{t("developerApps.access.description")}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("developerApps.access.signedInAs", { email: user.email })}
        </p>
        <Button asChild>
          <Link to="/chapters">{t("developerApps.access.cta")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ClientSecret({ clientId, secret }: { clientId: string; secret: string }) {
  const { t } = useTranslation();
  return (
    <Alert className="border-gdg-yellow/50 bg-gdg-yellow/10">
      <Info />
      <AlertTitle>{t("developerApps.secret.title")}</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>{t("developerApps.secret.description")}</p>
        <SecretRow label={t("developerApps.fields.clientId")} value={clientId} />
        <SecretRow label={t("developerApps.fields.clientSecret")} value={secret} />
      </AlertDescription>
    </Alert>
  );
}

export function SecretRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={copy}
          aria-label={t("developerApps.copy", { label })}
        >
          {copied ? <Check className="size-4 text-gdg-green" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
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
  const selected = new Set(client?.scopes ?? ["openid", "email", "profile"]);
  const optionalScopes = ["email", "profile", "offline_access", CHAPTERS_SCOPE] as const;

  if (variant === "create") {
    return (
      <div className="space-y-12">
        <section aria-labelledby="client-details-heading" className="space-y-6">
          <div>
            <h2 id="client-details-heading" className="text-xl font-medium tracking-tight">
              {t("developerApps.create.basics")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("developerApps.create.basicsDescription")}
            </p>
          </div>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="applicationType">
                {t("developerApps.fields.applicationType")} <RequiredMark />
              </Label>
              <Select defaultValue="web">
                <SelectTrigger id="applicationType" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="web">{t("developerApps.fields.webApplication")}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("developerApps.fields.applicationTypeDescription")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">
                {t("developerApps.fields.name")} <RequiredMark />
              </Label>
              <Input
                id="name"
                name="name"
                required
                maxLength={100}
                autoComplete="off"
                placeholder={t("developerApps.fields.namePlaceholder")}
                defaultValue={client?.name}
                className="h-10"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("developerApps.fields.nameDescription")}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="appUrl">
                {t("developerApps.fields.appUrl")} <RequiredMark />
              </Label>
              <Input
                id="appUrl"
                name="appUrl"
                type="url"
                inputMode="url"
                required
                placeholder="https://example.com"
                defaultValue={client?.appUrl ?? ""}
                className="h-10 font-mono text-sm"
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("developerApps.fields.appUrlDescription")}
              </p>
            </div>
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
            <legend className="text-xl font-medium tracking-tight">
              {t("developerApps.create.permissions")}
            </legend>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              {t("developerApps.fields.scopesDescription")}
            </p>
          </div>
          <input type="hidden" name="scopes" value="openid" />
          <div className="divide-y border-y">
            <div className="flex items-start gap-3 py-3.5">
              <input type="checkbox" checked disabled className="mt-0.5 size-4 accent-primary" />
              <span>
                <span className="block font-mono text-sm">openid</span>
                <span className="text-xs text-muted-foreground">
                  {t("developerApps.scope.openid")}
                </span>
              </span>
            </div>
            {optionalScopes.map((scope) => (
              <label key={scope} className="flex cursor-pointer items-start gap-3 py-3.5">
                <input
                  type="checkbox"
                  name="scopes"
                  value={scope}
                  defaultChecked={selected.has(scope)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  <span className="block break-all font-mono text-sm">{scope}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(`developerApps.scope.${scope === CHAPTERS_SCOPE ? "chapters" : scope}`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex gap-3 rounded-md bg-muted/70 px-4 py-3 text-sm">
          <ShieldCheck
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium">{t("developerApps.security.title")}</p>
            <p className="mt-0.5 leading-relaxed text-muted-foreground">
              {t("developerApps.security.description")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="divide-y">
      <section
        aria-labelledby="app-basics-heading"
        className="grid gap-5 pb-8 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8"
      >
        <div>
          <h2 id="app-basics-heading" className="text-lg font-medium">
            {t("developerApps.create.basics")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("developerApps.create.basicsDescription")}
          </p>
        </div>
        <div className="max-w-2xl space-y-5">
          <div className="space-y-2">
            <Label htmlFor="applicationType">
              {t("developerApps.fields.applicationType")} <RequiredLabel />
            </Label>
            <Input
              id="applicationType"
              readOnly
              value={t("developerApps.fields.webApplication")}
              className="bg-muted/40"
            />
            <p className="text-xs text-muted-foreground">
              {t("developerApps.fields.applicationTypeDescription")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="name">
              {t("developerApps.fields.name")} <RequiredLabel />
            </Label>
            <Input id="name" name="name" required maxLength={100} defaultValue={client?.name} />
            <p className="text-xs text-muted-foreground">
              {t("developerApps.fields.nameDescription")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="appUrl">
              {t("developerApps.fields.appUrl")} <RequiredLabel />
            </Label>
            <Input
              id="appUrl"
              name="appUrl"
              type="url"
              required
              placeholder="https://example.com"
              defaultValue={client?.appUrl ?? ""}
            />
            <p className="text-xs text-muted-foreground">
              {t("developerApps.fields.appUrlDescription")}
            </p>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="app-redirects-heading"
        className="grid gap-5 py-8 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8"
      >
        <div>
          <h2 id="app-redirects-heading" className="text-lg font-medium">
            {t("developerApps.create.redirects")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("developerApps.create.redirectsDescription")}
          </p>
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

      <fieldset className="grid gap-5 py-8 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8">
        <div>
          <legend className="text-lg font-medium">{t("developerApps.create.permissions")}</legend>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("developerApps.fields.scopesDescription")}
          </p>
        </div>
        <div className="max-w-2xl space-y-3">
          <label className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3 opacity-80">
            <input type="checkbox" checked disabled className="mt-0.5 size-4" />
            <span>
              <span className="block font-mono text-sm">openid</span>
              <span className="text-xs text-muted-foreground">
                {t("developerApps.scope.openid")}
              </span>
            </span>
          </label>
          <input type="hidden" name="scopes" value="openid" />
          <div className="grid gap-2 sm:grid-cols-2">
            {optionalScopes.map((scope) => (
              <label
                key={scope}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
              >
                <input
                  type="checkbox"
                  name="scopes"
                  value={scope}
                  defaultChecked={selected.has(scope)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  <span className="block break-all font-mono text-sm">{scope}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(`developerApps.scope.${scope === CHAPTERS_SCOPE ? "chapters" : scope}`)}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      <div className="pt-8">
        <Alert className="max-w-2xl md:ml-[15rem]">
          <ShieldCheck />
          <AlertTitle>{t("developerApps.security.title")}</AlertTitle>
          <AlertDescription>{t("developerApps.security.description")}</AlertDescription>
        </Alert>
      </div>
    </div>
  );
}

function UriListField({
  id,
  headingId,
  label,
  description,
  required,
  spacious = false,
  values,
}: {
  id: string;
  headingId?: string;
  label: string;
  description: string;
  required?: boolean;
  spacious?: boolean;
  values?: string[];
}) {
  const { t } = useTranslation();
  const nextEntryId = useRef(0);
  const [entries, setEntries] = useState(() =>
    (values && values.length > 0 ? values : required ? [""] : []).map((value, index) => ({
      key: `${id}-initial-${index}`,
      value,
    })),
  );

  function updateEntry(index: number, value: string) {
    setEntries((current) =>
      current.map((entry, entryIndex) => (entryIndex === index ? { ...entry, value } : entry)),
    );
  }

  function removeEntry(index: number) {
    setEntries((current) => current.filter((_, entryIndex) => entryIndex !== index));
  }

  return (
    <div className={spacious ? "space-y-4" : "space-y-3"}>
      <div>
        <Label
          asChild={spacious}
          className={spacious ? "text-xl font-medium tracking-tight" : undefined}
        >
          {spacious ? (
            <h2 id={headingId}>
              {label} {required ? <RequiredMark /> : null}
            </h2>
          ) : (
            <span>
              {label} {required ? <RequiredLabel /> : <OptionalLabel />}
            </span>
          )}
        </Label>
        <p
          className={
            spacious
              ? "mt-1 text-sm leading-relaxed text-muted-foreground"
              : "mt-2 text-xs text-muted-foreground"
          }
        >
          {description}
        </p>
      </div>
      <div className="space-y-2">
        {entries.map((entry, index) => (
          <div key={entry.key} className="flex gap-2">
            <Input
              id={`${id}-${index}`}
              name={id}
              type="url"
              required={required}
              value={entry.value}
              onChange={(event) => updateEntry(index, event.target.value)}
              placeholder="https://example.com/callback"
              className={spacious ? "h-10 font-mono text-sm" : "font-mono text-sm"}
            />
            <Button
              type="button"
              variant={spacious ? "outline" : "ghost"}
              size="icon"
              disabled={required && entries.length === 1}
              onClick={() => removeEntry(index)}
              aria-label={t("developerApps.form.removeUri", { index: index + 1 })}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={entries.length >= 10}
        onClick={() =>
          setEntries((current) => [
            ...current,
            { key: `${id}-added-${nextEntryId.current++}`, value: "" },
          ])
        }
      >
        <Plus className="size-4" />
        {t("developerApps.form.addUri")}
      </Button>
    </div>
  );
}

function RequiredLabel() {
  const { t } = useTranslation();
  return (
    <span className="text-xs font-normal text-muted-foreground">
      ({t("developerApps.form.required")})
    </span>
  );
}

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden="true">
      *
    </span>
  );
}

function OptionalLabel() {
  const { t } = useTranslation();
  return (
    <span className="text-xs font-normal text-muted-foreground">
      ({t("developerApps.form.optional")})
    </span>
  );
}
