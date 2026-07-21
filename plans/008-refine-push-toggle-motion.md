# 008 — Refine push-notification toggle motion

- **Status**: TODO
- **Commit**: 2257801
- **Severity**: MEDIUM
- **Category**: Easing / accessibility
- **Estimated scope**: 1 file, 2 class-string edits

## Problem

The switch color and thumb movement use the default Tailwind transition curve and retain position
movement under reduced motion:

```tsx
// wiki/app/components/PushNotificationToggle.tsx:110 — current
<button
  type="button"
  disabled={busy}
  onClick={isEnabled ? handleDisable : handleEnable}
  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60 ${
    isEnabled ? "bg-blue-500" : "bg-gray-200"
  }`}
  role="switch"
  aria-checked={isEnabled}
>
  <span
    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${
      isEnabled ? "translate-x-5" : "translate-x-0"
    }`}
  />
</button>
```

This is on-screen movement, so it should use the product's strong ease-in-out curve. Motion-sensitive
users should get state feedback without lateral movement.

## Target

Default motion:

```tsx
transition-colors duration-200 ease-[var(--motion-ease-out)]
transition-transform duration-200 ease-[var(--motion-ease-in-out)]
```

Reduced motion:

```tsx
motion-reduce:duration-100
motion-reduce:transform-none
```

The track color and adjacent Enabled/Disabled text must remain the reduced-motion state indicators.
The thumb must remain at the left edge under reduced motion instead of teleporting laterally.

## Repo conventions to follow

- `--motion-ease-in-out` is exactly `cubic-bezier(0.77, 0, 0.175, 1)` at
  `wiki/app/app.css:158` and is already used for the rotating disclosure icon in
  `components/ingest/PageStructurePreview.tsx:174`.
- Reduced motion uses 100ms feedback throughout `wiki/app/app.css:310-339`.

## Steps

1. Apply `--motion-ease-out` and `motion-reduce:duration-100` to the switch track's color change.
2. Apply `--motion-ease-in-out` to the thumb movement.
3. Add `motion-reduce:duration-100 motion-reduce:transform-none` to the thumb, ensuring it overrides
   both enabled and disabled translate utilities.

## Boundaries

- Do NOT change switch dimensions, colors, state logic, request behavior, or ARIA attributes.
- Do NOT add bounce or a spring.
- Do NOT remove color/text feedback under reduced motion.
- If cited code has drifted since commit `2257801`, STOP and report instead of improvising.

## Verification

- **Mechanical**: run `pnpm --filter @gdgjp/wiki typecheck` and `pnpm lint`.
- **Feel check**: at 10% playback, toggle repeatedly and confirm movement reverses smoothly without
  overshoot. Emulate reduced motion and confirm the thumb does not move, while track color and text
  still communicate state in 100ms.
- **Done when**: default thumb movement uses the strong movement curve and reduced motion contains no
  positional change.

