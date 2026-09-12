# Bubble

## Use case

Display short conversational content as a cohesive unit. `variant` is default/secondary/muted/tinted/outline/ghost/destructive, and `align` is start/end. Use a group to show continuity, and compose timestamps or senders with Message or similar components.

Avoid: using it as a general Card, Alert, or container for a long document. Do not distinguish speakers by color alone.

## Public API

`Bubble`, `BubbleContent`, `BubbleReactions`, `BubbleGroup`, `BubbleVariant`. Check `ui/src/components/Bubble/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Bubble variant="secondary" align="start"><BubbleContent>Hello</BubbleContent></Bubble>
```

See `ui/src/components/Bubble/Bubble.stories.tsx` for states, compositions, and narrow-width layouts.
