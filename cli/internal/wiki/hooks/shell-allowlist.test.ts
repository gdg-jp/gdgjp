import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { inspectGwsScript, inspectWkScript, isApprovedGwsArgs } from "./shell-allowlist.ts";

const gwsAllowlist = new Set(["drive files list", "drive files get"]);

describe("inspectGwsScript", () => {
  it("allows an approved service/resource/method triple", () => {
    const result = inspectGwsScript("gws drive files list", gwsAllowlist);
    assert.equal(result.ok, true);
  });

  it("allows an approved triple with a positional argument and approved flags", () => {
    const result = inspectGwsScript("gws drive files get FILE_ID --json", gwsAllowlist);
    assert.equal(result.ok, true);
  });

  it("does not implicitly approve a sibling method under an approved resource", () => {
    const result = inspectGwsScript("gws drive files emptyTrash", gwsAllowlist);
    assert.equal(result.ok, false);
  });

  it("denies --upload with a specific reason", () => {
    const result = inspectGwsScript("gws drive files list --upload", gwsAllowlist);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.reason, /--upload/);
  });

  it("denies a flag outside the approved set", () => {
    const result = inspectGwsScript("gws drive files list --exec", gwsAllowlist);
    assert.equal(result.ok, false);
  });

  it("denies single-dash flags outside the approved set, not just double-dash", () => {
    for (const flag of ["-x", "-h", "-V"]) {
      const result = inspectGwsScript(`gws drive files list ${flag}`, gwsAllowlist);
      assert.equal(result.ok, false, flag);
    }
  });

  it("denies malformed shell (pipes, subshells, chaining into another binary)", () => {
    for (const command of [
      "gws drive files list | cat",
      "gws drive files list; rm -rf /",
      "gws drive files $(id)",
      "gws drive files list && wk read pages/x/page.md",
    ]) {
      const result = inspectGwsScript(command, gwsAllowlist);
      assert.equal(result.ok, false, command);
    }
  });

  it("denies commands that do not start with gws", () => {
    const result = inspectGwsScript("cat pages/x/page.md", gwsAllowlist);
    assert.equal(result.ok, false);
  });

  it("regression: wk behavior is unchanged by the gws additions", () => {
    assert.equal(inspectWkScript("wk read pages/x/page.md").ok, true);
    assert.equal(inspectWkScript("cat pages/x/page.md").ok, false);
    assert.equal(inspectWkScript("wk read a; wk read b").ok, false);
  });
});

describe("isApprovedGwsArgs", () => {
  it("validates argv without the leading binary name (gws.ts's own view)", () => {
    assert.equal(isApprovedGwsArgs(["drive", "files", "list"], gwsAllowlist).ok, true);
    assert.equal(isApprovedGwsArgs(["drive", "files", "emptyTrash"], gwsAllowlist).ok, false);
    assert.equal(isApprovedGwsArgs(["drive", "files", "list", "--upload"], gwsAllowlist).ok, false);
  });

  it("fails closed against an empty allowlist", () => {
    assert.equal(isApprovedGwsArgs(["drive", "files", "list"], new Set()).ok, false);
  });
});
