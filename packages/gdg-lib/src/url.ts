export function isHostOrSubdomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/^\./, "");
  const base = domain.toLowerCase();
  return host === base || host.endsWith(`.${base}`);
}

export function withoutTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}
