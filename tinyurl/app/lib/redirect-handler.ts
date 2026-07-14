import { isbot } from "isbot";
import { writeClickEvent } from "./analytics-engine-write";
import { type Link, getLinkBySlug } from "./db";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function metaTag(property: string, content: string | null | undefined): string {
  return content ? `<meta property="${property}" content="${escapeHtml(content)}">` : "";
}

function twitterMetaTag(name: string, content: string | null | undefined): string {
  return content ? `<meta name="${name}" content="${escapeHtml(content)}">` : "";
}

export function renderBotPreview(link: Link, shortUrl: string): Response {
  const title = link.title || link.slug;
  const description = link.description || link.destinationUrl;
  const image = link.ogImageUrl;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${metaTag("og:type", "website")}
  ${metaTag("og:url", shortUrl)}
  ${metaTag("og:title", title)}
  ${metaTag("og:description", description)}
  ${metaTag("og:image", image)}
  ${twitterMetaTag("twitter:card", image ? "summary_large_image" : "summary")}
  ${twitterMetaTag("twitter:title", title)}
  ${twitterMetaTag("twitter:description", description)}
  ${twitterMetaTag("twitter:image", image)}
  <meta http-equiv="refresh" content="0;url=${escapeHtml(link.destinationUrl)}">
</head>
<body>
  <p><a href="${escapeHtml(link.destinationUrl)}">Continue</a></p>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function handleApexRedirect(
  env: Env,
  ctx: ExecutionContext,
  request: Request,
  slug: string,
  hostname = new URL(request.url).hostname,
): Promise<Response | null> {
  const link = await getLinkBySlug(env.DB, slug, hostname);
  if (!link) return null;
  const userAgent = request.headers.get("user-agent");
  if (userAgent && isbot(userAgent)) {
    return renderBotPreview(link, new URL(request.url).toString());
  }
  ctx.waitUntil(Promise.resolve(writeClickEvent(env, request, link, hostname)));
  return new Response(null, {
    status: 302,
    headers: {
      Location: link.destinationUrl,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
