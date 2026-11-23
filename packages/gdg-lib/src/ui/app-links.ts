export type GdgAppLink = {
  iconUrl: string;
  label: string;
  url: string;
};

const PRODUCTION_SITE = "gdgs.jp";

const SITE_APPS = [
  { subdomain: "url", label: "TinyURL" },
  { subdomain: "wiki", label: "Wiki" },
  { subdomain: "scheduler", label: "Scheduler" },
  { subdomain: "img", label: "Images" },
  { subdomain: "sns", label: "SNS Manager" },
  { subdomain: "connpass", label: "Connpass" },
  { subdomain: "pay", label: "Pay" },
] as const;

const EXTERNAL_APPS: readonly GdgAppLink[] = [
  {
    iconUrl: "https://raw.githubusercontent.com/gdg-jp/gdgjp/main/cli/icon.png",
    label: "CLI",
    url: "https://github.com/gdg-jp/gdgjp#gdg-cli",
  },
  {
    iconUrl: "https://learn.gdgs.jp/assets/learn-gdgs-icon.png",
    label: "Learn",
    url: "https://learn.gdgs.jp",
  },
];

export function gdgSiteDomain(accountsUrl: string | null | undefined): string {
  if (!accountsUrl) return PRODUCTION_SITE;
  let hostname: string;
  try {
    hostname = new URL(accountsUrl).hostname;
  } catch {
    return PRODUCTION_SITE;
  }
  const site = hostname.startsWith("accounts.") ? hostname.slice("accounts.".length) : "";
  return site === PRODUCTION_SITE || site.endsWith(`.${PRODUCTION_SITE}`) ? site : PRODUCTION_SITE;
}

export function gdgAppLinks(accountsUrl: string | null | undefined): readonly GdgAppLink[] {
  const site = gdgSiteDomain(accountsUrl);
  return [
    ...SITE_APPS.map(({ subdomain, label }) => ({
      iconUrl: `https://${subdomain}.${site}/app-icon.png`,
      label,
      url: `https://${subdomain}.${site}`,
    })),
    ...EXTERNAL_APPS,
  ];
}

export function gdgAccountSettingsUrl(accountsUrl: string | null | undefined): string {
  const base = accountsUrl
    ? accountsUrl.replace(/\/+$/, "")
    : `https://accounts.${PRODUCTION_SITE}`;
  return `${base}/dashboard`;
}
