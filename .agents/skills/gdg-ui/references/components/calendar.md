# Calendar

## Use case

Use for date or date-range selection. Use selected/defaultSelected and onSelect according to `mode`, and configure locale, disabled dates, and month navigation for the app's requirements. Preserve button labels and keyboard navigation.

Avoid: using it for a single date-string input; choose DatePicker instead. Handle date-time and timezone processing in the app domain.

## Public API

`Calendar`, `CalendarProps`, `CalendarMode`, `CalendarSelection`, `DateRange`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Calendar/` for exact types and defaults.

## Minimal example

```tsx
<Calendar
  mode="single"
  selected={date}
  onSelect={(selection) => setDate(selection instanceof Date ? selection : undefined)}
  aria-label="Event date"
/>
```

See `ui/src/components/Calendar/Calendar.stories.tsx` for states and compositions.
