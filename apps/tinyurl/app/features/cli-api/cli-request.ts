export function parsePathId(raw: string | undefined): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export type ListQuery = { includeArchived: boolean; limit?: number; cursor: string | null };

export function parseListQuery(url: URL): ListQuery | null {
  const includeArchivedRaw = url.searchParams.get("includeArchived");
  if (includeArchivedRaw !== null && !["true", "false", "1", "0"].includes(includeArchivedRaw)) {
    return null;
  }
  const includeArchived = includeArchivedRaw === "true" || includeArchivedRaw === "1";

  const limitRaw = url.searchParams.get("limit");
  let limit: number | undefined;
  if (limitRaw !== null) {
    const value = Number(limitRaw);
    if (!Number.isInteger(value) || value < 1 || value > 100) return null;
    limit = value;
  }

  return { includeArchived, limit, cursor: url.searchParams.get("cursor") };
}

export const INVALID: unique symbol = Symbol("invalid_field");
export type InvalidField = typeof INVALID;

export function isInvalid(value: unknown): value is InvalidField {
  return value === INVALID;
}

export function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined | InvalidField {
  if (!(key in body)) return undefined;
  const value = body[key];
  return typeof value === "string" ? value : INVALID;
}

export function optionalNullableString(
  body: Record<string, unknown>,
  key: string,
): string | null | undefined | InvalidField {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  return typeof value === "string" ? value : INVALID;
}

export function optionalInteger(
  body: Record<string, unknown>,
  key: string,
): number | undefined | InvalidField {
  if (!(key in body)) return undefined;
  const value = body[key];
  return typeof value === "number" && Number.isInteger(value) ? value : INVALID;
}

export function optionalBoolean(
  body: Record<string, unknown>,
  key: string,
): boolean | undefined | InvalidField {
  if (!(key in body)) return undefined;
  const value = body[key];
  return typeof value === "boolean" ? value : INVALID;
}

export function integerArray(
  body: Record<string, unknown>,
  key: string,
): number[] | undefined | InvalidField {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (!Array.isArray(value)) return INVALID;
  const ids = value.filter((id): id is number => typeof id === "number" && Number.isInteger(id));
  return ids.length === value.length ? ids : INVALID;
}
