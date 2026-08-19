import { describe, expect, it } from "vitest";
import * as agent from "./agent";
import type { PageSubject } from "./types";

const allowed = [
  "ACL_REDACTION_PLACEHOLDER",
  "aclSpanSourceIds",
  "canClassesAccessSourceInChannel",
  "canClassesSeePageInChannel",
  "canMutatePage",
  "metadataContainsAclTag",
  "parseAclSpans",
  "redactAclSpans",
  "validateAclSpans",
] as const;

const required = [
  "canClassesAccessSourceInChannel",
  "canClassesSeePageInChannel",
  "canMutatePage",
  "parseAclSpans",
  "redactAclSpans",
  "validateAclSpans",
] as const;

function assertSurface(module: Record<string, unknown>): void {
  expect(Object.keys(module).sort()).toEqual([...allowed].sort());
  for (const name of required) expect(module).toHaveProperty(name);
}

describe("agent ACL surface", () => {
  it("only exposes the explicitly approved runtime surface", async () => {
    const generated = await import("../../../cli/internal/wiki/hooks/acl");
    assertSurface(agent);
    assertSurface(generated);
  });

  it("keeps source and generated implementations behaviorally equivalent", async () => {
    const generated = await import("../../../cli/internal/wiki/hooks/acl");

    const source = { visibility: "chapter-member", chapterId: "tokyo" };
    const classes = [{ chapterId: "tokyo", role: "member" as const }];
    const channel = { kind: "chapter-member" as const, chapterId: "tokyo" };
    const page = {
      visibility: "restricted",
      chapterId: "tokyo",
      access: [{ subjectType: "chapter", subjectKey: "tokyo" }],
    };
    const markdown = 'visible <acl src="tokyo">secret</acl>';
    expect(generated.canClassesAccessSourceInChannel(source, classes, channel)).toBe(
      agent.canClassesAccessSourceInChannel(source, classes, channel),
    );
    expect(generated.canClassesSeePageInChannel(page, classes, channel)).toBe(
      agent.canClassesSeePageInChannel(page, classes, channel),
    );
    expect(generated.canMutatePage(classes, page)).toBe(agent.canMutatePage(classes, page));
    expect(generated.validateAclSpans(markdown)).toEqual(agent.validateAclSpans(markdown));
    expect(generated.parseAclSpans(markdown)).toEqual(agent.parseAclSpans(markdown));
    expect(generated.redactAclSpans(markdown, () => false)).toEqual(
      agent.redactAclSpans(markdown, () => false),
    );
  });

  it("covers the complete channel audience matrix for both implementations", async () => {
    const generated = await import("../../../cli/internal/wiki/hooks/acl");
    const keys = [
      { kind: "private" as const },
      { kind: "member" as const },
      { kind: "organizer" as const },
      { kind: "chapter-member" as const, chapterId: "tokyo" },
      { kind: "chapter-organizer" as const, chapterId: "tokyo" },
    ];
    const expected = [
      [false, false, false, false, false],
      [false, true, false, false, false],
      [false, true, true, false, false],
      [false, true, false, true, false],
      [false, true, true, true, true],
    ];
    for (const implementation of [agent, generated]) {
      for (let outer = 0; outer < keys.length; outer += 1) {
        for (let inner = 0; inner < keys.length; inner += 1) {
          expect(
            implementation.canClassesAccessSourceInChannel(
              {
                visibility: keys[inner]?.kind ?? "future",
                chapterId:
                  "chapterId" in (keys[inner] ?? {}) ? (keys[inner].chapterId ?? null) : null,
              },
              keys[inner]?.kind === "member" || keys[inner]?.kind === "chapter-member"
                ? [{ chapterId: "tokyo", role: "member" as const }]
                : keys[inner]?.kind === "organizer" || keys[inner]?.kind === "chapter-organizer"
                  ? [{ chapterId: "tokyo", role: "organizer" as const }]
                  : [],
              keys[outer] ?? { kind: "private" },
            ),
          ).toBe(expected[outer]?.[inner] ?? false);
        }
      }
    }
  });

  it("covers page visibility, mutation, and denial branches", async () => {
    const generated = await import("../../../cli/internal/wiki/hooks/acl");
    const implementations = [agent, generated];
    const member = [{ chapterId: "tokyo", role: "member" as const }];
    const organizer = [{ chapterId: "osaka", role: "organizer" as const }];
    const page = (
      visibility: string,
      chapterId: string | null,
      access: PageSubject["access"] = [],
    ): PageSubject => ({
      visibility,
      chapterId,
      access,
    });

    for (const implementation of implementations) {
      expect(
        implementation.canClassesSeePageInChannel(page("public", null), [], { kind: "private" }),
      ).toBe(true);
      expect(
        implementation.canClassesSeePageInChannel(page("unlisted", null), [], { kind: "private" }),
      ).toBe(true);
      expect(
        implementation.canClassesSeePageInChannel(page("member", null), [], { kind: "member" }),
      ).toBe(false);
      expect(
        implementation.canClassesSeePageInChannel(page("member", null), member, { kind: "member" }),
      ).toBe(true);
      expect(
        implementation.canClassesSeePageInChannel(page("organizer", null), member, {
          kind: "organizer",
        }),
      ).toBe(false);
      expect(
        implementation.canClassesSeePageInChannel(page("organizer", null), organizer, {
          kind: "organizer",
        }),
      ).toBe(true);
      expect(
        implementation.canClassesSeePageInChannel(
          page("restricted", "tokyo", [{ subjectType: "chapter", subjectKey: "tokyo" }]),
          member,
          { kind: "chapter-member", chapterId: "tokyo" },
        ),
      ).toBe(true);
      expect(
        implementation.canClassesSeePageInChannel(
          page("restricted", "tokyo", [{ subjectType: "email", subjectKey: "a@example.com" }]),
          member,
          { kind: "chapter-member", chapterId: "tokyo" },
        ),
      ).toBe(false);
      expect(
        implementation.canClassesSeePageInChannel(page("future", null), member, { kind: "member" }),
      ).toBe(false);

      expect(implementation.canMutatePage([], page("public", null))).toBe(false);
      expect(implementation.canMutatePage(member, page("public", null))).toBe(true);
      expect(implementation.canMutatePage(member, page("restricted", "tokyo"))).toBe(true);
      expect(implementation.canMutatePage(member, page("restricted", "osaka"))).toBe(false);
      expect(implementation.canMutatePage(organizer, page("restricted", "tokyo"))).toBe(true);
      expect(implementation.canMutatePage(member, page("future", "tokyo"))).toBe(false);
    }
  });
});
