import { describe, expect, it } from "vitest";
import { read, sourceFiles } from "./files";

describe("file size", () => {
  it("keeps every source file at or under 400 lines", () => {
    const offenders = [...sourceFiles("app"), ...sourceFiles("workers")]
      .map((f) => [f, read(f).split("\n").length] as const)
      .filter(([, n]) => n > 400)
      .map(([f, n]) => `${f}: ${n}`);
    expect(offenders).toEqual([]);
  });
});
