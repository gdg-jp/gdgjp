import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT, sourceFiles } from "./files";

describe("test colocation", () => {
  it("puts every unit test next to the module it covers", () => {
    const offenders = sourceFiles("app", { tests: true })
      .filter((f) => /\.test\.tsx?$/.test(f))
      .filter((f) => {
        const subject = f.replace(/\.test\.tsx?$/, "");
        return ![".ts", ".tsx"].some((ext) => existsSync(join(ROOT, `${subject}${ext}`)));
      });
    expect(offenders).toEqual([]);
  });
});
