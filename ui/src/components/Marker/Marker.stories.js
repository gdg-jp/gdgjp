import { Info } from "lucide-react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Marker, MarkerContent, MarkerIcon } from "./Marker";
const meta = {
  title: "Components/Marker",
  component: Marker,
  parameters: { layout: "centered" },
};
export default meta;
export const Notice = {
  render: () =>
    _jsxs(Marker, {
      variant: "separator",
      style: { width: 420 },
      children: [
        _jsx(MarkerIcon, { children: _jsx(Info, { size: 16 }) }),
        _jsx(MarkerContent, {
          children: "\u7533\u3057\u8FBC\u307F\u671F\u9650\u306F9\u670830\u65E5\u3067\u3059\u3002",
        }),
      ],
    }),
};
