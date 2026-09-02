import { describe, expect, it, vi } from "vitest";

vi.mock("~/features/auth/utils.server", () => ({
  requireAdmin: vi.fn(),
}));

vi.mock("~/lib/db.server", () => ({
  getDb: vi.fn(),
}));

import * as schema from "~/db/schema";
import { requireAdmin } from "~/features/auth/utils.server";
import { getDb } from "~/lib/db.server";
import enCommon from "~/locales/en/common.json";
import jaCommon from "~/locales/ja/common.json";
import { action, loader } from "./tags";

const mockContext = { cloudflare: { env: {} as Env } } as Parameters<typeof loader>[0]["context"];

function makeArgs(request: Request) {
  return {
    request,
    context: mockContext,
    params: {},
    unstable_pattern: "/admin/tags",
    unstable_url: new URL(request.url),
  };
}

function createFormData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    fd.append(key, value);
  }
  return fd;
}

describe("admin.tags i18n parity", () => {
  it("has matching keys under admin.tags between ja and en common.json", () => {
    const jaKeys = Object.keys(jaCommon.admin.tags).sort();
    const enKeys = Object.keys(enCommon.admin.tags).sort();
    expect(jaKeys).toEqual(enKeys);
  });

  it("defines all required tag dialog and error keys in both locales", () => {
    const requiredKeys = [
      "new_tag_dialog_title",
      "edit_tag_dialog_title",
      "col_label",
      "error_required",
      "error_color_invalid",
      "error_slug_invalid",
      "error_slug_taken",
    ] as const;

    for (const key of requiredKeys) {
      expect(jaCommon.admin.tags).toHaveProperty(key);
      expect(enCommon.admin.tags).toHaveProperty(key);
    }
  });
});

