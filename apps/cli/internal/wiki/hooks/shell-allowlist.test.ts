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

  it("allows the safe output/metadata flags (--format, --dry-run, --page-delay, --api-version)", () => {
    for (const command of [
      "gws drive files list --format json",
      "gws drive files list --dry-run",
      "gws drive files list --page-delay 200",
      "gws drive files list --api-version v3",
    ]) {
      const result = inspectGwsScript(command, gwsAllowlist);
      assert.equal(result.ok, true, command);
    }
  });

  it("still denies flags with file I/O or scope implications", () => {
    for (const command of [
      "gws drive files list --output /tmp/x",
      "gws drive files list -o /tmp/x",
      "gws drive files list --sanitize projects/p/locations/l/templates/t",
      "gws drive files list --upload-content-type text/plain",
    ]) {
      const result = inspectGwsScript(command, gwsAllowlist);
      assert.equal(result.ok, false, command);
    }
  });

  it("strips a trailing `2>&1` (stderr merge) before grammar validation", () => {
    const result = inspectGwsScript("gws drive files list --format json 2>&1", gwsAllowlist);
    assert.equal(result.ok, true);
  });

  it("reconstructs a literal single quote embedded via the '\\'' idiom", () => {
    // gws drive files list --params 'x'\''y'  ->  --params value should be x'y
    const command = "gws drive files list --params 'x'\\''y'";
    const result = inspectGwsScript(command, gwsAllowlist);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.simples, [["gws", "drive", "files", "list", "--params", "x'y"]]);
  });

  it("allows the real production --params payload with an embedded Drive query literal", () => {
    const command =
      "gws drive files list --params '{\"q\": \"mimeType='\\''application/vnd.google-apps.document'\\'' and trashed=false\", \"pageSize\": 50}' --format table 2>&1";
    const result = inspectGwsScript(command, gwsAllowlist);
    assert.equal(result.ok, true);
  });

  it("does not let the escaped-quote idiom smuggle an unquoted && chain separator", () => {
    const result = inspectGwsScript("gws drive files list --params a\\'&& rm -rf /", gwsAllowlist);
    assert.equal(result.ok, false);
  });

  it("still denies a stray backslash not immediately followed by a single quote", () => {
    for (const command of [
      "gws drive files list --params x\\y",
      "gws drive files list --params x\\",
    ]) {
      const result = inspectGwsScript(command, gwsAllowlist);
      assert.equal(result.ok, false, command);
    }
  });

  it("&& inside real quotes stays literal content, not a chain separator", () => {
    const result = inspectGwsScript("gws drive files list --params 'a && b'", gwsAllowlist);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.simples, [["gws", "drive", "files", "list", "--params", "a && b"]]);
  });

  it("still denies a semicolon immediately adjacent to a quoted fragment", () => {
    const result = inspectGwsScript("gws drive files list --params 'x';id", gwsAllowlist);
    assert.equal(result.ok, false);
  });

  it("matches the flag name when clap's `--flag=value` form is used", () => {
    for (const command of [
      "gws drive files list --format=json",
      "gws drive files list --page-limit=50",
    ]) {
      const result = inspectGwsScript(command, gwsAllowlist);
      assert.equal(result.ok, true, command);
    }
    for (const command of [
      "gws drive files list --upload=/etc/passwd",
      "gws drive files list --sanitize=projects/p/locations/l/templates/t",
    ]) {
      const result = inspectGwsScript(command, gwsAllowlist);
      assert.equal(result.ok, false, command);
    }
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

  it("wk also gets the trailing 2>&1 strip and the '\\'' quote idiom (shared tokenizer)", () => {
    const trailing = inspectWkScript("wk ls pages/ 2>&1");
    assert.equal(trailing.ok, true);
    const quoted = inspectWkScript("wk grep 'x'\\''y' pages/");
    assert.equal(quoted.ok, true);
    if (!quoted.ok) return;
    assert.deepEqual(quoted.simples, [["wk", "grep", "x'y", "pages/"]]);
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
