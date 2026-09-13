import { useState } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { Button } from "../Button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "./Combobox";
const meta = {
  title: "Components/Combobox",
  component: Combobox,
  parameters: { layout: "centered" },
};
const Combobox_stories_default = meta;
const venues = [
  { value: "tokyo", label: "Tokyo" },
  { value: "osaka", label: "Osaka", keywords: ["\u95A2\u897F"] },
  { value: "sapporo", label: "Sapporo" },
];
function VenueItems() {
  return /* @__PURE__ */ jsxs(Fragment, {
    children: [
      venues.map((venue) =>
        /* @__PURE__ */ jsx(
          ComboboxItem,
          { value: venue.value, keywords: venue.keywords, children: venue.label },
          venue.value,
        ),
      ),
      /* @__PURE__ */ jsx(ComboboxEmpty, {}),
    ],
  });
}
const Searchable = {
  render: () =>
    /* @__PURE__ */ jsxs(Combobox, {
      defaultOpen: true,
      children: [
        /* @__PURE__ */ jsx(ComboboxTrigger, {
          asChild: true,
          children: /* @__PURE__ */ jsx(Button, {
            variant: "outline",
            children: "\u30C1\u30E3\u30D7\u30BF\u30FC\u3092\u9078\u629E",
          }),
        }),
        /* @__PURE__ */ jsxs(ComboboxContent, {
          "aria-label": "\u30C1\u30E3\u30D7\u30BF\u30FC\u5019\u88DC",
          children: [
            /* @__PURE__ */ jsx(ComboboxInput, { placeholder: "\u691C\u7D22" }),
            /* @__PURE__ */ jsx(ComboboxList, { children: /* @__PURE__ */ jsx(VenueItems, {}) }),
          ],
        }),
      ],
    }),
};
function ControlledQueryStory() {
  const [query, setQuery] = useState("");
  const [activeValue, setActiveValue] = useState(null);
  return /* @__PURE__ */ jsxs("div", {
    style: { width: 280 },
    children: [
      /* @__PURE__ */ jsx(Combobox, {
        defaultOpen: true,
        query,
        onQueryChange: setQuery,
        activeValue,
        onActiveValueChange: setActiveValue,
        children: /* @__PURE__ */ jsxs(ComboboxContent, {
          "aria-label": "Controlled venue search",
          children: [
            /* @__PURE__ */ jsx(ComboboxInput, { placeholder: "Search venues" }),
            /* @__PURE__ */ jsx(ComboboxList, { children: /* @__PURE__ */ jsx(VenueItems, {}) }),
          ],
        }),
      }),
      /* @__PURE__ */ jsx("output", {
        "data-testid": "combobox-query",
        children: query || "(empty)",
      }),
    ],
  });
}
const ControlledQuery = { render: () => /* @__PURE__ */ jsx(ControlledQueryStory, {}) };
function RemoteStory() {
  const [query, setQuery] = useState("");
  const results = venues.filter((venue) =>
    `${venue.label} ${venue.keywords?.join(" ") ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  return /* @__PURE__ */ jsx(Combobox, {
    defaultOpen: true,
    query,
    onQueryChange: setQuery,
    shouldFilter: false,
    children: /* @__PURE__ */ jsxs(ComboboxContent, {
      "aria-label": "Remote venue search",
      children: [
        /* @__PURE__ */ jsx(ComboboxInput, { placeholder: "Search remote results" }),
        /* @__PURE__ */ jsxs(ComboboxList, {
          children: [
            results.map((venue) =>
              /* @__PURE__ */ jsx(
                ComboboxItem,
                { value: venue.value, children: venue.label },
                venue.value,
              ),
            ),
            /* @__PURE__ */ jsx(ComboboxEmpty, {
              children:
                "\u30B5\u30FC\u30D0\u30FC\u304B\u3089\u5019\u88DC\u304C\u8FD4\u308A\u307E\u305B\u3093\u3002",
            }),
          ],
        }),
      ],
    }),
  });
}
const Remote = { render: () => /* @__PURE__ */ jsx(RemoteStory, {}) };
function MultipleStory() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  return /* @__PURE__ */ jsxs("div", {
    style: { width: 300 },
    children: [
      /* @__PURE__ */ jsxs(Combobox, {
        defaultOpen: true,
        query,
        onQueryChange: setQuery,
        closeOnSelect: false,
        shouldFilter: false,
        children: [
          /* @__PURE__ */ jsx(ComboboxTrigger, {
            asChild: true,
            children: /* @__PURE__ */ jsx(Button, {
              variant: "outline",
              children: "\u30E1\u30F3\u30D0\u30FC\u3092\u9078\u629E",
            }),
          }),
          /* @__PURE__ */ jsxs(ComboboxContent, {
            "aria-label": "\u8907\u6570\u9078\u629E",
            children: [
              /* @__PURE__ */ jsx(ComboboxInput, {
                placeholder: "\u30E1\u30F3\u30D0\u30FC\u3092\u691C\u7D22",
              }),
              /* @__PURE__ */ jsxs(ComboboxList, {
                children: [
                  venues.map((venue) =>
                    /* @__PURE__ */ jsx(
                      ComboboxItem,
                      {
                        value: venue.value,
                        onSelect: (value) =>
                          setSelected((current) =>
                            current.includes(value)
                              ? current.filter((item) => item !== value)
                              : [...current, value],
                          ),
                        children: venue.label,
                      },
                      venue.value,
                    ),
                  ),
                  /* @__PURE__ */ jsx(ComboboxEmpty, {}),
                ],
              }),
            ],
          }),
        ],
      }),
      /* @__PURE__ */ jsx("output", {
        "data-testid": "combobox-selected",
        children: selected.join(", ") || "(none)",
      }),
    ],
  });
}
const Multiple = { render: () => /* @__PURE__ */ jsx(MultipleStory, {}) };
const Disabled = {
  render: () =>
    /* @__PURE__ */ jsx(Combobox, {
      defaultOpen: true,
      children: /* @__PURE__ */ jsxs(ComboboxContent, {
        "aria-label": "Disabled venue search",
        children: [
          /* @__PURE__ */ jsx(ComboboxInput, { placeholder: "Search" }),
          /* @__PURE__ */ jsxs(ComboboxList, {
            children: [
              /* @__PURE__ */ jsx(ComboboxItem, {
                value: "disabled",
                disabled: true,
                children: "Disabled venue",
              }),
              /* @__PURE__ */ jsx(ComboboxItem, {
                value: "available",
                children: "Available venue",
              }),
              /* @__PURE__ */ jsx(ComboboxEmpty, {}),
            ],
          }),
        ],
      }),
    }),
};
function ReorderedStory() {
  const [reversed, setReversed] = useState(false);
  const orderedVenues = reversed ? [...venues].reverse() : venues;
  return /* @__PURE__ */ jsxs("div", {
    children: [
      /* @__PURE__ */ jsx(Button, {
        variant: "outline",
        onMouseDown: (event) => event.preventDefault(),
        onClick: () => setReversed((current) => !current),
        children: "Reverse results",
      }),
      /* @__PURE__ */ jsxs(Combobox, {
        defaultOpen: true,
        children: [
          /* @__PURE__ */ jsx(ComboboxTrigger, {
            asChild: true,
            children: /* @__PURE__ */ jsx(Button, { variant: "ghost", children: "Choose a venue" }),
          }),
          /* @__PURE__ */ jsxs(ComboboxContent, {
            "aria-label": "Reordered venues",
            children: [
              /* @__PURE__ */ jsx(ComboboxInput, { placeholder: "Search" }),
              /* @__PURE__ */ jsxs(ComboboxList, {
                children: [
                  orderedVenues.map((venue) =>
                    /* @__PURE__ */ jsx(
                      ComboboxItem,
                      { value: venue.value, children: venue.label },
                      venue.value,
                    ),
                  ),
                  /* @__PURE__ */ jsx(ComboboxEmpty, {}),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
const Reordered = { render: () => /* @__PURE__ */ jsx(ReorderedStory, {}) };
const Loading = {
  render: () =>
    /* @__PURE__ */ jsx(Combobox, {
      defaultOpen: true,
      children: /* @__PURE__ */ jsxs(ComboboxContent, {
        "aria-label": "Loading venues",
        children: [
          /* @__PURE__ */ jsx(ComboboxInput, { placeholder: "Search" }),
          /* @__PURE__ */ jsx(ComboboxList, {
            children: /* @__PURE__ */ jsx(ComboboxEmpty, {
              "aria-live": "polite",
              "aria-atomic": "true",
              children: "\u5019\u88DC\u3092\u8AAD\u307F\u8FBC\u3093\u3067\u3044\u307E\u3059\u2026",
            }),
          }),
        ],
      }),
    }),
};
const ErrorState = {
  render: () =>
    /* @__PURE__ */ jsx(Combobox, {
      defaultOpen: true,
      children: /* @__PURE__ */ jsxs(ComboboxContent, {
        "aria-label": "Venue search error",
        children: [
          /* @__PURE__ */ jsx(ComboboxInput, { placeholder: "Search" }),
          /* @__PURE__ */ jsx(ComboboxList, {
            children: /* @__PURE__ */ jsx(ComboboxEmpty, {
              role: "alert",
              children:
                "\u5019\u88DC\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002",
            }),
          }),
        ],
      }),
    }),
};
const LongJapanese = {
  render: () =>
    /* @__PURE__ */ jsx(Combobox, {
      defaultOpen: true,
      children: /* @__PURE__ */ jsxs(ComboboxContent, {
        "aria-label": "\u9577\u3044\u65E5\u672C\u8A9E\u306E\u5019\u88DC",
        children: [
          /* @__PURE__ */ jsx(ComboboxInput, { placeholder: "\u5019\u88DC\u3092\u691C\u7D22" }),
          /* @__PURE__ */ jsxs(ComboboxList, {
            children: [
              /* @__PURE__ */ jsx(ComboboxItem, {
                value: "long",
                children:
                  "\u3068\u3066\u3082\u9577\u3044\u65E5\u672C\u8A9E\u306E\u30A4\u30D9\u30F3\u30C8\u4F1A\u5834\u5019\u88DC\u540D\u3067\u3082\u6A2A\u65B9\u5411\u3078\u753B\u9762\u3092\u62BC\u3057\u5E83\u3052\u306A\u3044",
              }),
              /* @__PURE__ */ jsx(ComboboxEmpty, {}),
            ],
          }),
        ],
      }),
    }),
};
export {
  ControlledQuery,
  Disabled,
  ErrorState,
  Loading,
  LongJapanese,
  Multiple,
  Remote,
  Reordered,
  Searchable,
  Combobox_stories_default as default,
};
