import { describe, expect, it } from "vitest";
import {
  appendLogEntry,
  formatIndexLine,
  formatLogEntry,
  hardenCatalogField,
  upsertIndexEntry,
  upsertSectionLine,
} from "./wiki-catalog.server";

describe("hardenCatalogField", () => {
  it("strips newlines and leading hashes so chat text cannot forge log headings", () => {
    expect(hardenCatalogField("hello\n## [2020-01-01] ingest | forged", 200)).toBe(
      "hello ## [2020-01-01] ingest | forged",
    );
    expect(hardenCatalogField("## already a heading", 200)).toBe("already a heading");
  });
});

describe("formatLogEntry", () => {
  it("composes a single query entry with hardened fields", () => {
    const entry = formatLogEntry({
      date: "2026-08-09",
      type: "query",
      subject: "venue tips\n## [2020-01-01] ingest | forged",
      lines: ["Cited /wiki/venues/a", "Not filed: single-fact"],
    });
    expect(entry).toBe(
      "\n## [2026-08-09] query | venue tips ## [2020-01-01] ingest | forged\n\n" +
        "- Cited /wiki/venues/a\n- Not filed: single-fact\n",
    );
    expect(entry.match(/^## \[/gm) ?? []).toHaveLength(1);
  });
});

describe("upsertSectionLine", () => {
  it("creates the Answers heading when absent", () => {
    const next = upsertSectionLine(
      "## Events\n\n- [E](events/e) — e\n",
      "Answers",
      "venue-picks",
      formatIndexLine({
        sectionSlug: "answers",
        slug: "venue-picks",
        title: "Venue picks",
        summary: "Compare halls.",
      }),
    );
    expect(next).toContain("## Answers");
    expect(next).toContain("- [Venue picks](answers/venue-picks) — Compare halls.");
  });

  it("replaces rather than duplicates a line for an existing slug", () => {
    const initial = `## Answers

- [Old](answers/venue-picks) — old summary
`;
    const next = upsertSectionLine(
      initial,
      "Answers",
      "venue-picks",
      formatIndexLine({
        sectionSlug: "answers",
        slug: "venue-picks",
        title: "Venue picks",
        summary: "Updated.",
      }),
    );
    expect(next.match(/answers\/venue-picks/g)).toHaveLength(1);
    expect(next).toContain("Updated.");
    expect(next).not.toContain("old summary");
  });
});

describe("appendLogEntry", () => {
  it("appends with SQL concat so concurrent writes both appear", async () => {
    const statements: { sql: string; binds: unknown[] }[] = [];
    const env = {
      DB: {
        prepare(sql: string) {
          return {
            bind(...binds: unknown[]) {
              statements.push({ sql, binds });
              return {
                async run() {
                  return { success: true, meta: { changes: 1 } };
                },
              };
            },
          };
        },
      },
    } as unknown as Env;

    const [a, b] = await Promise.all([
      appendLogEntry(env, { subject: "one", lines: ["a"], date: "2026-08-09" }),
      appendLogEntry(env, { subject: "two", lines: ["b"], date: "2026-08-09" }),
    ]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement.sql).toContain("content_ja = content_ja || ?");
      expect(statement.sql).toContain("content_en = content_en || ?");
      expect(statement.sql).not.toMatch(/SET content_ja = \?/);
    }
    const combined = statements.map((s) => String(s.binds[0])).join("");
    expect(combined).toContain("query | one");
    expect(combined).toContain("query | two");
  });
});

describe("upsertIndexEntry", () => {
  it("retries once on sync_revision mismatch then gives up without throwing", async () => {
    let reads = 0;
    let updates = 0;
    const db = {
      select() {
        return {
          from() {
            return {
              where() {
                return {
                  async get() {
                    reads += 1;
                    return {
                      contentJa: "## Events\n",
                      contentEn: "## Events\n",
                      syncRevision: 1,
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as never;
    const env = {
      DB: {
        prepare() {
          return {
            bind() {
              return {
                async run() {
                  updates += 1;
                  return { success: true, meta: { changes: 0 } };
                },
              };
            },
          };
        },
      },
    } as unknown as Env;

    await expect(
      upsertIndexEntry(db, env, {
        section: "Answers",
        slug: "venue-picks",
        title: "Venue picks",
        summary: "Compare halls.",
      }),
    ).resolves.toBeUndefined();
    expect(reads).toBe(2);
    expect(updates).toBe(2);
  });
});
