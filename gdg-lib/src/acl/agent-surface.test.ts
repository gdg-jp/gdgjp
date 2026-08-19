import { describe, expect, it } from "vitest";
import * as agent from "./agent";

const forbidden = [
  "canClassesAccessSource",
  "canClassesSeePage",
  "canAccessSource",
  "audienceContains",
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
  for (const name of forbidden) expect(module).not.toHaveProperty(name);
  for (const name of required) expect(module).toHaveProperty(name);
}

describe("agent ACL surface", () => {
  it("only exposes channel-aware read evaluators", async () => {
    assertSurface(agent);
    const generated = await import("../../../cli/internal/wiki/hooks/acl");
    assertSurface(generated);

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
});
