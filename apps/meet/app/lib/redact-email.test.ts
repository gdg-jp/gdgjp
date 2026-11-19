import { describe, expect, it } from "vitest";
import { maskEmail, maskEmailsInText } from "./redact-email";

describe("redact-email", () => {
  it("maskEmail masks the local part while preserving the first character and domain", () => {
    expect(maskEmail("user@example.com")).toBe("u***@example.com");
    expect(maskEmail(" a@gdgoc.jp ")).toBe("a***@gdgoc.jp");
    expect(maskEmail("first.last+tag@gmail.com")).toBe("f***@gmail.com");
    expect(maskEmail("invalid")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
    expect(maskEmail("user@")).toBe("***");
  });

  it("maskEmailsInText masks all email addresses embedded in error messages", () => {
    expect(
      maskEmailsInText(
        "Google API エラー (400 invalidSharingRequest): Bad email <alice.smith+1@example.com> and bob@gmail.com",
      ),
    ).toBe(
      "Google API エラー (400 invalidSharingRequest): Bad email <a***@example.com> and b***@gmail.com",
    );
    expect(maskEmailsInText("plain error without email")).toBe("plain error without email");
  });
});
