import { describe, expect, it, vi } from "vitest";
import { GoogleApiError } from "~/features/google/client.server";
import {
  createFile,
  createPermission,
  deletePermission,
  getFile,
  isInvalidSharingRequestError,
  listFiles,
  listPermissions,
} from "~/features/google/drive.server";

describe("drive.server", () => {
  it("getFile が fields 付きでファイルメタデータを取得する", async () => {
    let capturedUrl = "";
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      capturedUrl = String(input);
      return Response.json({
        id: "file-1",
        name: "recording.mp4",
        mimeType: "video/mp4",
        webViewLink: "https://drive.google.com/file/d/file-1/view",
        parents: ["folder-1"],
      });
    }) as unknown as typeof fetch;

    const file = await getFile(
      "token-1",
      "file-1",
      "id,name,mimeType,webViewLink,parents",
      fetchMock,
    );
    expect(file.id).toBe("file-1");
    expect(new URL(capturedUrl).searchParams.get("fields")).toBe(
      "id,name,mimeType,webViewLink,parents",
    );
  });

  it("listFiles / listPermissions が nextPageToken を追従して全件取得する", async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/permissions")) {
        if (!url.includes("pageToken=")) {
          return Response.json({
            permissions: [
              { id: "p1", type: "user", role: "reader", emailAddress: "a@example.com" },
            ],
            nextPageToken: "perm-2",
          });
        }
        return Response.json({
          permissions: [{ id: "p2", type: "user", role: "reader", emailAddress: "b@example.com" }],
        });
      }
      if (!url.includes("pageToken=")) {
        return Response.json({
          files: [{ id: "f1", name: "chat.txt", mimeType: "text/plain" }],
          nextPageToken: "file-2",
        });
      }
      return Response.json({
        files: [{ id: "f2", name: "chat2.txt", mimeType: "text/plain" }],
      });
    }) as unknown as typeof fetch;

    const files = await listFiles("token-1", { q: "'folder-1' in parents" }, fetchMock);
    expect(files.map((f) => f.id)).toEqual(["f1", "f2"]);

    const perms = await listPermissions("token-1", "file-1", fetchMock);
    expect(perms.map((p) => p.emailAddress)).toEqual(["a@example.com", "b@example.com"]);
    expect(new URL(urls[2]).searchParams.get("fields")).toBe(
      "nextPageToken,permissions(id,type,role,emailAddress)",
    );
  });

  it("createPermission が既定で sendNotificationEmail=false / role=reader / type=user を送る", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({
        id: "perm-1",
        type: "user",
        role: "reader",
        emailAddress: "invitee@example.com",
      });
    }) as unknown as typeof fetch;

    const created = await createPermission(
      "token-1",
      "file-1",
      { emailAddress: "invitee@example.com" },
      fetchMock,
    );

    expect(created.id).toBe("perm-1");
    const parsedUrl = new URL(capturedUrl);
    expect(parsedUrl.pathname).toBe("/drive/v3/files/file-1/permissions");
    expect(parsedUrl.searchParams.get("sendNotificationEmail")).toBe("false");
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      type: "user",
      role: "reader",
      emailAddress: "invitee@example.com",
    });
  });

  it("Drive API エラーを GoogleApiError として投げる", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { code: 403, status: "PERMISSION_DENIED", message: "Insufficient permissions" } },
        { status: 403 },
      ),
    ) as unknown as typeof fetch;

    await expect(
      createPermission("token-1", "file-1", { emailAddress: "x@example.com" }, fetchMock),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(GoogleApiError);
      const apiErr = err as GoogleApiError;
      expect(apiErr.httpStatus).toBe(403);
      expect(apiErr.apiStatus).toBe("PERMISSION_DENIED");
      expect(apiErr.apiMessage).toBe("Insufficient permissions");
      return true;
    });
  });

  it("createFile が空ファイルメタデータを作成して返す", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({
        id: "probe-file-1",
        name: "Probe Doc",
        mimeType: "application/vnd.google-apps.document",
      });
    }) as unknown as typeof fetch;

    const created = await createFile(
      "token-1",
      {
        name: "Probe Doc",
        mimeType: "application/vnd.google-apps.document",
      },
      fetchMock,
    );

    expect(created).toEqual({
      id: "probe-file-1",
      name: "Probe Doc",
      mimeType: "application/vnd.google-apps.document",
    });
    const parsedUrl = new URL(capturedUrl);
    expect(parsedUrl.pathname).toBe("/drive/v3/files");
    expect(parsedUrl.searchParams.get("fields")).toBe("id,name,mimeType");
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      name: "Probe Doc",
      mimeType: "application/vnd.google-apps.document",
    });
  });

  it("deletePermission が DELETE を送信し 204 空レスポンスを正常終了する", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = init?.method ?? "";
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    await expect(
      deletePermission("token-1", "file-1", "perm-1", fetchMock),
    ).resolves.toBeUndefined();
    expect(capturedMethod).toBe("DELETE");
    expect(new URL(capturedUrl).pathname).toBe("/drive/v3/files/file-1/permissions/perm-1");
  });

  it("isInvalidSharingRequestError が 400 invalidSharingRequest のみ true を返す", () => {
    expect(
      isInvalidSharingRequestError(
        new GoogleApiError({
          httpStatus: 400,
          apiStatus: "invalidSharingRequest",
          apiMessage: "Bad email",
        }),
      ),
    ).toBe(true);
    expect(
      isInvalidSharingRequestError(
        new GoogleApiError({
          httpStatus: 400,
          apiStatus: "INVALID_ARGUMENT",
          apiMessage: "Other error",
        }),
      ),
    ).toBe(false);
    expect(
      isInvalidSharingRequestError(
        new GoogleApiError({
          httpStatus: 403,
          apiStatus: "invalidSharingRequest",
          apiMessage: "Bad",
        }),
      ),
    ).toBe(false);
  });
});
