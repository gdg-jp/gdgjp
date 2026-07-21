# 003 — Make anchored overlay motion interruptible

- **Status**: TODO
- **Commit**: 2257801
- **Severity**: HIGH
- **Category**: Interruptibility / easing / accessibility
- **Estimated scope**: 4 files, about 80 lines

## Problem

Frequently toggled anchored surfaces use `tw-animate-css` keyframes. For example:

```tsx
// wiki/app/components/ui/popover.tsx:33 — current
"... origin-(--radix-popover-content-transform-origin) ... data-[state=closed]:animate-out ... data-[state=open]:animate-in ..."
```

```tsx
// wiki/app/components/ui/dropdown-menu.tsx:36 — current
"... origin-(--radix-dropdown-menu-content-transform-origin) ... data-[state=closed]:animate-out ... data-[state=open]:animate-in ... motion-reduce:duration-100"
```

```tsx
// wiki/app/components/ui/tooltip.tsx:40 — current
"... origin-(--radix-tooltip-content-transform-origin) ... data-[state=closed]:animate-out ... data-[state=instant-open]:animate-in ... motion-reduce:duration-100"
```

Keyframes restart rather than retarget from the current visual state when pointer or keyboard input
reverses rapidly. Dropdowns and tooltips also fall back to the package's weak `ease`, because the
global selector at `wiki/app/app.css:291` covers popovers but not those two primitives. Their
reduced-motion class shortens movement but does not remove translation or scale.

## Target

All Popover, DropdownMenu content/subcontent, and Tooltip content must use CSS transitions that
retarget from the current state:

```css
transition-property: opacity, transform;
transition-duration: 200ms;
transition-timing-function: cubic-bezier(0.23, 1, 0.32, 1);
opacity: 1;
transform: translate3d(0, 0, 0) scale(1);
```

Closed state:

```css
opacity: 0;
transform: translate3d(var(--overlay-x, 0), var(--overlay-y, 0), 0) scale(0.95);
transition-duration: 140ms;
```

Use 8px offsets for dropdowns/popovers (`--motion-distance-md`) and 4px for tooltips
(`--motion-distance-sm`), with signs determined by `data-side`. Retain the existing Radix transform
origin variables. For reduced motion, retain a 100ms opacity transition but force translation to
zero and scale to `1`.

Because Radix may unmount closed content after its presence lifecycle, verify that exit transitions
actually complete. If the installed primitive cannot keep content mounted for a CSS transition,
use the repository's `MotionPresence` pattern around the content state rather than reverting to
keyframes.

## Repo conventions to follow

- Tokens are defined at `wiki/app/app.css:152-158`:
  `200ms`, `140ms`, `4px`, `8px`, and `cubic-bezier(0.23, 1, 0.32, 1)`.
- `.motion-presence` at `wiki/app/app.css:251-265` is the exemplar for interruptible state-driven
  opacity/transform transitions.
- Preserve Radix origins already present in each primitive.

## Steps

1. Add one shared anchored-overlay transition layer to `wiki/app/app.css`, keyed by the existing
   `data-slot` and `data-state` attributes. Encode side-specific 4px/8px offsets there.
2. In `ui/popover.tsx`, remove `animate-in`, `animate-out`, fade, zoom, slide, and duration utility
   classes now owned by the shared layer. Keep origin, layout, appearance, and positioning classes.
3. Repeat for both content variants in `ui/dropdown-menu.tsx`.
4. Repeat for `ui/tooltip.tsx`, covering both delayed-open and instant-open Radix states.
5. Extend the reduced-motion block so all three primitives retain opacity feedback for 100ms but
   have no translation or scaling.
6. Confirm keyboard and pointer reversal does not restart from the initial keyframe.

## Boundaries

- Do NOT change Dialog, AlertDialog, Sheet, trigger APIs, focus management, portal behavior, or
  z-indexes.
- Do NOT change transform origins or add dependencies.
- Do NOT use `transition: all`.
- Do NOT remove opacity feedback under reduced motion.
- If Radix presence behavior prevents exit completion, STOP and document it before changing markup.
- If cited code has drifted since commit `2257801`, STOP and report instead of improvising.

## Verification

- **Mechanical**: run `pnpm --filter @gdgjp/wiki typecheck` and `pnpm lint`; both must pass.
- **Feel check**: at 10% playback, open/close each surface rapidly with mouse and keyboard. Confirm
  motion reverses from its current frame, the origin remains at the trigger, and no surface flashes.
  Test all four sides. Emulate reduced motion and confirm only a 100ms fade remains.
- **Done when**: no affected primitive uses enter/exit keyframes, repeated toggles are interruptible,
  and reduced motion contains no positional or scale movement.

