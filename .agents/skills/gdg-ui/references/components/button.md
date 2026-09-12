# Button

## Use case

Use for actions on a screen. `variant` is `primary | secondary | outline | ghost | danger`, and `size` is `sm | md | lg`. The default is primary/md, and the native button `type` is `button`. `loading` sets `aria-busy` and disabled. `asChild` composes attributes, events, and refs onto a single element and suppresses navigation and clicks when disabled.

Avoid: making every non-primary action primary. Choose Link for navigation and IconButton for icon-only actions.

## Public API

`Button`, `ButtonProps`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/Button/` for exact types and defaults.

## Minimal example

```tsx
<Button loading={saving} onClick={save}>Save</Button>
```

See `ui/src/components/Button/Button.stories.tsx` for states and compositions.
