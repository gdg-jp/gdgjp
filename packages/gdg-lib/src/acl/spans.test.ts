import { describe, expect, it } from "vitest";
import {
  ACL_REDACTION_PLACEHOLDER,
  aclSpanSourceIds,
  computeAclSourceIdsJson,
  metadataContainsAclTag,
  parseAclSpans,
  redactAclSpans,
  validateAclSpans,
} from "./spans";

describe("ACL span evaluator", () => {
  it("parses spans, including block and multiple source ids", () => {
    const spans = parseAclSpans('before\n<acl src="a b">\nsecret\n</acl>\nafter');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.srcIds).toEqual(["a", "b"]);
    expect(spans[0]?.block).toBe(true);
    expect(aclSpanSourceIds('<acl src="a b">x</acl><acl src="a">y</acl>')).toEqual(["a", "b"]);
  });

  it("rejects malformed spans and strips tags from either redaction path", () => {
    expect(validateAclSpans('<acl src="a"><acl src="b">x</acl></acl>').ok).toBe(false);
    const markdown = 'visible <acl src="a">secret</acl> end';
    const denied = redactAclSpans(markdown, () => false);
    const allowed = redactAclSpans(markdown, () => true);
    expect(denied.markdown).not.toContain("<acl");
    expect(denied.markdown).toContain(ACL_REDACTION_PLACEHOLDER);
    expect(allowed.markdown).not.toContain("<acl");
    expect(allowed.markdown).toContain("secret");
  });

  it("ignores fenced examples and rejects ACL metadata", () => {
    expect(parseAclSpans('```\n<acl src="x">nope</acl>\n```')).toEqual([]);
    expect(metadataContainsAclTag('title <acl src="x">')).toBe(true);
    expect(computeAclSourceIdsJson('<acl src="ja">x</acl>', '<acl src="en ja">y</acl>')).toBe(
      '["en","ja"]',
    );
  });
});
