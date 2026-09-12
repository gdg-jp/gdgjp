# Kbd

## Use case

Use for keyboard shortcut key labels. Arrange multiple keys with Group, and show only shortcuts that are actually available.

Avoid: using it as a button, badge, input value, or merely as monospace decoration.

## Public API

`Kbd`, `KbdGroup`. Check `ui/src/components/Kbd/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<KbdGroup><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup>
```

See `ui/src/components/Kbd/Kbd.stories.tsx` for states, compositions, and narrow-width layouts.
