export type SourceListView = "active" | "archived";

export const ACTIVE_SOURCE_STATUSES = ["pending", "fetching", "ready", "error"] as const;

export type ActiveSourceStatus = (typeof ACTIVE_SOURCE_STATUSES)[number];

export type SourceFilterInput = {
  view: SourceListView;
  q: string;
  kind: string[];
  status: string[];
};

export type FilterableSource = {
  title: string;
  url: string;
  kind: string;
  status: string;
};

export function parseCsvParam(raw: string | null): string[] {
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

export function serializeCsvParam(values: string[]): string | null {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  return unique.length > 0 ? unique.join(",") : null;
}

export function parseSourceListView(raw: string | null): SourceListView {
  return raw === "archived" ? "archived" : "active";
}

export function parseSourceFilters(params: URLSearchParams): SourceFilterInput {
  return {
    view: parseSourceListView(params.get("view")),
    q: (params.get("q") ?? "").trim(),
    kind: parseCsvParam(params.get("kind")),
    status: parseCsvParam(params.get("status")).filter((value) =>
      (ACTIVE_SOURCE_STATUSES as readonly string[]).includes(value),
    ),
  };
}

export function countSourceViews<T extends { status: string }>(
  sources: T[],
): { active: number; archived: number } {
  let active = 0;
  let archived = 0;
  for (const source of sources) {
    if (source.status === "archived") archived += 1;
    else active += 1;
  }
  return { active, archived };
}

export function collectSourceKinds<T extends { kind: string }>(sources: T[]): string[] {
  return [...new Set(sources.map((source) => source.kind))].sort((a, b) => a.localeCompare(b));
}

export function filterSources<T extends FilterableSource>(
  sources: T[],
  filters: SourceFilterInput,
): T[] {
  const query = filters.q.trim().toLowerCase();
  const kinds = new Set(filters.kind);
  const statuses = new Set(filters.status);

  return sources.filter((source) => {
    const isArchived = source.status === "archived";
    if (filters.view === "archived" ? !isArchived : isArchived) return false;

    if (query) {
      const haystack = `${source.title}\n${source.url}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }

    if (kinds.size > 0 && !kinds.has(source.kind)) return false;

    if (filters.view === "active" && statuses.size > 0 && !statuses.has(source.status)) {
      return false;
    }

    return true;
  });
}