describe("admin.tags loader", () => {
  it("requires admin and returns tags list", async () => {
    const mockTags = [
      { slug: "typescript", labelJa: "TS", labelEn: "TypeScript", color: "#3178c6", pageCount: 5 },
    ];

    vi.mocked(getDb).mockReturnValue({
      select: () => ({
        from: () => ({
          orderBy: () => ({
            all: () => Promise.resolve(mockTags),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getDb>);

    const request = new Request("http://localhost/admin/tags");
    const result = await loader(makeArgs(request));

    expect(requireAdmin).toHaveBeenCalledWith(request, mockContext.cloudflare.env);
    expect(result).toEqual({ tags: mockTags });
  });
});

describe("admin.tags action", () => {
  describe("createTag", () => {
    it("returns errorKey for missing required fields", async () => {
      const formData = createFormData({
        intent: "createTag",
        slug: "",
        labelJa: "テスト",
        labelEn: "Test",
        color: "#3b82f6",
      });
      const request = new Request("http://localhost/admin/tags", {
        method: "POST",
        body: formData,
      });

      const result = await action(makeArgs(request));
      expect(result).toEqual({ errorKey: "admin.tags.error_required" });
    });

    it("returns errorKey for invalid slug regex", async () => {
      const formData = createFormData({
        intent: "createTag",
        slug: "Invalid_Slug!",
        labelJa: "テスト",
        labelEn: "Test",
        color: "#3b82f6",
      });
      const request = new Request("http://localhost/admin/tags", {
        method: "POST",
        body: formData,
      });

      const result = await action(makeArgs(request));
      expect(result).toEqual({ errorKey: "admin.tags.error_slug_invalid" });
    });

    it("returns errorKey for invalid color format", async () => {
      const formData = createFormData({
        intent: "createTag",
        slug: "valid-slug",
        labelJa: "テスト",
        labelEn: "Test",
        color: "blue",
      });
      const request = new Request("http://localhost/admin/tags", {
        method: "POST",
        body: formData,
      });

      const result = await action(makeArgs(request));
      expect(result).toEqual({ errorKey: "admin.tags.error_color_invalid" });
    });

    it("returns errorKey with errorParams for duplicate slug", async () => {
      vi.mocked(getDb).mockReturnValue({
        select: () => ({
          from: () => ({
            where: () => ({
              get: () => Promise.resolve({ slug: "existing-tag" }),
            }),
          }),
        }),
      } as unknown as ReturnType<typeof getDb>);

      const formData = createFormData({
        intent: "createTag",
        slug: "existing-tag",
        labelJa: "テスト",
        labelEn: "Test",
        color: "#3b82f6",
      });
      const request = new Request("http://localhost/admin/tags", {
        method: "POST",
        body: formData,
      });

      const result = await action(makeArgs(request));
      expect(result).toEqual({
        errorKey: "admin.tags.error_slug_taken",
        errorParams: { slug: "existing-tag" },
      });
    });

    it("inserts tag and returns ok on valid creation", async () => {
      let insertedValues: unknown = null;
      vi.mocked(getDb).mockReturnValue({
        select: () => ({
          from: () => ({
            where: () => ({
              get: () => Promise.resolve(null),
            }),
          }),
        }),
        insert: () => ({
          values: (vals: unknown) => {
            insertedValues = vals;
            return Promise.resolve();
          },
        }),
      } as unknown as ReturnType<typeof getDb>);

      const formData = createFormData({
        intent: "createTag",
        slug: "New-Tag ",
        labelJa: " 新タグ ",
        labelEn: " New Tag ",
        color: "#123456",
      });
      const request = new Request("http://localhost/admin/tags", {
        method: "POST",
        body: formData,
      });

      const result = await action(makeArgs(request));
      expect(result).toEqual({ ok: true, created: "new-tag" });
      expect(insertedValues).toEqual({
        slug: "new-tag",
        labelJa: "新タグ",
        labelEn: "New Tag",
        color: "#123456",
      });
    });
  });

  describe("updateTag", () => {
    it("returns errorKey when required fields are missing", async () => {
      const formData = createFormData({
        intent: "updateTag",
        slug: "my-tag",
        labelJa: "",
        labelEn: "Test",
        color: "#3b82f6",
      });
      const request = new Request("http://localhost/admin/tags", {
        method: "POST",
        body: formData,
      });

      const result = await action(makeArgs(request));
      expect(result).toEqual({ errorKey: "admin.tags.error_required" });
    });

    it("returns errorKey when color is invalid", async () => {
      const formData = createFormData({
        intent: "updateTag",
        slug: "my-tag",
        labelJa: "テスト",
        labelEn: "Test",
        color: "#fff",
      });
      const request = new Request("http://localhost/admin/tags", {
        method: "POST",
        body: formData,
      });

      const result = await action(makeArgs(request));
      expect(result).toEqual({ errorKey: "admin.tags.error_color_invalid" });
    });

    it("updates tag without modifying slug", async () => {
      let updatedSet: unknown = null;
      vi.mocked(getDb).mockReturnValue({
        update: () => ({
          set: (vals: unknown) => {
            updatedSet = vals;
            return {
              where: () => Promise.resolve(),
            };
          },
        }),
      } as unknown as ReturnType<typeof getDb>);

      const formData = createFormData({
        intent: "updateTag",
        slug: "my-tag",
        labelJa: "更新タグ",
        labelEn: "Updated Tag",
        color: "#abcdef",
      });
      const request = new Request("http://localhost/admin/tags", {
        method: "POST",
        body: formData,
      });

      const result = await action(makeArgs(request));
      expect(result).toEqual({ ok: true, updated: "my-tag" });
      expect(updatedSet).toEqual({
        labelJa: "更新タグ",
        labelEn: "Updated Tag",
        color: "#abcdef",
      });
    });
  });

  describe("deleteTag", () => {
    it("deletes pageTags BEFORE tags to prevent orphan associations", async () => {
      const deleteCalls: unknown[] = [];
      vi.mocked(getDb).mockReturnValue({
        delete: (table: unknown) => {
          deleteCalls.push(table);
          return {
            where: () => Promise.resolve(),
          };
        },
      } as unknown as ReturnType<typeof getDb>);

      const formData = createFormData({
        intent: "deleteTag",
        slug: "deprecated-tag",
      });
      const request = new Request("http://localhost/admin/tags", {
        method: "POST",
        body: formData,
      });

      const result = await action(makeArgs(request));
      expect(result).toEqual({ ok: true, deleted: true });
      expect(deleteCalls).toEqual([schema.pageTags, schema.tags]);
    });

    it("returns empty object if slug is missing", async () => {
      const formData = createFormData({
        intent: "deleteTag",
        slug: "",
      });
      const request = new Request("http://localhost/admin/tags", {
        method: "POST",
        body: formData,
      });

      const result = await action(makeArgs(request));
      expect(result).toEqual({});
    });
  });
});
