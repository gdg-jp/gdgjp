import { describe, expect, it } from "vitest";
import * as root from "../index";

describe("gdg-lib root surface", () => {
  it("does not pull ACL into the dependency-bearing root entrypoint", () => {
    expect(root).not.toHaveProperty("canAccessSource");
    expect(root).not.toHaveProperty("parseAclSpans");
  });
});
