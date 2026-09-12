# Message

## Use case

Compose one conversation message from avatar/header/content/footer. Preserve the reading order of the sender, time, and state; Bubble can be used inside content.

Avoid: using it as a standalone toast/alert or a general Card. Do not communicate the sender only through the avatar's position.

## Public API

`Message`, `MessageGroup`, `MessageAvatar`, `MessageContent`, `MessageHeader`, `MessageFooter`. Check `ui/src/components/Message/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Message><MessageAvatar><Avatar alt="Yamada" fallback="YA" /></MessageAvatar><MessageContent><MessageHeader>Yamada</MessageHeader><Bubble>Confirmed</Bubble></MessageContent></Message>
```

See `ui/src/components/Message/Message.stories.tsx` for states, compositions, and narrow-width layouts.
