# InputOTP

## Use case

Use for fixed-length code input. Put maxLength, value/defaultValue, onChange, and name on the Root, and compose slots in index order. Give the whole group an accessible label and preserve paste and keyboard behavior.

Avoid: using it for general text or as separate independent fields.

## Public API

`InputOTP`, `InputOTPGroup`, `InputOTPSlot`, `InputOTPSeparator`. Do not strip native or Radix-derived props, events, or refs; check the current `index.ts` and `.tsx` in `ui/src/components/InputOTP/` for exact types and defaults.

## Minimal example

```tsx
<InputOTP aria-label="Verification code" maxLength={6}><InputOTPGroup>{[0,1,2,3,4,5].map(i => <InputOTPSlot key={i} index={i} />)}</InputOTPGroup></InputOTP>
```

See `ui/src/components/InputOTP/InputOTP.stories.tsx` for states and compositions.
