# Slider

## Use case

Use for numeric selection within a range. Use the simple `Slider` or decomposed parts, and handle value/defaultValue, min/max/step, and orientation under the Radix contract. Give each thumb an accessible name.

Avoid: choose Input when exact numeric entry is all that is needed. Do not communicate the value through color or position alone.

## Public API

`Slider`, `SliderRoot`, `SliderTrack`, `SliderRange`, `SliderThumb`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Slider/` for exact types and defaults.

## Minimal example

```tsx
<Slider aria-label="Volume" min={0} max={100} value={[volume]} onValueChange={([v]) => setVolume(v)} />
```

See `ui/src/components/Slider/Slider.stories.tsx` for states and compositions.
