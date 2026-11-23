export function isValidEmail(raw: string): boolean {
  if (raw.length === 0 || raw.length > 254) return false;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  const atIndex = raw.indexOf("@");
  if (atIndex <= 0 || atIndex === raw.length - 1) return false;
  if (raw.indexOf("@", atIndex + 1) !== -1) return false;

  const domain = raw.slice(atIndex + 1);
  if (
    !domain.includes(".") ||
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    domain.includes("..")
  ) {
    return false;
  }
  return true;
}

export function normalizeEmail(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  const atIndex = trimmed.indexOf("@");
  if (atIndex <= 0 || trimmed.indexOf("@", atIndex + 1) !== -1) {
    return trimmed;
  }

  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    return `${local.replaceAll(".", "")}@${domain}`;
  }
  return `${local}@${domain}`;
}
