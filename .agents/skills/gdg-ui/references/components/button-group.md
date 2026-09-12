# ButtonGroup

## Use case

Compose related actions into one visual group. orientation is horizontal (default)/vertical. Add context with Text and Separator. If the group cannot be identified from its surrounding context, add `aria-label`, and preserve each Button's own accessible name and state.

Avoid: forcing unrelated actions or an entire page action bar into one group.

## Public API

`ButtonGroup`, `ButtonGroupSeparator`, `ButtonGroupText`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/ButtonGroup/` for exact types and defaults.

## Minimal example

```tsx
<ButtonGroup><Button>Save</Button><Button variant="outline">Cancel</Button></ButtonGroup>
```

See `ui/src/components/ButtonGroup/ButtonGroup.stories.tsx` for states and compositions.
