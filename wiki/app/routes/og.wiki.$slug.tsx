import puppeteer from "@cloudflare/puppeteer";
import { and, eq, inArray } from "drizzle-orm";
import type { LoaderFunctionArgs } from "react-router";
import * as schema from "~/db/schema";
import { getDb } from "~/lib/db.server";
import { buildOgImageHtml } from "~/lib/og-image.server";

const CACHE_CONTROL = "public, max-age=86400, s-maxage=31536000, immutable";

async function fallbackImage(request: Request, env: Env) {
  const fallbackUrl = new URL("/og-image.png", request.url);
  const fallback = await env.ASSETS.fetch(fallbackUrl);

  return new Response(fallback.body, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Content-Type": "image/png",
    },
  });
}

export async function loader({ request, context, params }: LoaderFunctionArgs) {
  const { env } = context.cloudflare;
  const cache = caches.default;
  const db = getDb(env);
  const pageRecord = await db
    .select({
      titleJa: schema.pages.titleJa,
      titleEn: schema.pages.titleEn,
      contentJa: schema.pages.contentJa,
      contentEn: schema.pages.contentEn,
    })
    .from(schema.pages)
    .where(
      and(
        eq(schema.pages.slug, params.slug ?? ""),
        eq(schema.pages.status, "published"),
        inArray(schema.pages.visibility, ["unlisted", "public"]),
      ),
    )
    .get();

  if (!pageRecord) throw new Response("Not Found", { status: 404 });

  // Check visibility before the cache so changing a page back to restricted
  // immediately makes every previously generated image URL unavailable.
  const cached = await cache.match(request);
  if (cached) return cached;

  const isEnglish = new URL(request.url).searchParams.get("lang") === "en";
  const title =
    (isEnglish ? pageRecord.titleEn : pageRecord.titleJa) ||
    pageRecord.titleJa ||
    pageRecord.titleEn;
  const content =
    (isEnglish ? pageRecord.contentEn : pageRecord.contentJa) ||
    pageRecord.contentJa ||
    pageRecord.contentEn ||
    "";
  const html = buildOgImageHtml({ title, content });

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const browserPage = await browser.newPage();
    await browserPage.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await browserPage.setContent(html, { waitUntil: "domcontentloaded" });
    const screenshot = await browserPage.screenshot({
      type: "png",
      clip: { x: 0, y: 0, width: 1200, height: 630 },
    });
    const response = new Response(screenshot, {
      headers: {
        "Cache-Control": CACHE_CONTROL,
        "Content-Type": "image/png",
      },
    });

    context.cloudflare.ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "og_image_render_failed",
        slug: params.slug,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return fallbackImage(request, env);
  } finally {
    await browser?.close();
  }
}
