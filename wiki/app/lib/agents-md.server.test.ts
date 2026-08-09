import { describe, expect, it } from "vitest";
import { AGENTS_MD } from "./agents-md.server";

describe("AGENTS_MD", () => {
  it("requires snapshot verification before ingest finalization", () => {
    const push = "Commit the changes and run `git push`.";
    const verify = "Fetch the server-generated snapshot and fast-forward the local branch";
    const finalize = "Run `gdg wiki ingest --commit`";

    expect(AGENTS_MD).toContain(push);
    expect(AGENTS_MD).toContain(verify);
    expect(AGENTS_MD).toContain(finalize);
    expect(AGENTS_MD.indexOf(push)).toBeLessThan(AGENTS_MD.indexOf(verify));
    expect(AGENTS_MD.indexOf(verify)).toBeLessThan(AGENTS_MD.indexOf(finalize));
    expect(AGENTS_MD).toContain("confirm that the processed source is no longer first");
    expect(AGENTS_MD).toContain("do not edit `INGEST_QUEUE.md` or `.gdgwiki/` manually");
  });
});
