# Direction

## Use case

Provide RTL/LTR direction to a Radix-aware component tree. Choose `dir` from the document language and content direction, and wrap only the required scope in the Provider.

Avoid: layout hacks that arbitrarily reverse visual order, or adding it unconditionally to ordinary Japanese pages.

## Public API

`DirectionProvider`, `Direction`, `useDirection`, `DirectionProviderProps`. Check `ui/src/components/Direction/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<DirectionProvider dir="rtl"><LocalizedPanel /></DirectionProvider>
```

See `ui/src/components/Direction/Direction.stories.tsx` for states and compositions.
