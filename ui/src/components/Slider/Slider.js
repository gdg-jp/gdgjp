import { Slider as RSlider } from "radix-ui";
import { useId, useMemo } from "react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { cn } from "../../utils";
export function Slider({ className, defaultValue, value, min = 0, max = 100, ...props }) {
  const count = value?.length ?? defaultValue?.length ?? 1;
  const id = useId();
  const thumbKeys = useMemo(
    () => Array.from({ length: count }, (_, index) => `${id}-thumb-${index}`),
    [count, id],
  );
  const sliderLabel = props["aria-label"] ?? "スライダー";
  return _jsxs(RSlider.Root, {
    ...props,
    min: min,
    max: max,
    defaultValue: defaultValue,
    value: value,
    className: cn("gdg-slider", className),
    children: [
      _jsx(SliderTrack, { children: _jsx(SliderRange, {}) }),
      thumbKeys.map((thumbKey, index) =>
        _jsx(SliderThumb, { "aria-label": getThumbLabel(sliderLabel, index, count) }, thumbKey),
      ),
    ],
  });
}
export function SliderRoot({ className, ...props }) {
  return _jsx(RSlider.Root, { ...props, className: cn("gdg-slider", className) });
}
export function SliderTrack({ className, ...props }) {
  return _jsx(RSlider.Track, { ...props, className: cn("gdg-slider-track", className) });
}
export function SliderRange({ className, ...props }) {
  return _jsx(RSlider.Range, { ...props, className: cn("gdg-slider-range", className) });
}
export function SliderThumb({ className, ...props }) {
  return _jsx(RSlider.Thumb, { ...props, className: cn("gdg-slider-thumb", className) });
}
function getThumbLabel(label, index, count) {
  if (count === 1) return label;
  if (count === 2) return `${label}の${index === 0 ? "最小値" : "最大値"}`;
  return `${label} ${index + 1}`;
}
