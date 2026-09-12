# Progress

## Use case

Use for a Radix progress indicator. Put value/max and an accessible label on the Root, and the visual treatment on Indicator. Pair indeterminate progress with text or Spinner.

Avoid: using it instead of a completed/failed status or step navigation, or showing progress by color alone.

## Public API

`Progress`, `ProgressIndicator`. Check `ui/src/components/Progress/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Progress aria-label="Upload" value={percent}><ProgressIndicator /></Progress>
```

See `ui/src/components/Progress/Progress.stories.tsx` for states, compositions, and narrow-width layouts.
