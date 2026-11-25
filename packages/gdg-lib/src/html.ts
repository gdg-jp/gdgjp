export type HtmlToken =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "tag";
      readonly name: string;
      readonly closing: boolean;
      readonly source: string;
    };

const TAG = /^<(\/)?([a-zA-Z][\w:-]*)/;
const STARTS_MARKUP = /[a-zA-Z!?/]/;

export function htmlTokens(
  html: string,
  { skip = [] }: { readonly skip?: readonly string[] } = {},
): HtmlToken[] {
  const skipped = new Set(skip.map((name) => name.toLowerCase()));
  const lower = html.toLowerCase();
  const tokens: HtmlToken[] = [];
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf("<", at);
    if (open === -1) {
      tokens.push({ kind: "text", text: html.slice(at) });
      break;
    }
    if (open > at) tokens.push({ kind: "text", text: html.slice(at, open) });
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      at = end === -1 ? html.length : end + 3;
      continue;
    }
    const next = html[open + 1] ?? "";
    if (!STARTS_MARKUP.test(next)) {
      tokens.push({ kind: "text", text: "&lt;" });
      at = open + 1;
      continue;
    }
    const close = html.indexOf(">", open + 1);
    if (close === -1) break;
    const source = html.slice(open, close + 1);
    const match = TAG.exec(source);
    if (!match) {
      at = close + 1;
      continue;
    }
    const name = match[2].toLowerCase();
    const closing = match[1] === "/";
    at = close + 1;
    if (!closing && skipped.has(name) && !source.endsWith("/>")) {
      const end = lower.indexOf(`</${name}`, at);
      const after = end === -1 ? -1 : html.indexOf(">", end);
      at = after === -1 ? html.length : after + 1;
      continue;
    }
    if (skipped.has(name)) continue;
    tokens.push({ kind: "tag", name, closing, source });
  }
  return tokens;
}

export function htmlText(
  html: string,
  options: { readonly skip?: readonly string[]; readonly tag?: (token: HtmlTag) => string } = {},
): string {
  const tag = options.tag ?? (() => " ");
  return htmlTokens(html, options)
    .map((token) => (token.kind === "text" ? token.text : tag(token)))
    .join("");
}

export type HtmlTag = Extract<HtmlToken, { kind: "tag" }>;
