import { type Browser, type Page, expect, test } from "@playwright/test";
import { FakeObs } from "./fake-obs";

/**
 * Phone → DeckRoom → OBS dock → obs-websocket, end to end against a fake
 * obs-websocket server (e2e/fake-obs.ts) instead of a real OBS.
 */

const OBS_PORT = 4467;
const OBS_PASSWORD = "e2e-secret";

let obs: FakeObs;

test.beforeAll(() => {
  obs = new FakeObs(OBS_PORT, OBS_PASSWORD);
});

test.afterAll(async () => {
  await obs.close();
});

test.beforeEach(() => obs.reset());

async function signedIn(browser: Browser, options: { mobile?: boolean } = {}): Promise<Page> {
  const context = await browser.newContext({
    locale: "ja-JP",
    ...(options.mobile ? { viewport: { width: 390, height: 844 }, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  await page.goto("/dev/login?as=e2e-deck&chapter=1:dev-chapter&return_to=/");
  return page;
}

async function createDeck(page: Page, name: string): Promise<string> {
  await page.getByRole("button", { name: "デッキを作成" }).first().click();
  await page.getByRole("textbox", { name: "名前" }).fill(name);
  await page.getByRole("button", { name: "作成", exact: true }).click();
  await page.waitForURL(/\/decks\/[A-Za-z0-9_-]+\/edit$/);
  return new URL(page.url()).pathname.split("/")[2] ?? "";
}

const look = { icon: null, image: null, color: "neutral" };
const none = { mode: "none" };

function layout() {
  return {
    cols: 4,
    rows: 2,
    boards: {
      root: {
        id: "root",
        name: "ホーム",
        pages: [
          {
            id: "p1",
            keys: {
              "0": {
                id: "kbreak",
                title: "休憩",
                look,
                lookOn: null,
                confirm: none,
                behavior: {
                  type: "action",
                  action: { op: "scene", scene: { name: "Break", uuid: null }, target: "program" },
                },
              },
              "1": {
                id: "kstream",
                title: "配信",
                look,
                lookOn: null,
                confirm: { mode: "hold", ms: 800 },
                behavior: { type: "action", action: { op: "stream", mode: "toggle" } },
              },
              "2": {
                id: "kptt",
                title: "トーク",
                look,
                lookOn: null,
                confirm: none,
                behavior: {
                  type: "action",
                  action: { op: "mute", input: { name: "Mic", uuid: null }, mode: "pushToTalk" },
                },
              },
              "3": {
                id: "kmulti",
                title: "締め",
                look,
                lookOn: null,
                confirm: none,
                behavior: {
                  type: "multi",
                  steps: [
                    {
                      type: "obs",
                      action: {
                        op: "scene",
                        scene: { name: "Ending", uuid: null },
                        target: "program",
                      },
                    },
                    { type: "wait", ms: 300 },
                    {
                      type: "obs",
                      action: {
                        op: "sourceVisibility",
                        scene: { name: "Main", uuid: null },
                        source: { name: "Logo", uuid: null },
                        mode: "off",
                      },
                    },
                  ],
                },
              },
              "4": {
                id: "kfolder",
                title: "その他",
                look,
                lookOn: null,
                confirm: none,
                behavior: { type: "folder", board: "more" },
              },
            },
          },
        ],
      },
      more: {
        id: "more",
        name: "その他",
        pages: [
          {
            id: "p2",
            keys: {
              "0": {
                id: "kback",
                title: "戻る",
                look,
                lookOn: null,
                confirm: none,
                behavior: { type: "back" },
              },
              "1": {
                id: "khot",
                title: "ホットキー",
                look,
                lookOn: null,
                confirm: none,
                behavior: { type: "action", action: { op: "hotkey", name: "OBSBasic.Screenshot" } },
              },
            },
          },
        ],
      },
    },
  };
}

async function saveLayout(page: Page, deckId: string, version: number, body = layout()) {
  return page.request.post(`/api/decks/${deckId}/layout`, { data: { version, layout: body } });
}

async function dockUrl(editor: Page): Promise<string> {
  await editor.getByRole("button", { name: "デッキのメニュー" }).click();
  await editor.getByRole("menuitem", { name: "OBS のドック URL" }).click();
  const url = await editor.getByRole("textbox", { name: "ドックの URL" }).inputValue();
  await editor.keyboard.press("Escape");
  return url;
}

async function openDock(browser: Browser, deckId: string, url: string): Promise<Page> {
  const context = await browser.newContext({ locale: "ja-JP" });
  await context.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    `deck-dock:${deckId}`,
    JSON.stringify({
      obsUrl: `ws://127.0.0.1:${OBS_PORT}`,
      password: OBS_PASSWORD,
      screenshotDir: "/tmp",
    }),
  ] as const);
  const dock = await context.newPage();
  await dock.goto(url);
  await expect(dock.getByText("接続 (32.2.2)")).toBeVisible();
  return dock;
}

async function setup(browser: Browser) {
  const editor = await signedIn(browser);
  const deckId = await createDeck(editor, `e2e ${Date.now()}`);
  expect((await saveLayout(editor, deckId, 1)).ok()).toBe(true);
  const dock = await openDock(browser, deckId, await dockUrl(editor));
  const phone = await signedIn(browser, { mobile: true });
  await phone.goto(`/d/${deckId}`);
  await expect(phone.getByText("接続中")).toBeVisible();
  return { editor, dock, phone, deckId };
}

test("a key switches the scene and lights up when it is live", async ({ browser }) => {
  const { phone, dock } = await setup(browser);
  const key = phone.getByRole("button", { name: "休憩" });
  await expect(key).toHaveAttribute("aria-pressed", "false");
  await key.click();
  await expect
    .poll(() => obs.sent("SetCurrentProgramScene").at(-1)?.requestData)
    .toEqual({ sceneName: "Break" });
  await expect(key).toHaveAttribute("aria-pressed", "true");
  await expect(dock.getByText("休憩")).toBeVisible();
});

test("stream needs a hold; a tap does nothing", async ({ browser }) => {
  const { phone } = await setup(browser);
  const key = phone.getByRole("button", { name: /^配信/ });
  await key.click();
  await phone.waitForTimeout(400);
  expect(obs.sent("ToggleStream")).toHaveLength(0);

  const box = await key.boundingBox();
  if (!box) throw new Error("no key");
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await phone.mouse.down();
  await phone.waitForTimeout(1100);
  await phone.mouse.up();
  await expect.poll(() => obs.sent("ToggleStream").length).toBe(1);
  await expect(phone.locator(".dk-chip", { hasText: "配信" })).toBeVisible();
  await expect(key).toHaveAttribute("aria-pressed", "true");
});

test("push-to-talk unmutes while held", async ({ browser }) => {
  const { phone } = await setup(browser);
  const key = phone.getByRole("button", { name: /^トーク/ });
  const box = await key.boundingBox();
  if (!box) throw new Error("no key");
  await phone.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await phone.mouse.down();
  await expect
    .poll(() => obs.sent("SetInputMute").at(-1)?.requestData)
    .toEqual({ inputName: "Mic", inputMuted: false });
  await phone.mouse.up();
  await expect
    .poll(() => obs.sent("SetInputMute").at(-1)?.requestData)
    .toEqual({ inputName: "Mic", inputMuted: true });
});

test("a multi action runs its steps in order", async ({ browser }) => {
  const { phone } = await setup(browser);
  await phone.getByRole("button", { name: "締め" }).click();
  await expect
    .poll(() =>
      obs.requests.filter((r) => r.requestType.startsWith("Set")).map((r) => r.requestType),
    )
    .toEqual(["SetCurrentProgramScene", "SetSceneItemEnabled"]);
  expect(obs.sent("SetSceneItemEnabled")[0]?.requestData).toMatchObject({
    sceneItemId: 2,
    sceneItemEnabled: false,
  });
});

test("folders open on the phone and their keys reach OBS", async ({ browser }) => {
  const { phone } = await setup(browser);
  await phone.getByRole("button", { name: "その他" }).click();
  await phone.getByRole("button", { name: "ホットキー" }).click();
  await expect
    .poll(() => obs.sent("TriggerHotkeyByName").at(-1)?.requestData)
    .toEqual({
      hotkeyName: "OBSBasic.Screenshot",
    });
  await phone.getByRole("button", { name: "戻る" }).first().click();
  await expect(phone.getByRole("button", { name: "休憩" })).toBeVisible();
});

test("a save based on an old version is refused", async ({ browser }) => {
  const editor = await signedIn(browser);
  const deckId = await createDeck(editor, `e2e conflict ${Date.now()}`);
  expect((await saveLayout(editor, deckId, 1)).status()).toBe(200);
  expect((await saveLayout(editor, deckId, 1)).status()).toBe(409);
});

test("an edit reaches an open phone without a reload", async ({ browser }) => {
  const { editor, phone, deckId } = await setup(browser);
  const next = layout();
  const key = next.boards.root.pages[0]?.keys["0"];
  if (key) key.title = "休憩中";
  expect((await saveLayout(editor, deckId, 2, next)).ok()).toBe(true);
  await expect(phone.getByRole("button", { name: "休憩中" })).toBeVisible();
});

test("the dock refuses a wrong token", async ({ browser }) => {
  const page = await signedIn(browser);
  const deckId = await createDeck(page, `e2e token ${Date.now()}`);
  await page.goto(`/dock/${deckId}?t=wrong`);
  await expect(page.getByText("この URL は使えません")).toBeVisible();
});
