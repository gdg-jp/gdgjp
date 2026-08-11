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
    capacityInput: 'input[name="max_num"]',
    startDate: 'input[name="start_date"]',
    startTime: 'input[name="start_time"]',
    endDate: 'input[name="end_date"]',
    endTime: 'input[name="end_time"]',
    placeName: '#FieldPlace input[name="name"], .place_edit_area input[name="name"]',
    placeAddress: '#FieldPlace input[name="address"], .place_edit_area input[name="address"]',
  },
  publishDialog: {
    comment: 'input[name="Comment"]',
    confirm: "button.PopupSubmit",
  },
  groupEvents: {
    /** Event cards on https://<group>.connpass.com/event/ (group-events.html) */
    card: "div.group_event_list.vevent",
    titleLink: "p.event_title a.url.summary, p.event_title a",
    status: "span.label_status_event",
    schedule: "p.schedule",
    place: "p.event_place",
    participants: "p.event_participants",
    empty: ".no_data_area",
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
