import { Check, Copy, Info } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

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
      <CardHeader>
        <CardTitle>{t("developerApps.access.title")}</CardTitle>
        <CardDescription>{t("developerApps.access.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/chapters">{t("developerApps.access.cta")}</Link>
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          {t("developerApps.access.signedInAs", { email: user.email })}
        </p>
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

export function DeveloperClientForm({ client }: { client?: DeveloperClientView }) {
  const { t } = useTranslation();
  const selected = new Set(client?.scopes ?? ["openid", "email", "profile"]);
  const optionalScopes = ["email", "profile", "offline_access", CHAPTERS_SCOPE] as const;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="name">{t("developerApps.fields.name")}</Label>
          <Input id="name" name="name" required maxLength={100} defaultValue={client?.name} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="appUrl">{t("developerApps.fields.appUrl")}</Label>
          <Input
            id="appUrl"
            name="appUrl"
            type="url"
            required
            placeholder="https://example.com"
            defaultValue={client?.appUrl ?? ""}
          />
        </div>
      </div>
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
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{t("developerApps.fields.scopes")}</legend>
        <p className="text-xs text-muted-foreground">
          {t("developerApps.fields.scopesDescription")}
        </p>
        <label className="flex items-start gap-3 rounded-md border p-3 opacity-75">
          <input type="checkbox" checked disabled className="mt-0.5 size-4" />
          <span>
            <span className="block font-mono text-sm">openid</span>
            <span className="text-xs text-muted-foreground">{t("developerApps.scope.openid")}</span>
          </span>
        </label>
        <input type="hidden" name="scopes" value="openid" />
        <div className="grid gap-2 sm:grid-cols-2">
          {optionalScopes.map((scope) => (
            <label key={scope} className="flex items-start gap-3 rounded-md border p-3">
              <input
                type="checkbox"
                name="scopes"
                value={scope}
                defaultChecked={selected.has(scope)}
                className="mt-0.5 size-4"
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
      <Alert>
        <Info />
        <AlertTitle>{t("developerApps.security.title")}</AlertTitle>
        <AlertDescription>{t("developerApps.security.description")}</AlertDescription>
      </Alert>
    </div>
  );
}

function UriListField({
  id,
  label,
  description,
  required,
  values,
}: { id: string; label: string; description: string; required?: boolean; values?: string[] }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <textarea
        id={id}
        name={id}
        required={required}
        rows={Math.max(3, values?.length ?? 0)}
        defaultValue={values?.join("\n")}
        className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
