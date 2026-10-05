import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectConfidentialSourceIds,
  insertAclSpans,
  isCatalogOrLogPage,
  sourceNeedsAclTag,
  untaggedWrapEligibleAddedLines,
} from "./acl-insert-core.ts";

const fm = "---\nvisibility: public\n---\n";
const page = "pages/venues/umeda/page.md";

describe("acl-insert-core", () => {
  it("tags only visibilities narrower than member", () => {
    assert.equal(sourceNeedsAclTag("member"), false);
    assert.equal(sourceNeedsAclTag("organizer"), true);
    assert.equal(isCatalogOrLogPage("pages/venues/page.md"), true);
    assert.equal(isCatalogOrLogPage(page), false);
    assert.equal(isCatalogOrLogPage("pages/log/page.md"), true);
  });

  it("wraps added body lines with every confidential source (AND)", () => {
    const next = `${fm}derived fact\n`;
    const result = insertAclSpans(page, next, fm, ["aaa", "bbb"]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.markdown, /<acl src="aaa bbb">\nderived fact\n<\/acl>/);
    assert.equal(result.markdown.startsWith("---\nvisibility: public\n---\n"), true);
    assert.equal(result.markdown.includes("<acl"), true);
  });

  it("does not wrap catalog, log, front matter, or empty S", () => {
    const next = `${fm}a catalog line\n`;
    const catalog = insertAclSpans("pages/venues/page.md", next, fm, ["org"]);
    assert.equal(catalog.ok, true);
    if (catalog.ok) assert.equal(catalog.markdown, next);
    const empty = insertAclSpans(page, next, fm, []);
    assert.equal(empty.ok, true);
    if (empty.ok) assert.equal(empty.markdown, next);
  });

  it("refuses confidential headings and fenced lines without writing a wrap", () => {
    const heading = insertAclSpans(page, `${fm}# Secret event\n`, fm, ["org-src"]);
    assert.equal(heading.ok, false);
    if (heading.ok) return;
    assert.match(heading.message, /org-src/);
    assert.match(heading.message, /page\.md:4/);

    const fenced = insertAclSpans(page, `${fm}\`\`\`\nsecret-id\n\`\`\`\n`, fm, ["org-src"]);
    assert.equal(fenced.ok, false);

    const missing = insertAclSpans(page, "not a page\n", "", ["org-src"]);
    assert.equal(missing.ok, false);
  });

  it("does not nest inside an existing span", () => {
    const tagged = `${fm}<acl src="org-src">\nalready\n</acl>\n`;
    const result = insertAclSpans(page, tagged, fm, ["org-src"]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.markdown.match(/<acl /g)?.length, 1);
  });

  it("collects locked and traced sources and ignores member", () => {
    const ids = collectConfidentialSourceIds({
      reads: ["raw/org-src/doc.md"],
      directSourceIds: ["mem-1"],
      lockedSourceIds: ["locked-1", "member-src"],
      documents: [
        { sourceId: "org-src", path: "raw/org-src/doc.md", visibility: "organizer" },
        { sourceId: "locked-1", path: "raw/locked-1/doc.md", visibility: "private" },
        { sourceId: "member-src", path: "raw/member-src/doc.md", visibility: "member" },
      ],
      visibilityBySourceId: {
        "org-src": "organizer",
        "mem-1": "chapter-organizer",
        "locked-1": "private",
        "member-src": "member",
      },
    });
    assert.deepEqual(ids, ["locked-1", "mem-1", "org-src"]);
  });

  it("reports untagged added lines in the index blob", () => {
    const staged = `${fm}plain secret\n`;
    const findings = untaggedWrapEligibleAddedLines(page, staged, fm, ["org-src"]);
    assert.deepEqual(findings, [`${page}:4`]);
    assert.deepEqual(untaggedWrapEligibleAddedLines(page, staged, staged, ["org-src"]), []);
  });
});
