const GO_INPUT = /^go\/([a-zA-Z0-9_-]{1,64})$/;

/** @param {string} input */
export function goUrl(input) {
  const value = input
    .trim()
    .replace(/^go(?:\s+|\/)/i, "")
    .replace(/^\/+/, "");
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? `https://go.gdgs.jp/${value}` : null;
}

/** @param {string} rawUrl */
export function searchFallback(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const hostname = url.hostname.toLowerCase();
  let query = null;
  if (
    (hostname === "www.google.com" || hostname === "www.google.co.jp") &&
    url.pathname === "/search"
  ) {
    query = url.searchParams.get("q");
  } else if (hostname === "www.bing.com" && url.pathname === "/search") {
    query = url.searchParams.get("q");
  } else if (hostname === "duckduckgo.com" && (url.pathname === "/" || url.pathname === "/html/")) {
    query = url.searchParams.get("q");
  }
  const match = query?.trim().match(GO_INPUT);
  return match ? goUrl(match[1]) : null;
}
