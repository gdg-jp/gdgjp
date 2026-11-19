import { describe, expect, it } from "vitest";
import { isValidEmail, normalizeEmail } from "~/features/google/email";

describe("normalizeEmail", () => {
  it("前後の空白除去と小文字化を行う", () => {
    expect(normalizeEmail("  Community-Support@GDGOC.JP  ")).toBe("community-support@gdgoc.jp");
  });

  it("gmail.com はローカル部のドットを除去する", () => {
    expect(normalizeEmail("Taro.Yamada@Gmail.com")).toBe("taroyamada@gmail.com");
  });

  it("googlemail.com もローカル部のドットを除去しドメインは保持する", () => {
    expect(normalizeEmail("a.b.c@GoogleMail.com")).toBe("abc@googlemail.com");
  });

  it("gmail.com / googlemail.com でも +tag 以降を保持する", () => {
    expect(normalizeEmail("Taro.Yamada+meet@gmail.com")).toBe("taroyamada+meet@gmail.com");
    expect(normalizeEmail("a.b+tag@googlemail.com")).toBe("ab+tag@googlemail.com");
  });

  it("独自ドメインではローカル部のドットを保持する", () => {
    expect(normalizeEmail("first.last@gdgoc.jp")).toBe("first.last@gdgoc.jp");
    expect(normalizeEmail("First.Last+alias@example.com")).toBe("first.last+alias@example.com");
  });
});

describe("isValidEmail", () => {
  it("妥当なメールアドレスを true と判定する", () => {
    expect(isValidEmail("community-support@gdgoc.jp")).toBe(true);
    expect(isValidEmail("taro.yamada+tag@gmail.com")).toBe(true);
  });

  it("空白・制御文字・@ 不正・ドメイン不正を false と判定する", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail(" user@example.com")).toBe(false);
    expect(isValidEmail("user @example.com")).toBe(false);
    expect(isValidEmail("user\n@example.com")).toBe(false);
    expect(isValidEmail("user\u0000@example.com")).toBe(false);
    expect(isValidEmail("user\u007f@example.com")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("user@")).toBe(false);
    expect(isValidEmail("a@b@example.com")).toBe(false);
    expect(isValidEmail("user@localhost")).toBe(false);
    expect(isValidEmail("user@.example.com")).toBe(false);
    expect(isValidEmail("user@example.com.")).toBe(false);
    expect(isValidEmail("user@example..com")).toBe(false);
  });
});
