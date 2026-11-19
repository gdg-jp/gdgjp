import { describe, expect, it } from "vitest";
import { inviteSourcesToFormDefaults, parseMeetingCreateForm, parseMeetingEditForm } from "./form";

function buildFormData(values: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(values)) {
    form.set(k, v);
  }
  return form;
}

describe("parseMeetingEditForm", () => {
  it("フォームに別チャプター ID が送られても固定の主催チャプター ID を維持する", () => {
    const form = buildFormData({
      title: "編集後タイトル",
      description: "更新後の説明",
      date: "2026-12-01",
      startTime: "19:30",
      endTime: "20:30",
      timeZone: "Asia/Tokyo",
      hostChapterId: "999",
      includeHostOrganizers: "true",
      accessType: "TRUSTED",
      additionalChapters: JSON.stringify([
        { chapterId: 2, scope: "chapter_all", role: "participant" },
      ]),
      cohostEmails: "cohost@example.com",
      participantEmails: "guest@example.com",
    });

    const result = parseMeetingEditForm(form, 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.hostChapterId).toBe(1);
    expect(result.data.accessType).toBe("TRUSTED");
    expect(result.data.sources).toEqual([
      { kind: "host_chapter_organizers", chapterId: 1, email: null, role: "cohost" },
      { kind: "chapter_all", chapterId: 2, email: null, role: "participant" },
      { kind: "email", chapterId: null, email: "cohost@example.com", role: "cohost" },
      { kind: "email", chapterId: null, email: "guest@example.com", role: "participant" },
    ]);
  });

  it("作成フォームでは未所属チャプター ID を拒否する", () => {
    const form = buildFormData({
      title: "タイトル",
      description: "",
      date: "2026-12-01",
      startTime: "19:00",
      endTime: "20:00",
      timeZone: "Asia/Tokyo",
      hostChapterId: "999",
      includeHostOrganizers: "false",
      accessType: "RESTRICTED",
    });

    const result = parseMeetingCreateForm(form, new Set([1]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors.hostChapterId).toBeTruthy();
  });

  it("自動記録フラグ（文字起こし・Gemini Notes・録画）を true/on/false/未指定から boolean へ変換する", () => {
    const base = {
      title: "タイトル",
      description: "",
      date: "2026-12-01",
      startTime: "19:00",
      endTime: "20:00",
      timeZone: "Asia/Tokyo",
      hostChapterId: "1",
      includeHostOrganizers: "true",
      accessType: "RESTRICTED",
    };

    const checkedResult = parseMeetingCreateForm(
      buildFormData({
        ...base,
        autoTranscription: "true",
        autoSmartNotes: "on",
        autoRecording: "false",
      }),
      new Set([1]),
    );
    expect(checkedResult.ok).toBe(true);
    if (!checkedResult.ok) return;
    expect(checkedResult.data.autoTranscription).toBe(true);
    expect(checkedResult.data.autoSmartNotes).toBe(true);
    expect(checkedResult.data.autoRecording).toBe(false);

    const omittedResult = parseMeetingEditForm(
      buildFormData({
        ...base,
        autoRecording: "true",
      }),
      1,
    );
    expect(omittedResult.ok).toBe(true);
    if (!omittedResult.ok) return;
    expect(omittedResult.data.autoTranscription).toBe(false);
    expect(omittedResult.data.autoSmartNotes).toBe(false);
    expect(omittedResult.data.autoRecording).toBe(true);
  });
});

describe("inviteSourcesToFormDefaults", () => {
  it("meeting_invite_sources の配列からフォーム初期値を復元する", () => {
    const defaults = inviteSourcesToFormDefaults([
      { kind: "host_chapter_organizers", chapterId: 1, email: null, role: "cohost" },
      { kind: "chapter_organizers", chapterId: 2, email: null, role: "cohost" },
      { kind: "chapter_all", chapterId: 3, email: null, role: "participant" },
      { kind: "email", chapterId: null, email: "cohost@example.com", role: "cohost" },
      { kind: "email", chapterId: null, email: "guest1@example.com", role: "participant" },
      { kind: "email", chapterId: null, email: "guest2@example.com", role: "participant" },
    ]);

    expect(defaults).toEqual({
      includeHostOrganizers: true,
      additionalChapters: [
        { chapterId: 2, scope: "chapter_organizers", role: "cohost" },
        { chapterId: 3, scope: "chapter_all", role: "participant" },
      ],
      cohostEmails: "cohost@example.com",
      participantEmails: "guest1@example.com\nguest2@example.com",
    });
  });
});
