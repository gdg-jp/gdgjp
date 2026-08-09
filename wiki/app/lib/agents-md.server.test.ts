import { describe, expect, it } from "vitest";
import { AGENTS_MD } from "./agents-md.server";

describe("AGENTS_MD", () => {
  it("requires pushing before ingest finalization and forbids manual state changes", () => {
    const push = "Commit the changes and run `git push`.";
    const finalize = "After the push succeeds, run `gdg wiki ingest --commit`";

    expect(AGENTS_MD).toContain(push);
    expect(AGENTS_MD).toContain(finalize);
    expect(AGENTS_MD.indexOf(push)).toBeLessThan(AGENTS_MD.indexOf(finalize));
    expect(AGENTS_MD).toContain("reports `Marked … as ingested` and the queue advances");
    expect(AGENTS_MD).toContain("Do not manually edit `INGEST_QUEUE.md`, `.gdgwiki/**`");
  });
});
