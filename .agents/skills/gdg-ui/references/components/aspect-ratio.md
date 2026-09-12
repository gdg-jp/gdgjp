# AspectRatio

## Use case

Use this Radix wrapper to reserve a media ratio and reduce layout shift. `ratio` is width/height (check the source for the default), and child media must provide its own alt text and object-fit.

Avoid: using it for fixed content heights or arbitrary layout grids.

## Public API

`AspectRatio`. Check `ui/src/components/AspectRatio/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<AspectRatio ratio={16 / 9}><img src={image} alt="Venue" /></AspectRatio>
```

See `ui/src/components/AspectRatio/AspectRatio.stories.tsx` for states, compositions, and narrow-width layouts.
