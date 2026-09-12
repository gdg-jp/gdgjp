# DatePicker

## Use case

Combine Calendar with a `YYYY/MM/DD` text input. `value/defaultValue` is `Date`, and `onChange` is `Date | undefined`. Accept digits in sequence and insert separators automatically; specify unavailable dates and min/max through `calendarProps`, and disable the entire control with `disabled`. Add a visible label with FormField.

Avoid: using it as a timezone-aware timestamp picker or a free-form date input.

## Public API

`DatePicker`, `DatePickerProps`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/DatePicker/` for exact types and defaults.

## Minimal example

```tsx
<FormField label="Event date"><DatePicker value={date} onChange={setDate} /></FormField>
```

See `ui/src/components/DatePicker/DatePicker.stories.tsx` for states and compositions.
