const SCOPE_LABEL_KEYS = new Map<string, string>([
  ["openid", "auth.consent.scope.openid"],
  ["email", "auth.consent.scope.email"],
  ["profile", "auth.consent.scope.profile"],
  ["offline_access", "auth.consent.scope.offline_access"],
  ["https://gdgs.jp/scopes/chapters", "auth.consent.scope.chapters"],
]);

const UNKNOWN_SCOPE_LABEL_KEY = "auth.consent.scope.unknown";

export function scopeLabelKeys(scopes: readonly string[]): string[] {
  const keys = new Set<string>();
  let unknown = false;
  for (const scope of scopes) {
    const key = SCOPE_LABEL_KEYS.get(scope);
    if (key) keys.add(key);
    else unknown = true;
  }
  if (unknown) keys.add(UNKNOWN_SCOPE_LABEL_KEY);
  return [...keys];
}

export function splitScopeParameter(value: string | null): string[] {
  return value ? value.split(/\s/).filter(Boolean) : [];
}
