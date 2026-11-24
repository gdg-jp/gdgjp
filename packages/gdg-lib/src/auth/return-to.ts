export function safeReturnTo(value: string | null | undefined, appUrl: string): string | null {
  if (!value) return null;
  let target: URL;
  try {
    target = new URL(value, appUrl);
  } catch {
    return null;
  }
  if (target.origin !== new URL(appUrl).origin || target.pathname.startsWith("//")) return null;
  return `${target.pathname}${target.search}${target.hash}`;
}
