# Avatar

## Use case

Use for compact identity for a person or group. `alt` and `fallback` are required, while `src` is optional. When the image fails, the fallback must still have the same accessible name as `role="img"`.

Avoid: using it for decorative images or general thumbnails. Choose meaningful alt/fallback text even when a name is adjacent to the avatar.

## Public API

`Avatar`. Check `ui/src/components/Avatar/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Avatar src={user.image} alt={user.name} fallback="GD" />
```

See `ui/src/components/Avatar/Avatar.stories.tsx` for states, compositions, and narrow-width layouts.
