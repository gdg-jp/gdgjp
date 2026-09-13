import { useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { DatePicker } from "./DatePicker";
const meta = {
  title: "Components/DatePicker",
  component: DatePicker,
  parameters: { layout: "centered" },
};
const DatePicker_stories_default = meta;
const Default = {
  args: {
    "aria-label": "\u65E5\u4ED8",
    defaultValue: new Date(2026, 8, 12),
    calendarProps: { defaultMonth: new Date(2026, 8, 1) },
  },
};
const ControlledEmpty = {
  render: () =>
    /* @__PURE__ */ jsx(DatePicker, {
      "aria-label": "\u7A7A\u306E\u671F\u9650",
      value: void 0,
      defaultValue: new Date(2026, 8, 12, 12),
      calendarProps: { defaultMonth: new Date(2026, 8, 1, 12) },
    }),
};
function ControlledLifecycleStory() {
  const [value, setValue] = useState(new Date(2026, 8, 12, 12));
  return /* @__PURE__ */ jsxs("div", {
    children: [
      /* @__PURE__ */ jsxs("div", {
        style: { display: "flex", gap: 8, marginBottom: 8 },
        children: [
          /* @__PURE__ */ jsx("button", {
            type: "button",
            onClick: () => setValue(void 0),
            children: "Clear value",
          }),
          /* @__PURE__ */ jsx("button", {
            type: "button",
            onClick: () => setValue(new Date(2026, 10, 3, 12)),
            children: "Replace value",
          }),
        ],
      }),
      /* @__PURE__ */ jsx(DatePicker, {
        "aria-label": "Controlled date",
        value,
        onChange: setValue,
        calendarProps: { defaultMonth: new Date(2026, 8, 1, 12) },
      }),
      /* @__PURE__ */ jsx("output", {
        "data-testid": "date-picker-value",
        children: value ? value.toLocaleDateString("sv-SE") : "(empty)",
      }),
    ],
  });
}
const ControlledLifecycle = { render: () => /* @__PURE__ */ jsx(ControlledLifecycleStory, {}) };
const RejectedChange = {
  render: () =>
    /* @__PURE__ */ jsx(DatePicker, {
      "aria-label": "Rejected date",
      value: new Date(2026, 8, 12, 12),
      onChange: () => {},
      calendarProps: { defaultMonth: new Date(2026, 8, 1, 12) },
    }),
};
export {
  ControlledEmpty,
  ControlledLifecycle,
  Default,
  RejectedChange,
  DatePicker_stories_default as default,
};
