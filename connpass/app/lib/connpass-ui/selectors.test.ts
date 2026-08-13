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

  const clickThroughFixtures = [
    "event-edit_サブタイトルをクリック.html",
    "event-edit_会場未設定をクリック会場を新しく設定するをクリック.html",
    "event-edit_日付を入力をクリック.html",
    "event-edit_公開予約設定の日付を入力をクリック.html",
    "event-edit_参加受付の内容を編集をクリック.html",
    "event-edit_参加受付の内容を編集をクリックしてconnpassで参加受付をしないをクリック.html",
  ] as const;

  function hasClickThroughFixtures(): boolean {
    return clickThroughFixtures.every((name) => existsSync(fixturePath(name)));
  }

  it.skipIf(!hasClickThroughFixtures())(
    "matches click-to-edit DOM from the newly captured fixtures",
    () => {
      const subtitle = readFileSync(fixturePath("event-edit_サブタイトルをクリック.html"), "utf8");
      expect(subtitle).toContain('id="FieldSubTitle"');
      expect(subtitle).toContain('name="sub_title"');
      expect(subtitle).toContain("ui-editing");

      const place = readFileSync(
        fixturePath("event-edit_会場未設定をクリック会場を新しく設定するをクリック.html"),
        "utf8",
      );
      expect(place).toContain('id="FieldPlace"');
      expect(place).toContain('name="name"');
      expect(place).toContain('name="address"');

      const dates = readFileSync(fixturePath("event-edit_日付を入力をクリック.html"), "utf8");
      expect(dates).toContain('name="start_date"');
      expect(dates).toContain('name="start_time"');
      expect(dates).toContain("hasDatepicker");

      const reserved = readFileSync(
        fixturePath("event-edit_公開予約設定の日付を入力をクリック.html"),
        "utf8",
      );
      expect(reserved).toContain('id="EventPublishReservation"');
      expect(reserved).toContain('name="reserved_date"');
      expect(reserved).toContain('name="reserved_time"');

      const participation = readFileSync(
        fixturePath("event-edit_参加受付の内容を編集をクリック.html"),
        "utf8",
      );
      expect(participation).toContain('id="FieldEventType"');
      expect(participation).toContain('class="ParticipationTypes"');
      expect(participation).toContain("ParticipationTypeAdd");
      expect(participation).toContain('id="EventTypeParticipation"');

      const advertisement = readFileSync(
        fixturePath(
          "event-edit_参加受付の内容を編集をクリックしてconnpassで参加受付をしないをクリック.html",
        ),
        "utf8",
      );
      expect(advertisement).toContain('id="EventTypeAdvertisement"');
    },
  );
});
