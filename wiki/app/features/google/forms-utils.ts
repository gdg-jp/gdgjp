/**
 * Shared (client + server) Google Forms URL validation.
 */

const FORM_ID_REGEX = /docs\.google\.com\/forms\/d\/([a-zA-Z0-9_-]+)/;

export function extractFormId(url: string): string | null {
  const match = url.match(FORM_ID_REGEX);
  return match?.[1] ?? null;
}

export function isGoogleFormUrl(url: string): boolean {
  return FORM_ID_REGEX.test(url);
}
