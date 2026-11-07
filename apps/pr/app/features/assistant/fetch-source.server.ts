import type { SourceImage } from "./source";
import {
  connpassMain,
  googleExportUrl,
  googleTarget,
  htmlToText,
  imagesIn,
  maskContacts,
  titleOf,
} from "./source";
import { finishSource, getSource } from "./source.repository.server";

const UA = "Mozilla/5.0 (compatible; GDG-PR-Assistant/1.0; +https://pr.gdgs.jp)";
const MAX_TEXT = 300_000;
const MAX_IMAGE_BYTES = 2_500_000;
const MAX_IMAGES = 8;
/** Formats the runner's model reads. AVIF and SVG are skipped. */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export const sourceTextKey = (campaignId: number, sourceId: number) =>
  `assist/${campaignId}/sources/${sourceId}.txt`;
export const fileKey = (campaignId: number, id: string) => `assist/${campaignId}/files/${id}`;

type Fetched = { title: string; text: string; imageUrls: string[]; image?: SourceImage };

class SourceError extends Error {}

async function get(url: string, accept: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { "User-Agent": UA, Accept: accept, "Accept-Language": "ja,en;q=0.8" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  const landed = new URL(response.url || url);
  if (
    landed.hostname === "accounts.google.com" ||
    response.status === 401 ||
    response.status === 403
  )
    throw new SourceError(
      "読めませんでした。共有を「リンクを知っている全員（閲覧者）」にするか、本文を貼ってください",
    );
  if (response.status === 404) throw new SourceError("ページが見つかりません（404）");
  if (!response.ok) throw new SourceError(`読めませんでした（${response.status}）`);
  return response;
}

/** img.gdgs.jp picks the format from Accept or `f`; ask for one the model reads. */
function readableImageUrl(raw: string): string {
  const url = new URL(raw);
  if (url.hostname === "img.gdgs.jp" && url.searchParams.has("f"))
    url.searchParams.set("f", "webp");
  return url.toString();
}

async function readUrl(env: Env, url: string): Promise<Fetched> {
  const google = googleTarget(url);
  if (google?.kind === "folder")
    throw new SourceError(
      "フォルダは読めません。中のファイルの共有リンクを 1 つずつ貼ってください",
    );
  if (google) {
    const exportUrl = googleExportUrl(google) as string;
    const response = await get(exportUrl, "*/*");
    const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (google.kind === "file" && IMAGE_TYPES.includes(type)) {
      return { title: "画像", text: "", imageUrls: [exportUrl] };
    }
    if (type === "application/pdf")
      throw new SourceError("PDF は読めません。Google ドキュメントにするか、画像で貼ってください");
    const body = await response.text();
    if (google.kind === "doc")
      return {
        title: titleOf(body) || "Google ドキュメント",
        text: htmlToText(body),
        imageUrls: imagesIn(body, exportUrl),
      };
    if (type.startsWith("text/html") && /ServiceLogin|signin/i.test(body))
      throw new SourceError(
        "読めませんでした。共有を「リンクを知っている全員（閲覧者）」にしてください",
      );
    return {
      title: google.kind === "sheet" ? "Google スプレッドシート" : "Google スライド",
      text: body,
      imageUrls: [],
    };
  }
  const response = await get(url, "text/html,application/xhtml+xml,*/*;q=0.5");
  const type = response.headers.get("content-type") ?? "";
  if (IMAGE_TYPES.some((t) => type.startsWith(t)))
    return { title: "画像", text: "", imageUrls: [url] };
  if (!type.includes("html") && !type.startsWith("text/"))
    throw new SourceError(`この形式は読めません（${type.split(";")[0]}）`);
  let html = await response.text();
  const host = new URL(response.url || url).hostname;
  // Pages that build themselves in the browser (Bevy, Luma) come back nearly empty.
  if (htmlToText(html).length < 300 && env.ENVIRONMENT === "production") {
    try {
      const rendered = await env.BROWSER.quickAction("content", { url } as never);
      if (rendered.ok) {
        const data = (await rendered.json()) as { result?: string };
        if (data.result) html = data.result;
      }
    } catch {}
  }
  const main = host.endsWith("connpass.com") ? (connpassMain(html) ?? html) : html;
  return {
    title: titleOf(html) || host,
    text: htmlToText(main),
    imageUrls: imagesIn(main, response.url || url),
  };
}

async function saveImages(
  env: Env,
  campaignId: number,
  sourceId: number,
  urls: string[],
): Promise<SourceImage[]> {
  const out: SourceImage[] = [];
  for (const [n, src] of urls.slice(0, MAX_IMAGES).entries()) {
    try {
      const response = await fetch(readableImageUrl(src), {
        headers: { "User-Agent": UA, Accept: "image/webp,image/png,image/jpeg,image/gif" },
        signal: AbortSignal.timeout(15_000),
      });
      const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
      if (!response.ok || !IMAGE_TYPES.includes(type)) continue;
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_IMAGE_BYTES || bytes.byteLength < 2_000) continue;
      const id = `src-${sourceId}-${n + 1}`;
      await env.IMAGES.put(fileKey(campaignId, id), bytes, { httpMetadata: { contentType: type } });
      out.push({ id, type, size: bytes.byteLength, src });
    } catch {}
  }
  return out;
}

/**
 * Read a source and store its text and images in R2 for the runner. The Worker only collects;
 * it never interprets what it read (the assistant does). Contact details are masked first.
 */
export async function readSource(env: Env, campaignId: number, sourceId: number) {
  const source = await getSource(env.DB, campaignId, sourceId);
  if (!source) return null;
  try {
    const fetched = await readUrl(env, source.url);
    const text = maskContacts(fetched.text).slice(0, MAX_TEXT);
    const textKey = sourceTextKey(campaignId, sourceId);
    await env.IMAGES.put(textKey, text, {
      httpMetadata: { contentType: "text/plain; charset=utf-8" },
    });
    const images = await saveImages(env, campaignId, sourceId, fetched.imageUrls);
    if (!text.trim() && images.length === 0)
      throw new SourceError("中身が空でした。本文を貼るか、画像で送ってください");
    await finishSource(env.DB, sourceId, { status: "ok", title: fetched.title, textKey, images });
  } catch (error) {
    const message =
      error instanceof SourceError
        ? error.message
        : `読めませんでした（${error instanceof Error ? error.message : String(error)}）`;
    await finishSource(env.DB, sourceId, { status: "error", error: message.slice(0, 300) });
  }
  return getSource(env.DB, campaignId, sourceId);
}
