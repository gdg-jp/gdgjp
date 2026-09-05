import { describe, expect, it, vi } from "vitest";
import { recordAudit } from "./audit.server";

describe("audit.server", () => {
  it("records an audit log entry into D1", async () => {
    const mockRun = vi.fn().mockResolvedValue({ success: true });
    const mockBind = vi.fn().mockReturnValue({ run: mockRun });
    const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });
    const mockDb = { prepare: mockPrepare } as unknown as D1Database;

    await recordAudit(mockDb, {
      actorUserId: "user-123",
      actorRole: "is_admin",
      chapterId: 42,
      action: "chapter.cross_access",
      targetType: "chapter",
      targetId: "42",
    });

    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO audit_log"));
    expect(mockBind).toHaveBeenCalledWith(
      expect.any(String), // id
      "user-123",
      "is_admin",
      42,
      "chapter.cross_access",
      "chapter",
      "42",
      expect.any(Number), // occurredAt
    );
    expect(mockRun).toHaveBeenCalled();
  });

  it("propagates error when writing audit log fails", async () => {
    const mockRun = vi.fn().mockRejectedValue(new Error("Database write error"));
    const mockBind = vi.fn().mockReturnValue({ run: mockRun });
    const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });
    const mockDb = { prepare: mockPrepare } as unknown as D1Database;

    await expect(
      recordAudit(mockDb, {
        actorUserId: "user-123",
        actorRole: "is_admin",
        chapterId: 42,
        action: "chapter.cross_access",
        targetType: "chapter",
        targetId: "42",
      }),
    ).rejects.toThrow("Database write error");
  });
});
