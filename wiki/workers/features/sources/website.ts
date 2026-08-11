import { assetR2Key } from "./assets";
import type { PersistAssetInput } from "./persist";
import { sha256Hex } from "./persist";
import {
  MAX_CSS_BYTES,
  MAX_HTML_BYTES,
  MAX_STYLESHEETS,
  extractCssImportUrls,
  extractHtmlTitle,
  extractStylesheetUrls,
  rewriteCssImports,
  rewriteStylesheetHrefs,
} from "./website-html";

export interface WebsiteFetchResult {
  title: string;
  html: string;
  assets: PersistAssetInput[];
}

interface DownloadedCss {
  /** URL used for the fetch request (matches HTML / @import resolution). */
  requestedUrl: string;
  absoluteUrl: string;
  objectId: string;
  text: string;
}

/**
 * Fetch a public website as HTML plus linked stylesheets.
 * CSS files are written under `raw/<sourceId>/assets/`; HTML `href` / `@import`
 * references are rewritten to those asset paths.
 */
export async function fetchWebsiteSource(
  env: Env,
  sourceId: string,
  url: string,
): Promise<WebsiteFetchResult> {
  const htmlResponse = await fetch(url, {
    redirect: "follow",
    headers: { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" },
  });
  if (!htmlResponse.ok) {
    throw new Error(`Failed to fetch website (${htmlResponse.status})`);
  }

  const htmlBytes = new Uint8Array(await htmlResponse.arrayBuffer());
  if (htmlBytes.byteLength > MAX_HTML_BYTES) {
    throw new Error("Website HTML exceeds the 5 MB limit");
  }

  const pageUrl = htmlResponse.url || url;
  const htmlText = new TextDecoder("utf-8").decode(htmlBytes);
  const title = extractHtmlTitle(htmlText) || hostnameTitle(pageUrl);

  const primaryUrls = extractStylesheetUrls(htmlText, pageUrl);
  if (primaryUrls.length > MAX_STYLESHEETS) {
    throw new Error(`Website references more than ${MAX_STYLESHEETS} stylesheets`);
  }

  const primarySheets: DownloadedCss[] = [];
  const byUrl = new Map<string, DownloadedCss>();
  for (const sheetUrl of primaryUrls) {
    if (byUrl.has(sheetUrl)) continue;
    const css = await downloadCss(sheetUrl);
    primarySheets.push(css);
    byUrl.set(css.requestedUrl, css);
    byUrl.set(css.absoluteUrl, css);
  }

  const importedSheets: DownloadedCss[] = [];
  for (const css of primarySheets) {
    for (const importedUrl of extractCssImportUrls(css.text, css.absoluteUrl)) {
      if (byUrl.has(importedUrl)) continue;
      if (primarySheets.length + importedSheets.length >= MAX_STYLESHEETS) {
        throw new Error(`Website references more than ${MAX_STYLESHEETS} stylesheets`);
      }
      const imported = await downloadCss(importedUrl);
      importedSheets.push(imported);
      byUrl.set(imported.requestedUrl, imported);
      byUrl.set(imported.absoluteUrl, imported);
    }
  }

  const urlToPath = new Map<string, string>();
  const assets: PersistAssetInput[] = [];

  // Store imported sheets first (no further @import rewrite). Primary sheets then
  // rewrite @import to those final content-addressed paths.
  for (const css of importedSheets) {
    assets.push(await storeCssAsset(env, sourceId, css, css.text, urlToPath));
  }
  for (const css of primarySheets) {
    const rewritten = rewriteCssImports(css.text, css.absoluteUrl, urlToPath);
    assets.push(await storeCssAsset(env, sourceId, css, rewritten, urlToPath));
  }

  return {
    title,
    html: rewriteStylesheetHrefs(htmlText, pageUrl, urlToPath),
    assets,
  };
}

async function storeCssAsset(
  env: Env,
  sourceId: string,
  css: DownloadedCss,
  text: string,
  urlToPath: Map<string, string>,
): Promise<PersistAssetInput> {
  const bytes = new TextEncoder().encode(text);
  const contentHash = await sha256Hex(bytes);
  const r2Key = assetR2Key(sourceId, css.objectId, contentHash, "text/css");
  await env.BUCKET.put(r2Key, bytes, {
    httpMetadata: { contentType: "text/css; charset=utf-8" },
    customMetadata: { sha256: contentHash, sourceUrl: css.absoluteUrl },
  });
  urlToPath.set(css.requestedUrl, r2Key);
  urlToPath.set(css.absoluteUrl, r2Key);
  return {
    path: r2Key,
    r2Key,
    mimeType: "text/css",
    byteSize: bytes.byteLength,
    contentHash,
  };
}

async function downloadCss(absoluteUrl: string): Promise<DownloadedCss> {
  const response = await fetch(absoluteUrl, {
    redirect: "follow",
    headers: { Accept: "text/css,*/*;q=0.1" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch stylesheet (${response.status})`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_CSS_BYTES) {
    throw new Error("A stylesheet exceeds the 2 MB limit");
  }
  return {
    requestedUrl: absoluteUrl,
    absoluteUrl: response.url || absoluteUrl,
    objectId: stylesheetObjectId(absoluteUrl),
    text: new TextDecoder("utf-8").decode(bytes),
  };
}

function stylesheetObjectId(absoluteUrl: string): string {
  try {
    const url = new URL(absoluteUrl);
    const base = `${url.hostname}${url.pathname}`.replace(/[^A-Za-z0-9_-]+/g, "_");
    return (base || "stylesheet").slice(0, 80);
  } catch {
    return "stylesheet";
  }
}

function hostnameTitle(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
