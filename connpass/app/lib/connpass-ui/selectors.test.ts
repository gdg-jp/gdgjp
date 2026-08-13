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

  const subEventSurveyConferenceFixtures = [
    "event-edit_サブイベントを作成するをクリック.html",
    "event-edit_サブイベントの編集画面.html",
    "event-edit_アンケートを作成・編集するをクリック.html",
    "event-edit_アンケートを作成・編集する_アンケートを新規作成をクリック.html",
    "event-edit_カンファレンス情報を編集するをクリック.html",
    "event-edit_主催者をクリック.html",
    "event-edit_参加者への情報をクリック.htm",
  ] as const;

  function hasSubEventSurveyConferenceFixtures(): boolean {
    return subEventSurveyConferenceFixtures.every((name) => existsSync(fixturePath(name)));
  }

  it.skipIf(!hasSubEventSurveyConferenceFixtures())(
    "matches sub-event/survey/conference DOM from the newly captured fixtures",
    () => {
      const subEventCreate = readFileSync(
        fixturePath("event-edit_サブイベントを作成するをクリック.html"),
        "utf8",
      );
      expect(subEventCreate).toContain(selectors.subEvent.createButton.replace("#", 'id="'));
      expect(subEventCreate).toContain("サブイベントは作成されていません");

      const subEventOwn = readFileSync(
        fixturePath("event-edit_サブイベントの編集画面.html"),
        "utf8",
      );
      expect(subEventOwn).toContain("FieldGroupSelect");

      const surveyLanding = readFileSync(
        fixturePath("event-edit_アンケートを作成・編集するをクリック.html"),
        "utf8",
      );
      expect(surveyLanding).toContain("アンケートを新規作成");

      const surveyNew = readFileSync(
        fixturePath("event-edit_アンケートを作成・編集する_アンケートを新規作成をクリック.html"),
        "utf8",
      );
      expect(surveyNew).toContain('id="EditQuestionForm"');
      expect(surveyNew).toContain("QuestionArea");

      const conference = readFileSync(
        fixturePath("event-edit_カンファレンス情報を編集するをクリック.html"),
        "utf8",
      );
      expect(conference).toContain('id="is_active"');
      expect(conference).toContain('id="lp_url"');
      expect(conference).toContain('id="id_topics"');

      const owner = readFileSync(fixturePath("event-edit_主催者をクリック.html"), "utf8");
      expect(owner).toContain('id="FieldOwnerText"');
      expect(owner).toContain('name="owner_text"');

      const participantOnlyInfo = readFileSync(
        fixturePath("event-edit_参加者への情報をクリック.htm"),
        "utf8",
      );
      expect(participantOnlyInfo).toContain('id="FieldParticipantOnlyInfo"');
      expect(participantOnlyInfo).toContain('name="participant_only_info"');

      const eventEdit = readFileSync(fixturePath("event-edit.html"), "utf8");
      expect(eventEdit).toContain(selectors.survey.hasSurveyIndicator.replace("#", 'id="'));
      expect(eventEdit).toContain(selectors.survey.hasSurveyEmptyText);
    },
  );

  const laterFixtures = [
    "subevent-published.html",
    "subevent-published_イベントを中止するをクリック.html",
    "アンケートを作成・編集する-existing.html",
    "イベント編集_会場設定済み.html",
    "event-edit_サブイベント追加後.htm",
  ] as const;

  function hasLaterFixtures(): boolean {
    return laterFixtures.every((name) => existsSync(fixturePath(name)));
  }

  it.skipIf(!hasLaterFixtures())(
    "matches DOM from the later-captured cancel/existing-survey/venue fixtures",
    () => {
      const published = readFileSync(fixturePath("subevent-published.html"), "utf8");
      expect(published).toContain(selectors.subEvent.cancelTrigger.replace(".", 'class="'));
      expect(published).toContain("イベントを中止する");

      const cancelClicked = readFileSync(
        fixturePath("subevent-published_イベントを中止するをクリック.html"),
        "utf8",
      );
      expect(cancelClicked).toContain("EventCancelConfirmPopupTemplate");

      const surveyExisting = readFileSync(
        fixturePath("アンケートを作成・編集する-existing.html"),
        "utf8",
      );
      expect(surveyExisting).toContain('id="EditQuestionForm"');
      expect(surveyExisting).toContain('class="QuestionArea"');
      expect(surveyExisting).toContain('name="title"');
      expect(surveyExisting).toContain('name="answer_type"');
      expect(surveyExisting).toContain('name="option_title"');

      const venueSet = readFileSync(fixturePath("イベント編集_会場設定済み.html"), "utf8");
      expect(venueSet).toContain('id="FieldPlace"');
      expect(venueSet).toContain('class="spot"');
      expect(venueSet).toContain('class="place"');

      const subEventAdded = readFileSync(fixturePath("event-edit_サブイベント追加後.htm"), "utf8");
      expect(subEventAdded).toContain(selectors.subEvent.area.replace(".", 'class="'));
      expect(subEventAdded).toContain("公開中");
      expect(subEventAdded).toContain("下書き");
    },
  );
});
