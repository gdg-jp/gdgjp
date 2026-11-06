import { describe, expect, it } from "vitest";
import { INITIAL_AGENTS_MD, extractInstructionSections } from "./agents-md.server";

describe("initial AGENTS.md", () => {
  it("describes the runner job flow, not the v1 ingest loop", () => {
    expect(INITIAL_AGENTS_MD).toContain("JOB.md");
    expect(INITIAL_AGENTS_MD).toContain("Do not run git, push, or use the network");
    expect(INITIAL_AGENTS_MD).toContain("`origin: human`");
    expect(INITIAL_AGENTS_MD).not.toMatch(/INGEST_QUEUE|gdg wiki ingest|wk write|memories\//);
  });

  it("includes Confidentiality and Span ACLs guidance", () => {
    expect(INITIAL_AGENTS_MD).toContain("## Confidentiality and Span ACLs");
    expect(INITIAL_AGENTS_MD).toContain("<acl src=");
    expect(INITIAL_AGENTS_MD).toContain("acl_untagged_read_source");
    expect(INITIAL_AGENTS_MD).toContain("tagging is incomplete, not that you lack permission");
    expect(INITIAL_AGENTS_MD).toContain("Never reset them to the template defaults");
  });
});

describe("extractInstructionSections", () => {
  it("returns non-empty content for Citations and Sensitive information", () => {
    const content = extractInstructionSections(INITIAL_AGENTS_MD, [
      "## Sensitive information",
      "### Citations",
    ]);
    expect(content).toBeTruthy();
    expect(content).toContain("## Sensitive information");
    expect(content).toContain("### Citations");
    expect(content).toContain("Personal email addresses");
    expect(content).not.toContain("## Lint");
    expect(content).not.toContain("## `index` and `log`");
  });

  it("returns null when a required heading is missing", () => {
    expect(
      extractInstructionSections("# Title\n\n### Citations\n\n- x\n", [
        "## Sensitive information",
        "### Citations",
      ]),
    ).toBeNull();
  });
});
