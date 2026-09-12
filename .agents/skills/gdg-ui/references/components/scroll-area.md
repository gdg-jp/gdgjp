# ScrollArea

## Use case

Add custom-styled scrollbars to a region constrained in height or width. Normally, pass content directly to `ScrollArea` to compose the viewport, vertical and horizontal scrollbars, and corner. Individual parts are also public, but do not duplicate the default parts inside a `ScrollArea` that already contains them. Verify wheel, touch, and keyboard scrolling.

Avoid: using it on the document body, in a region with little content, or to hide the root cause of overflow.

## Public API

`ScrollArea`, `ScrollAreaViewport`, `ScrollAreaScrollbar`, `ScrollAreaThumb`, `ScrollAreaCorner`. Check `ui/src/components/ScrollArea/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<ScrollArea aria-label="Notifications" className="max-h-80">{notifications}</ScrollArea>
```

See `ui/src/components/ScrollArea/ScrollArea.stories.tsx` for states and compositions.
