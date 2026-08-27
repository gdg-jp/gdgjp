import { describe, expect, it } from "vitest";
import {
  integerArray,
  isInvalid,
  optionalInteger,
  optionalNullableString,
  optionalString,
} from "./cli-request";

describe("optionalString", () => {
  it("returns undefined when the field is absent", () => {
    expect(optionalString({}, "name")).toBeUndefined();
  });

  it("returns the value when it is a string", () => {
    expect(optionalString({ name: "DevFest" }, "name")).toBe("DevFest");
  });

  it("flags a present field of the wrong type as invalid, not absent", () => {
    const result = optionalString({ name: 42 }, "name");
    expect(isInvalid(result)).toBe(true);
  });
});

describe("optionalNullableString", () => {
  it("returns undefined when the field is absent (leave untouched)", () => {
    expect(optionalNullableString({}, "defaultDestinationUrl")).toBeUndefined();
  });

  it("returns null when the field is explicitly null (clear it)", () => {
    expect(
      optionalNullableString({ defaultDestinationUrl: null }, "defaultDestinationUrl"),
    ).toBeNull();
  });

  it("flags a present field of the wrong type as invalid rather than clearing it", () => {
    const result = optionalNullableString({ defaultDestinationUrl: 42 }, "defaultDestinationUrl");
    expect(isInvalid(result)).toBe(true);
  });
});

describe("optionalInteger", () => {
  it("returns undefined when the field is absent", () => {
    expect(optionalInteger({}, "sortOrder")).toBeUndefined();
  });

  it("returns the value when it is an integer", () => {
    expect(optionalInteger({ sortOrder: 3 }, "sortOrder")).toBe(3);
  });

  it("flags a present non-numeric field as invalid rather than defaulting", () => {
    const result = optionalInteger({ sortOrder: "x" }, "sortOrder");
    expect(isInvalid(result)).toBe(true);
  });

  it("flags a non-integer number as invalid", () => {
    const result = optionalInteger({ sortOrder: 1.5 }, "sortOrder");
    expect(isInvalid(result)).toBe(true);
  });
});

describe("integerArray", () => {
  it("returns undefined when the field is absent", () => {
    expect(integerArray({}, "chapterIds")).toBeUndefined();
  });

  it("returns the array when every entry is an integer", () => {
    expect(integerArray({ chapterIds: [1, 2] }, "chapterIds")).toEqual([1, 2]);
  });

  it("flags a non-array value as invalid", () => {
    const result = integerArray({ chapterIds: "1,2" }, "chapterIds");
    expect(isInvalid(result)).toBe(true);
  });

  it("flags an array containing a non-integer entry as invalid", () => {
    const result = integerArray({ chapterIds: [1, "2"] }, "chapterIds");
    expect(isInvalid(result)).toBe(true);
  });
});
