import { fetchWebSource } from "../ingestion/tools/web-fetch";
import type { FetchedSourceDocument } from "./google-doc";

export interface WebsiteFetchResult {
  title: string;
  documents: FetchedSourceDocument[];
  /** Websites need no authorization for asset resolution. */
  accessToken?: undefined;
}

/**
 * Fetch a public website as markdown via the shared web-fetch adapter (Jina).
 * `browser` is accepted so the Worker binding stays wired for future PDF fallbacks;
 * Stage 1 markdown capture uses web-fetch only.
 */
export async function fetchWebsiteSource(
  url: string,
  _browser: Env["BROWSER"] | undefined,
): Promise<WebsiteFetchResult> {
  const result = await fetchWebSource(url);
  if (result.error || !result.markdown) {
    throw new Error(result.error ?? "Failed to fetch website");
  }

  const title = titleFromMarkdown(result.markdown) || hostnameTitle(url);
  return {
    title,
    documents: [
      {
        path: "index",
        title,
        markdown: result.markdown,
        images: [],
      },
    ],
  };
}

function titleFromMarkdown(markdown: string): string | null {
  const match = /^#\s+(.+)$/m.exec(markdown);
  return match?.[1]?.trim() || null;
}

function hostnameTitle(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
