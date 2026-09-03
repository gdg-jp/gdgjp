import { describe, expect, it } from "vitest";
import { classifyTool } from "../src/classify.js";

describe("classifyTool", () => {
  it.each([
    "wk ls pages/",
    "wk read pages/about/page.md",
    "wk grep venue pages/",
    "/opt/gdg-agent/bin/wk search policy",
  ])("classifies read-only wk shell command as a retriever: %s", (command) => {
    expect(classifyTool("Shell", { command })).toBe("retriever");
  });

  it("does not classify mutating wk or arbitrary shell commands as retrievers", () => {
    expect(classifyTool("Shell", { command: "wk write pages/a/page.md" })).toBe("tool");
    expect(classifyTool("Shell", { command: "pnpm test" })).toBe("tool");
  });
});
