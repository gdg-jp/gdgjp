# Marker

## Use case

Use as a compact marker surface for a map, timeline, or similar display. variant is default/border/separator. Compose an icon and content, and communicate position and state with text or an accessible name as well.

Avoid: using it instead of a Badge, button, or ordinary list bullet.

## Public API

`Marker`, `MarkerIcon`, `MarkerContent`, `MarkerVariant`. Check `design-system/src/components/Marker/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Marker variant="border"><MarkerIcon>●</MarkerIcon><MarkerContent>Venue A</MarkerContent></Marker>
```

See `design-system/src/components/Marker/Marker.stories.tsx` for states, compositions, and narrow-width layouts.
