import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckInPage from "./page";

const session = {
  accessToken: "kwansai-access-token",
  expires: "2099-01-01T00:00:00.000Z",
  user: { chapters: [{ chapterId: 7, chapterSlug: "gdg-kwansai", role: "organizer" }] },
};

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: session, status: "authenticated" }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {} }),
}));

const event: EventSummary = {
  id: "123456",
  url: "https://connpass.com/event/123456/",
  editUrl: "https://connpass.com/event/123456/edit/",
  status: "published",
  title: "DevFest Kwansai",
  startAt: "2099-12-01T10:00:00+09:00",
  endAt: "2099-12-01T18:00:00+09:00",
};

const api = vi.fn<typeof fetch>();
let root: Root;
let container: HTMLElement;

function eventsFail() {
  return Response.json({ error: "サーバー間リクエストでエラーが発生しました" }, { status: 500 });
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CheckInPage />));
  await settle();
}

function dialog() {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

function button(name: string, scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.getAttribute("aria-label") === name || candidate.textContent?.trim() === name,
  );
}

async function click(element: HTMLElement | null | undefined) {
  if (!element) throw new Error("element to click is missing");
  await act(async () => element.click());
  await settle();
}

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  api.mockReset();
  vi.stubGlobal("fetch", api);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("first-run settings dialog", () => {
  it("shows the failure and can be closed when events cannot be loaded", async () => {
    api.mockResolvedValue(eventsFail());
    await render();

    const blocking = dialog();
    expect(blocking?.textContent).toContain("イベントの取得に失敗しました");
    expect(blocking?.textContent).toContain("サーバー間リクエストでエラーが発生しました");
    expect(button("保存", blocking ?? document)?.disabled).toBe(true);
    expect(button("再読み込み", blocking ?? document)).toBeDefined();

    await click(button("閉じる", blocking ?? document));
    expect(dialog()).toBeNull();
    expect(document.querySelector("h1")?.textContent).toContain("connpass 連続受付システム");

    await click(button("受付設定"));
    expect(dialog()?.textContent).toContain("イベントの取得に失敗しました");
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(dialog()).toBeNull();

    await click(button("受付設定"));
    await click(button("キャンセル", dialog() ?? document));
    expect(dialog()).toBeNull();
  });

  it("retries the event list and keeps blocking until an available event is saved", async () => {
    api.mockResolvedValueOnce(eventsFail());
    api.mockResolvedValueOnce(Response.json({ events: [event] }));
    await render();

    await click(button("再読み込み", dialog() ?? document));
    expect(api).toHaveBeenCalledTimes(2);
    const choosing = dialog();
    expect(choosing?.textContent).toContain("DevFest Kwansai");
    expect(button("閉じる", choosing ?? document)).toBeUndefined();
    expect(button("キャンセル", choosing ?? document)).toBeUndefined();
    expect(button("保存", choosing ?? document)?.disabled).toBe(true);

    await click(choosing?.querySelector<HTMLInputElement>('input[value="123456"]'));
    expect(button("保存", choosing ?? document)?.disabled).toBe(false);
    await click(button("保存", choosing ?? document));

    expect(dialog()).toBeNull();
    expect(JSON.parse(localStorage.getItem("checkin:settings") ?? "{}")).toMatchObject({
      groupId: "gdgkwansai",
      eventId: "123456",
    });
    expect(
      [...document.querySelectorAll("a")].find((link) =>
        link.textContent?.includes("イベントページの管理"),
      )?.href,
    ).toBe("https://connpass.com/event/123456/");
  });
});
