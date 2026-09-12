# Cross-component patterns

These rules cross component boundaries, so no single component API can communicate them all.

## Borders and separators

`@gdgjp/ui` supplies `border-color: var(--gdg-border)` from `gdg-base`, so an ordinary
Tailwind `border` or `divide-y` uses the right semantic color. Explicitly name a color only
when the line is an intentional design decision. `border-foreground` is reserved for a
documented high-contrast emphasis and needs a reason comment. Never use literal colors.

The first non-comment line of every consuming app's `app.css` must be:

```css
@layer theme, base, gdg-tokens, gdg-base, gdg-components, utilities;
```

Without this order, shared component styles can silently override consumer utilities.

## Stack, Inline, and button width

`Stack` defaults to `align-items: stretch`; `Button` defaults to `inline-flex`. State the
intent with `Stack align="start"` or `Button fullWidth`. Do not combine
`<Stack className="items-center">` with `w-full`: that is 100% of a shrink-to-fit parent.
Use `Inline` for horizontal groups and pass routed back navigation through `PageHeader`'s
`back` slot.

```tsx
<Stack align="start"><Button>戻る</Button></Stack>
<Button fullWidth>Google で続行</Button>
```

## Selectable menu items

Do not hand-render conditional check icons. Use `DropdownMenuRadioGroup` with
`DropdownMenuRadioItem` or `DropdownMenuCheckboxItem`. The shared library reserves a trailing
indicator slot whether or not an item is selected. Context menus, menubars, and Select use the
same convention. Do not place a trailing shortcut or badge beside a selected-item indicator.

## Required markers

`FormField` owns `*`. Declare it once at the level a person reads as required. Use `hideLabel`
for a visually hidden label; do not pass a manually `gdg-sr-only` wrapped label together with
`required`, which creates a visible marker-only row. Repeating fields should put the marker on
their group heading, not every row.

## Repeating fields

There is deliberately no stateful array-field primitive. Apps own additions, removals,
reordering, row validation, and indexed names. Do not use `InputGroup` as an array-field
container: its block-edge utilities do not make a column layout.

## Preserve visual weight

A migration converts markup; it does not redesign or re-rank content. A muted footnote stays a
muted footnote; do not promote it to an `Alert`, which has a border, color, icon, and status
role. Do not add explanation, tooltips, or icons merely because a component changed. If a
removed component makes a locale string unused, remove the string in the same change. If the
screen hierarchy itself seems wrong, record it in handoff and leave it unchanged.
