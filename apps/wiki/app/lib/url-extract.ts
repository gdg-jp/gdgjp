import { type Browser, type BrowserWorker, launch as puppeteerLaunch } from "@cloudflare/puppeteer";

export interface ExtractedUrl {
  id: string;
  url: string;
  source: "user_text" | "google_doc";
  context: string;
}

export interface UrlPdfResult {
  buffer: ArrayBuffer;
  title: string;
  error?: undefined;
}

export interface UrlPdfError {
  buffer?: undefined;
  title?: undefined;
  error: string;
}

export interface JinaResult {
  markdown: string;
  truncated: boolean;
  error?: undefined;
}

export interface JinaError {
  markdown?: undefined;
  truncated?: undefined;
  error: string;
}

const URL_REGEX = /https?:\/\/[^\s<>"')\]},;!？。、）」』】\u3000]+/g;

const GOOGLE_DRIVE_RE = /^https?:\/\/(docs|drive|slides|sheets)\.google\.com\//;

const JINA_RE = /^https?:\/\/r\.jina\.ai\//;

export function extractUrls(
  text: string,
  source: "user_text" | "google_doc",
  maxUrls = 5,
): ExtractedUrl[] {
  const matches = text.matchAll(URL_REGEX);
  const seen = new Set<string>();
  const results: ExtractedUrl[] = [];

  for (const match of matches) {
    const url = match[0];
    if (seen.has(url)) continue;
    if (GOOGLE_DRIVE_RE.test(url)) continue;
    if (JINA_RE.test(url)) continue;
    seen.add(url);

    const idx = match.index ?? 0;
    const start = Math.max(0, idx - 25);
    const end = Math.min(text.length, idx + url.length + 25);
    const context = text.slice(start, end).replace(/\n/g, " ").trim();

    results.push({
      id: globalThis.crypto?.randomUUID() ?? `url-${Date.now()}-${results.length}`,
      url,
      source,
      context,
    });

    if (results.length >= maxUrls) break;
  }

  return results;
}

export async function fetchUrlAsPdf(
  browser: BrowserWorker,
  url: string,
  timeoutMs = 30000,
): Promise<UrlPdfResult | UrlPdfError> {
  let b: Browser | undefined;
  try {
    b = await puppeteerLaunch(browser);
    const page = await b.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    const title = await page.title();
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });
    const arrayBuffer = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength,
    ) as ArrayBuffer;
    const header = new Uint8Array(arrayBuffer, 0, Math.min(4, arrayBuffer.byteLength));
    if (header[0] !== 0x25 || header[1] !== 0x50 || header[2] !== 0x44 || header[3] !== 0x46) {
      return {
        error: `page.pdf() returned non-PDF data (${arrayBuffer.byteLength} bytes, first bytes: ${Array.from(
          header,
        )
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(" ")})`,
      };
    }
    return { buffer: arrayBuffer, title };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  } finally {
    if (b) {
      try {
        await b.close();
      } catch {}
    }
  }
}

export async function fetchUrlViaJina(
  url: string,
  timeoutMs = 15000,
): Promise<JinaResult | JinaError> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      signal: controller.signal,
      headers: { Accept: "text/markdown" },
    });

    if (!res.ok) {
      return { error: `HTTP ${res.status} from Jina reader` };
    }

    const text = await res.text();
    const MAX_CHARS = 10_000;
    if (text.length > MAX_CHARS) {
      return { markdown: text.slice(0, MAX_CHARS), truncated: true };
    }
    return { markdown: text, truncated: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg.includes("abort") ? "Timeout fetching URL" : msg };
  } finally {
    clearTimeout(timer);
  }
}
