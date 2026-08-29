import { describe, expect, it } from "vitest";
import { INITIAL_AGENTS_MD, extractInstructionSections } from "./agents-md.server";

describe("initial AGENTS.md", () => {
  it("requires snapshot verification before ingest finalization", () => {
    const push = "Commit the changes and run `git push`.";
    const verify = "Fetch the server-generated snapshot and fast-forward the local branch";
    const finalize = "Run `gdg wiki ingest --commit`";

    expect(INITIAL_AGENTS_MD).toContain(push);
    expect(INITIAL_AGENTS_MD).toContain(verify);
    expect(INITIAL_AGENTS_MD).toContain(finalize);
    expect(INITIAL_AGENTS_MD.indexOf(push)).toBeLessThan(INITIAL_AGENTS_MD.indexOf(verify));
    expect(INITIAL_AGENTS_MD.indexOf(verify)).toBeLessThan(INITIAL_AGENTS_MD.indexOf(finalize));
    expect(INITIAL_AGENTS_MD).toContain("confirm that the processed source is no longer first");
    expect(INITIAL_AGENTS_MD).toContain("do not edit `INGEST_QUEUE.md` or `.gdgwiki/` manually");
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
