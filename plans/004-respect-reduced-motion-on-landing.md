# 004 — Respect reduced motion on the landing page

- **Status**: DONE
- **Commit**: 2257801
- **Severity**: MEDIUM
- **Category**: Accessibility
- **Estimated scope**: 1 file, about 20 lines

## Problem

`wiki/app/components/LandingContent.tsx:303-446` assigns the same perpetual positional animation
to ten large decorative elements. Representative current code:

```tsx
// wiki/app/components/LandingContent.tsx:303 — current
<div
  aria-hidden="true"
  style={{
    position: "absolute",
    top: "-120px",
    left: "-120px",
    width: "480px",
    height: "480px",
    borderRadius: "50%",
    background: "radial-gradient(circle, #4285f440 0%, transparent 70%)",
    filter: "blur(40px)",
    animation: "lp-float 8s ease-in-out infinite",
  }}
/>
```

The inline stylesheet defines 14px of continuous movement without a preference branch:

```css
/* wiki/app/components/LandingContent.tsx:523 — current */
@keyframes lp-float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-14px); }
}
```

The playful motion is appropriate for this rare marketing surface, but it must not continue for
people who request reduced motion.

## Target

Keep the existing animation for the default preference. Add this exact reduction to the same
component-scoped stylesheet:

```css
@media (prefers-reduced-motion: reduce) {
  .lp-floating-decoration {
    animation: none !important;
    transform: none !important;
  }
}
```

Give every element currently using `lp-float` the shared `lp-floating-decoration` class. Preserve
their static gradients, blur, position, opacity, and rotation where present. For the two squares
with base rotation, do not erase their authored static rotation; move that rotation to a nested
element or a dedicated static class before applying the reduced-motion rule.

## Repo conventions to follow

- The application centralizes reduced-motion CSS at `wiki/app/app.css:310`, but these landing
  keyframes are component-scoped at `LandingContent.tsx:521`; keep their preference override beside
  them so the contract remains visible.
- Reduced motion removes position changes but retains useful/static visuals, matching
  `.motion-presence` at `wiki/app/app.css:315-318`.

## Steps

1. Add `lp-floating-decoration` to all ten elements whose inline style sets `lp-float`.
2. Add the exact reduced-motion media query to the inline stylesheet.
3. Preserve the two squares' static `rotate(15deg)` and `rotate(-20deg)` appearance without allowing
   the floating keyframe to overwrite or remove it.

## Boundaries

- Do NOT remove the default landing animation or change its paths, durations, colors, or blur.
- Do NOT add JS media-query listeners or dependencies.
- Do NOT change product UI motion outside `LandingContent.tsx`.
- If cited code has drifted since commit `2257801`, STOP and report instead of improvising.

## Verification

- **Mechanical**: run `pnpm --filter @gdgjp/wiki typecheck` and `pnpm lint`.
- **Feel check**: load the landing page normally and confirm all decorations still float. Toggle
  `prefers-reduced-motion: reduce` in DevTools Rendering and confirm every decoration becomes
  stationary immediately while the composition remains visually complete.
- **Done when**: no `lp-float` element moves under reduced motion and normal motion is unchanged.
