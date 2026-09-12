# Toaster

## Use case

Use for a simple notification that applies the GDG theme to the Sonner API. Place `Toaster` once in the shell and call `toast(...)` from action results. Check the current Sonner-compatible API for promise/loading/update/dismiss.

Avoid: relying on toast alone for field errors, authentication failures, or failures that require retry. Do not create a duplicate provider alongside the Toast family.

## Public API

`Toaster`, `toast`. Check `ui/src/components/Toaster/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<><Button onClick={() => toast("Saved")}>Save</Button><Toaster /></>
```

See `ui/src/components/Toaster/Toaster.stories.tsx` for states, compositions, and narrow-width layouts.
