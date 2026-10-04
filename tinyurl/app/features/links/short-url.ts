export function shortDomainLabel(hostname: string): string {
  return hostname === "go.gdgs.jp" ? "go/" : `${hostname}/`;
}

export function shortLinkDisplay(hostname: string, slug: string): string {
  return `${shortDomainLabel(hostname)}${slug}`;
}
