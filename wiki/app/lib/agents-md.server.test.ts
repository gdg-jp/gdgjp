import { describe, expect, it } from "vitest";
import { INITIAL_AGENTS_MD } from "./agents-md.server";

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
});
