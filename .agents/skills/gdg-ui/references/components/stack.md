# Stack

## Use case

Use as a vertical layout primitive with a default 16px gap. It accepts native div props/ref, `className`, and `align` (`stretch | start | center | end`) to create a flow for related content. When sectioning semantics are needed, use the appropriate element at the call site.

Avoid: using it as a wrapper merely to stack margins or as a substitute for nested Cards.

## Public API

`Stack`. Check `ui/src/components/Stack/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Stack><Heading level={2}>Overview</Heading><Text>Description</Text></Stack>
```

See `ui/src/components/Stack/Stack.stories.tsx` for states, compositions, and narrow-width layouts.
