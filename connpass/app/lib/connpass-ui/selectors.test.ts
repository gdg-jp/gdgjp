import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { requiredFixtures, selectors } from "./selectors";

const fixturesDir = join(process.cwd(), "fixtures/html");

function fixturePath(name: string): string {
  return join(fixturesDir, name);
}

function hasFixtures(): boolean {
  return requiredFixtures.every((name) => existsSync(fixturePath(name)));
}

describe("connpass UI selectors", () => {
  it("lists the required fixture filenames", () => {
    expect(requiredFixtures).toContain("login.html");
    expect(requiredFixtures).toContain("event-edit.html");
  });

  it("defines fixture-backed selector strings", () => {
    expect(selectors.login.username).toContain('name="username"');
    expect(selectors.groupHome.createEventButton).toContain("GroupEventCreate");
    expect(selectors.eventEdit.publish).toContain("PublishEvent");
    expect(selectors.publishDialog.confirm).toContain("PopupSubmit");
  });

  it.skipIf(!hasFixtures())("matches key DOM from provided HTML fixtures", () => {
    const files = readdirSync(fixturesDir).filter((f: string) => f.endsWith(".html"));
    expect(files).toEqual(expect.arrayContaining([...requiredFixtures]));

    const login = readFileSync(fixturePath("login.html"), "utf8");
    expect(login).toContain('name="username"');
    expect(login).toContain('name="password"');
    expect(login).toContain("ログインする");

    const groupHome = readFileSync(fixturePath("group-home.html"), "utf8");
    expect(groupHome).toContain("GroupEventCreate");
    expect(groupHome).toContain("イベントを作成");
    expect(groupHome).toContain("GroupEventCreateTemplate");
    expect(groupHome).toContain('name="title"');

    const createDialog = readFileSync(fixturePath("event-create-dialog.html"), "utf8");
    expect(createDialog).toContain("EventCreateSubmit");
    expect(createDialog).toContain("このグループのイベントを作成する");

    const eventEdit = readFileSync(fixturePath("event-edit.html"), "utf8");
    expect(eventEdit).toContain('id="FieldTitle"');
    expect(eventEdit).toContain('id="FieldSubTitle"');
    expect(eventEdit).toContain('id="FieldDescription"');
    expect(eventEdit).toContain("PublishEvent");
    expect(eventEdit).toContain("即時公開する");

    const eventPublish = readFileSync(fixturePath("event-publish.html"), "utf8");
    expect(eventPublish).toContain("PopupSubmit");
    expect(eventPublish).toContain('name="Comment"');
    expect(eventPublish).toContain("イベントを即時公開する");

    const groupEvents = readFileSync(fixturePath("group-events.html"), "utf8");
    expect(groupEvents).toContain("group_event_list vevent");
    expect(groupEvents).toContain("event_title");
    expect(groupEvents).toContain("label_status_event");
    expect(groupEvents).toMatch(/\/event\/\d+\//);
  });
});
