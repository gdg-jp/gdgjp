import { Slider as RSlider } from "radix-ui";
import { type ComponentProps, useId, useMemo } from "react";
import { cn } from "../../utils";

export function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: ComponentProps<typeof RSlider.Root>) {
  const count = value?.length ?? defaultValue?.length ?? 1;
  const id = useId();
  const thumbKeys = useMemo(
    () => Array.from({ length: count }, (_, index) => `${id}-thumb-${index}`),
    [count, id],
  );
  const sliderLabel = props["aria-label"] ?? "スライダー";
  return (
    <RSlider.Root
      {...props}
      min={min}
      max={max}
      defaultValue={defaultValue}
      value={value}
      className={cn("gdg-slider", className)}
    >
      <SliderTrack>
        <SliderRange />
      </SliderTrack>
      {thumbKeys.map((thumbKey, index) => (
        <SliderThumb key={thumbKey} aria-label={getThumbLabel(sliderLabel, index, count)} />
      ))}
    </RSlider.Root>
  );
}

export function SliderRoot({ className, ...props }: ComponentProps<typeof RSlider.Root>) {
  return <RSlider.Root {...props} className={cn("gdg-slider", className)} />;
}

export function SliderTrack({ className, ...props }: ComponentProps<typeof RSlider.Track>) {
  return <RSlider.Track {...props} className={cn("gdg-slider-track", className)} />;
}

export function SliderRange({ className, ...props }: ComponentProps<typeof RSlider.Range>) {
  return <RSlider.Range {...props} className={cn("gdg-slider-range", className)} />;
}

export function SliderThumb({ className, ...props }: ComponentProps<typeof RSlider.Thumb>) {
  return <RSlider.Thumb {...props} className={cn("gdg-slider-thumb", className)} />;
}

function getThumbLabel(label: string, index: number, count: number) {
  if (count === 1) return label;
  if (count === 2) return `${label}の${index === 0 ? "最小値" : "最大値"}`;
  return `${label} ${index + 1}`;
}
