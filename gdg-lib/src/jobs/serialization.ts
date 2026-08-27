export function parseJobJson<T>(value: string | null): T | null {
  if (value === null) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function serializeJobJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}
