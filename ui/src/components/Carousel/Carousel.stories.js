import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "./Carousel";
const meta = {
  title: "Components/Carousel",
  component: Carousel,
  parameters: { layout: "centered" },
};
export default meta;
export const Slides = {
  render: () =>
    _jsxs(Carousel, {
      style: { width: 360 },
      children: [
        _jsx(CarouselContent, {
          "aria-label": "\u30A4\u30D9\u30F3\u30C8\u753B\u50CF",
          children: ["学ぶ", "つながる", "共有する"].map((label, index) =>
            _jsx(
              CarouselItem,
              {
                "aria-label": `スライド ${index + 1}`,
                children: _jsx("div", {
                  className: "gdg-story-surface",
                  style: {
                    display: "grid",
                    minHeight: 150,
                    placeItems: "center",
                    borderRadius: 20,
                    background: "var(--gdg-selected)",
                    color: "var(--gdg-link)",
                    fontSize: 24,
                  },
                  children: label,
                }),
              },
              label,
            ),
          ),
        }),
        _jsxs("div", {
          className: "gdg-inline",
          style: { justifyContent: "space-between" },
          children: [_jsx(CarouselPrevious, {}), _jsx(CarouselNext, {})],
        }),
      ],
    }),
};
