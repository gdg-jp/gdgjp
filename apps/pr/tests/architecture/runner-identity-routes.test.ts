import { describe, expect, it } from "vitest";
import { read, sourceFiles } from "./files";

describe("runner identity", () => {
  it("accepts the runner token only under app/routes/api/runner/", () => {
    // RUNNER_TOKEN reads every campaign; any other route accepting it widens that on purpose or not at all.
    const users = sourceFiles("app/routes").filter((f) => /requireRunner\(/.test(read(f)));
    expect(users.every((f) => f.startsWith("app/routes/api/runner/"))).toBe(true);
    expect(users.length).toBe(5);
  });
});
