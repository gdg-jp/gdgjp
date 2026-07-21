import { fetchUrlViaJina } from "../../../../app/lib/url-extract";

/** A bounded URL source adapter. URL selection remains an orchestration decision. */
export async function fetchWebSource(url: string): Promise<{ markdown?: string; error?: string }> {
  return fetchUrlViaJina(url);
}
