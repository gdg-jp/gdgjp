import { useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import { Calendar } from "./Calendar";
const meta = {
  title: "Components/Calendar",
  component: Calendar,
  parameters: { layout: "centered" },
};
const Calendar_stories_default = meta;
const Single = {
  args: { defaultMonth: new Date(2026, 8, 1), defaultSelected: new Date(2026, 8, 12) },
};
const Range = {
  args: {
    mode: "range",
    defaultMonth: new Date(2026, 8, 1),
    defaultSelected: { from: new Date(2026, 8, 8), to: new Date(2026, 8, 12) },
  },
};
const ControlledEmpty = {
  args: {
    defaultMonth: new Date(2026, 8, 1, 12),
    defaultSelected: new Date(2026, 8, 12, 12),
    selected: void 0,
  },
};
function ControlledLifecycleStory() {
  const [selected, setSelected] = useState(new Date(2026, 8, 12, 12));
  return /* @__PURE__ */ jsxs("div", {
    children: [
      /* @__PURE__ */ jsxs("div", {
        style: { display: "flex", gap: 8, marginBottom: 8 },
        children: [
          /* @__PURE__ */ jsx("button", {
            type: "button",
            onClick: () => setSelected(void 0),
            children: "Clear selection",
          }),
          /* @__PURE__ */ jsx("button", {
            type: "button",
            onClick: () => setSelected(new Date(2026, 10, 3, 12)),
            children: "Replace selection",
          }),
        ],
      }),
      /* @__PURE__ */ jsx(Calendar, {
        defaultMonth: new Date(2026, 8, 1, 12),
        selected,
        onSelect: (next) => setSelected(next instanceof Date ? next : void 0),
      }),
    ],
  });
}
const ControlledLifecycle = { render: () => /* @__PURE__ */ jsx(ControlledLifecycleStory, {}) };
export { ControlledEmpty, ControlledLifecycle, Range, Single, Calendar_stories_default as default };
