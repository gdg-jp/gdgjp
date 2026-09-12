# Toast

## Use case

Compose transient feedback in detail with Radix parts. Place Provider/Viewport once in the app shell, add title/description/action/close to Toast, and preserve swipe and focus behavior.

Avoid: using it as the only notification for an error that requires resolution, for a persistent message, or instead of Dialog. Choose Toaster for a simple notification.

## Public API

`ToastProvider`, `ToastViewport`, `Toast`, `ToastTitle`, `ToastDescription`, `ToastAction`, `ToastClose`. Check `ui/src/components/Toast/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<ToastProvider><Toast open={open}><ToastTitle>Saved</ToastTitle><ToastClose>Close</ToastClose></Toast><ToastViewport /></ToastProvider>
```

See `ui/src/components/Toast/Toast.stories.tsx` for states, compositions, and narrow-width layouts.
