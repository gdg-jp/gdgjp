export function safeReturnTo(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally rejecting control chars
  if (/[\\\x00-\x1f\x7f\s]/.test(value)) return null;
  return value;
}
