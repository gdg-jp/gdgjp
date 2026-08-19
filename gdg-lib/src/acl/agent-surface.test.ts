import { describe, expect, it } from "vitest";
import * as agent from "./agent";
import type { PageSubject } from "./types";

const allowed = [
  "ACL_REDACTION_PLACEHOLDER",
  "aclSpanSourceIds",
  "canClassesAccessSourceInChannel",
  "canClassesSeePageInChannel",
  "canMutatePage",
  "isSourceVisibility",
  "metadataContainsAclTag",
  "parseAclSpans",
  "parseLevelAudienceKey",
  "redactAclSpans",
  "sourceAudienceKey",
  "sourceVisibilityNeedsChapter",
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
      { kind: "chapter-member" as const, chapterId: "osaka" },
      { kind: "chapter-organizer" as const, chapterId: "osaka" },
    ];
    const expectedContains = (outer: (typeof keys)[number], inner: (typeof keys)[number]) => {
      if (outer.kind === "private") return false;
      if (outer.kind === "member") return inner.kind === "member";
      if (outer.kind === "organizer") return inner.kind === "member" || inner.kind === "organizer";
      if (outer.kind === "chapter-member") {
        return (
          inner.kind === "member" ||
          (inner.kind === "chapter-member" && inner.chapterId === outer.chapterId)
        );
      }
      return (
        inner.kind === "member" ||
        inner.kind === "organizer" ||
        (inner.kind === "chapter-member" && inner.chapterId === outer.chapterId) ||
        (inner.kind === "chapter-organizer" && inner.chapterId === outer.chapterId)
      );
    };
    for (const implementation of [agent, generated]) {
      for (let outer = 0; outer < keys.length; outer += 1) {
        for (let inner = 0; inner < keys.length; inner += 1) {
          const outerKey = keys[outer];
          const innerKey = keys[inner];
          if (!outerKey || !innerKey) throw new Error("invalid test matrix");
          expect(
            implementation.canClassesAccessSourceInChannel(
              {
                visibility: innerKey.kind,
                chapterId: "chapterId" in innerKey ? (innerKey.chapterId ?? null) : null,
              },
              innerKey.kind === "member"
                ? [{ chapterId: "tokyo", role: "member" as const }]
                : innerKey.kind === "organizer"
                  ? [{ chapterId: "tokyo", role: "organizer" as const }]
                  : innerKey.kind === "chapter-member"
                    ? [{ chapterId: innerKey.chapterId, role: "member" as const }]
                    : innerKey.kind === "chapter-organizer"
                      ? [{ chapterId: innerKey.chapterId, role: "organizer" as const }]
                      : [],
              outerKey,
            ),
          ).toBe(expectedContains(outerKey, innerKey));
        }
      }
    }
  });

  it("covers page visibility, mutation, and denial branches", async () => {
    const generated = await import("../../../cli/internal/wiki/hooks/acl");
    const implementations = [agent, generated];
    const memberTokyo = [{ chapterId: "tokyo", role: "member" as const }];
    const memberOsaka = [{ chapterId: "osaka", role: "member" as const }];
    const organizerOsaka = [{ chapterId: "osaka", role: "organizer" as const }];
    const mixed = [
      { chapterId: "tokyo", role: "member" as const },
      { chapterId: "osaka", role: "organizer" as const },
    ];
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
        implementation.canClassesSeePageInChannel(page("member", null), memberTokyo, {
          kind: "member",
        }),
      ).toBe(true);
      expect(
        implementation.canClassesSeePageInChannel(page("organizer", null), memberTokyo, {
          kind: "organizer",
        }),
      ).toBe(false);
      expect(
        implementation.canClassesSeePageInChannel(page("organizer", null), organizerOsaka, {
          kind: "organizer",
        }),
      ).toBe(true);
      expect(
        implementation.canClassesSeePageInChannel(
          page("restricted", "tokyo", [{ subjectType: "chapter", subjectKey: "tokyo" }]),
          memberTokyo,
          { kind: "chapter-member", chapterId: "tokyo" },
        ),
      ).toBe(true);
      expect(
        implementation.canClassesSeePageInChannel(
          page("restricted", "tokyo", [{ subjectType: "email", subjectKey: "a@example.com" }]),
          memberTokyo,
          { kind: "chapter-member", chapterId: "tokyo" },
        ),
      ).toBe(false);
      expect(
        implementation.canClassesSeePageInChannel(page("future", null), memberTokyo, {
          kind: "member",
        }),
      ).toBe(false);

      const mutationCases = [
        { classes: [], visibility: "public", chapterId: null, expected: false },
        { classes: [], visibility: "restricted", chapterId: "tokyo", expected: false },
        { classes: memberTokyo, visibility: "public", chapterId: null, expected: true },
        { classes: memberTokyo, visibility: "unlisted", chapterId: null, expected: true },
        { classes: memberTokyo, visibility: "member", chapterId: null, expected: false },
        { classes: memberTokyo, visibility: "organizer", chapterId: null, expected: false },
        { classes: memberTokyo, visibility: "restricted", chapterId: "tokyo", expected: true },
        { classes: memberTokyo, visibility: "restricted", chapterId: "osaka", expected: false },
        { classes: memberTokyo, visibility: "future", chapterId: "tokyo", expected: false },
        { classes: memberOsaka, visibility: "restricted", chapterId: "osaka", expected: true },
        { classes: organizerOsaka, visibility: "public", chapterId: null, expected: true },
        { classes: organizerOsaka, visibility: "unknown", chapterId: "tokyo", expected: true },
        { classes: mixed, visibility: "restricted", chapterId: "tokyo", expected: true },
      ] as const;
      for (const mutationCase of mutationCases) {
        expect(
          implementation.canMutatePage(
            mutationCase.classes,
            page(mutationCase.visibility, mutationCase.chapterId),
          ),
        ).toBe(mutationCase.expected);
      }
    }
  });
});
