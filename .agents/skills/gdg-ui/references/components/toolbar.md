# Toolbar

## Use case

Use as a responsive layout primitive for headings, filters, actions, and similar content. Preserve the reading/tab order of children, and ensure each control has its own accessible name. It intentionally does not provide the ARIA toolbar role or arrow navigation.

Avoid: using it for a rich editor that needs ARIA toolbar behavior or for a collection of unrelated controls.

## Public API

`Toolbar`. Check `ui/src/components/Toolbar/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Toolbar><Heading level={2}>Events</Heading><Inline><Input aria-label="Search" /><Button>Create</Button></Inline></Toolbar>
```

See `ui/src/components/Toolbar/Toolbar.stories.tsx` for states and compositions.
