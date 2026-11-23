const PROD_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "canary.discord.com",
  "ptb.discord.com",
]);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function isWebhookUrl(raw: string, development: boolean): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (development && url.protocol === "http:" && LOOPBACK.has(url.hostname)) return true;
  return (
    url.protocol === "https:" &&
    PROD_HOSTS.has(url.hostname) &&
    /^\/api\/webhooks\/\d+\/[\w-]+$/.test(url.pathname)
  );
}

export function maskWebhook(raw: string): string {
  try {
    const url = new URL(raw);
    const id = url.pathname.split("/")[3] ?? "";
    return `${url.host}/api/webhooks/${id.slice(0, 4)}…/••••`;
  } catch {
    return "••••";
  }
}

export function renderTemplate(template: string, vars: Record<string, string | null | undefined>) {
  return template
    .replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const MAX_CONTENT = 2000;

export function discordBody(content: string) {
  const text = content.length > MAX_CONTENT ? `${content.slice(0, MAX_CONTENT - 1)}…` : content;
  return { content: text, allowed_mentions: { parse: [] as string[] } };
}

export const mention = (handle: string | null | undefined) =>
  handle ? `@${handle.replace(/^@/, "")}` : "";
