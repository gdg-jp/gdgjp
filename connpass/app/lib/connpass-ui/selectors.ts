/**
 * Connpass UI selectors derived from fixtures/html/*.html
 * Sources:
 * - login.html (https://connpass.com/login/)
 * - group-home.html / event-create-dialog.html (https://yunineko.connpass.com/)
 * - event-edit.html / event-publish.html (https://connpass.com/event/403552/edit/)
 */

export const selectors = {
  login: {
    username: 'input[name="username"]',
    password: 'input[name="password"]',
    submit: 'button.btn_login[type="submit"], button[type="submit"]:has-text("ログインする")',
  },
  groupHome: {
    /** Group admin create button on series page */
    createEventButton: "span.GroupEventCreate",
    eventsTab: 'a[href$="/event/"]',
    emptyEvents: ".no_data_area",
  },
  createDialog: {
    /** Visible group create popup (from #GroupEventCreateTemplate) */
    root: ".popup:visible, .popup_wrapper:visible, #GroupEventCreateTemplate ~ .popup",
    titleInput: '.popup:visible input[name="title"], input[name="title"]:visible',
    submit: "button.EventCreateSubmit:visible",
  },
  eventEdit: {
    title: "#FieldTitle",
    subtitle: "#FieldSubTitle",
    description: "#FieldDescription",
    capacity: "#FieldMaxNum .FormEditable, #FieldMaxNum",
    place: "#FieldPlace",
    dates: "#EventDates .FormEditable, #EventDates",
    publish: "span.PublishEvent",
    preview: 'a[href*="/preview/"]',
    saveButton: "button.save, button.btn_high_priority.save",
    inlineTextInput:
      'form input[type="text"]:visible, form textarea:visible, input.form_input_text:visible',
    titleInput: '#FieldTitle input[name="title"]',
    subtitleInput:
      '#FieldSubTitle input[name="sub_title"], .sub_title input[name="sub_title"], input[name="sub_title"]',
    capacityInput: 'input[name="max_num"]',
    startDate: 'input[name="start_date"]',
    startTime: 'input[name="start_time"]',
    endDate: 'input[name="end_date"]',
    endTime: 'input[name="end_time"]',
    placeName: '#FieldPlace input[name="name"], .place_edit_area input[name="name"]',
    placeAddress: '#FieldPlace input[name="address"], .place_edit_area input[name="address"]',
    /** イベント編集_会場設定済み.html — rendered venue table (read path) */
    placeVenueName: "#FieldPlace table tr.spot td",
    placeVenueAddress: "#FieldPlace table tr.place td",
    reservedTrigger: "#EventPublishReservation",
    reservedDate: 'input[name="reserved_date"]',
    reservedTime: 'input[name="reserved_time"]',
    /** event-edit_主催者をクリック.html */
    ownerText: "#FieldOwnerText",
    ownerTextInput: '#FieldOwnerText input[name="owner_text"]',
    /** event-edit_参加者への情報をクリック.htm */
    participantOnlyInfo: "#FieldParticipantOnlyInfo",
    participantOnlyInfoInput: '#FieldParticipantOnlyInfo textarea[name="participant_only_info"]',
    /** event-edit.html — inside the #FieldEventType edit panel's paid-options area */
    cancelPolicyInput: 'textarea[name="cancel_policy"]',
    eventType: {
      root: "#FieldEventType",
      participation: "#EventTypeParticipation",
      advertisement: "#EventTypeAdvertisement",
      editTrigger: "#FieldEventType button.FormEditable",
      typesBody: "tbody.ParticipationTypes",
      addRow: ".ParticipationTypeAdd",
      saveButton: ".JoinOptions .btn_area button.save",
    },
  },
  publishDialog: {
    comment: 'input[name="Comment"]',
    postTwitter: 'input[name="PostTwitter"]',
    confirm: "button.PopupSubmit",
  },
  groupEvents: {
    /** Event cards on https://<group>.connpass.com/event/ (group-events.html) */
    card: "div.group_event_list.vevent",
    titleLink: "p.event_title a.url.summary, p.event_title a",
    status: "span.label_status_event",
    schedule: "p.schedule",
    dtstart: "span.dtstart .value-title",
    dtend: "span.dtend .value-title",
    place: "p.event_place",
    participants: "p.event_participants",
    participantsAmount: "p.event_participants span.amount span",
    empty: ".no_data_area",
  },
  subEvent: {
    /** event-edit_サブイベントを作成するをクリック.html */
    createButton: "#SubeventCreateButton",
    createTitleInput: '.popup:visible input[name="title"], input[name="title"]:visible',
    createSubmit: "button.EventCreateSubmit:visible",
    area: ".SubeventEditArea",
    table: ".SubeventEditArea table",
    row: ".SubeventEditArea table tbody tr",
    emptyRowText: "サブイベントは作成されていません",
    /** subevent-published.html — published-event edit page */
    cancelTrigger: ".CancelEvent",
    cancelConfirm: "button.btn_action[type=submit]",
  },
  survey: {
    /** event-edit_アンケートを作成・編集する_アンケートを新規作成をクリック.html */
    editQuestionForm: "#EditQuestionForm",
    questionArea: "#EditQuestionForm .QuestionArea",
    questionBlock: ".question_edit_area",
    createNewLink: 'a[href$="/edit/form/new"]',
    addQuestion: ".AddQuestion",
    deleteQuestion: ".DeleteQuestion",
    addOption: ".AddQuestionOption",
    optionsList: ".QuestionOptionsList",
    saveQuestions: ".SaveQuestions",
    hasSurveyIndicator: "#enquete_area",
    hasSurveyEmptyText: "アンケートは追加されていません",
  },
  conference: {
    /** event-edit_カンファレンス情報を編集するをクリック.html */
    editLink: 'a[href$="/conference_edit/"]',
    isActive: "#is_active",
    lpUrl: "#lp_url",
    cfpUrl: "#cfp_url",
    cfpStartAt: "#cfp_start_datetime",
    cfpEndAt: "#cfp_end_datetime",
    sponsorUrl: "#sponsor_url",
    sponsorStartAt: "#sponsor_start_datetime",
    sponsorEndAt: "#sponsor_end_datetime",
    topics: "#id_topics",
    submit: "#event_conference_form button[type=submit]",
  },
} as const;

export const requiredFixtures = [
  "login.html",
  "group-home.html",
  "event-create-dialog.html",
  "event-edit.html",
  "event-publish.html",
  "group-events.html",
] as const;

/** Placeholder copy shown before the user fills optional fields. */
export const emptyPlaceholders = [
  "(サブタイトルを入力するにはクリック：50文字以内)",
  "(イベントの説明文を編集するにはクリック)",
  "(定員数を入力)",
  "(日付を入力)",
  "(時間を入力)",
  "会場未設定",
] as const;
