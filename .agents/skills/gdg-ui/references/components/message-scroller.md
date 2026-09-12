# MessageScroller

## Use case

Compose end-following behavior and a “jump to latest” action for a conversation list. Use viewport/content/item inside the provider, and preserve scroll behavior when items are added and when the user is reading history.

Avoid: using it instead of a general ScrollArea, an infinite list, or virtualization.

## Public API

`MessageScrollerProvider`, `MessageScroller`, `MessageScrollerViewport`, `MessageScrollerContent`, `MessageScrollerItem`, `MessageScrollerButton`. Check `ui/src/components/MessageScroller/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<MessageScrollerProvider><MessageScroller><MessageScrollerViewport><MessageScrollerContent>{messages.map(m => <MessageScrollerItem key={m.id}>{m.text}</MessageScrollerItem>)}</MessageScrollerContent></MessageScrollerViewport><MessageScrollerButton>Jump to latest</MessageScrollerButton></MessageScroller></MessageScrollerProvider>
```

See `ui/src/components/MessageScroller/MessageScroller.stories.tsx` for states, compositions, and narrow-width layouts.
