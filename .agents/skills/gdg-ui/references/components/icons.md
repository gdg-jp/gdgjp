# Icons

## Use case

Use `Icons` for non-interactive Lucide icons through the public `@gdgjp/ui` contract. It is a display component, not an action; compose it with `Button` or `IconButton` when an icon is part of an interaction.

## Public API

Import `Icons` from `@gdgjp/ui` and check `ui/src/components/Icons/index.ts` and `Icons.tsx` for the exact types.

- `name` is required and accepts a Lucide name with or without the `Icon` suffix, such as `Heart` or `SparklesIcon`. The public `IconName` union in `IconName.ts` is the source of truth; an unknown name throws a clear runtime error.
- `size` defaults to `24`.
- `animateOnHover` defaults to `true`. The wrapper controls the underlying `lucide-animated` animation and disables decorative hover animation when `prefers-reduced-motion` is enabled.
- Other supported HTML attributes can be passed through. `className` is merged with the public `gdg-icons` class.
- A ref exposes `startAnimation()` and `stopAnimation()` through `IconsHandle` when imperative control is genuinely needed.

Do not make the app depend on `lucide-animated` just to render an icon; use the shared wrapper and its public name contract.

## Accessibility and interaction

- Give a meaningful standalone icon an `aria-label` or `aria-labelledby`; `Icons` assigns `role="img"` automatically unless an explicit role is supplied.
- Mark a decorative icon `aria-hidden="true"`. Inside a `Button` or `IconButton`, the action's label belongs to the control and the child icon should normally be decorative.
- Hover animation is supplemental feedback. Do not rely on it to communicate an action or state, and do not recreate reduced-motion handling in the app.

## Minimal examples

```tsx
import { Button, IconButton, Icons } from "@gdgjp/ui";

<Icons name="Heart" aria-label="お気に入り" />
<IconButton aria-label="お気に入り">
  <Icons name="Heart" aria-hidden="true" />
</IconButton>
<Button>
  <Icons name="Sparkles" aria-hidden="true" />
  生成する
</Button>
```

See `ui/src/components/Icons/Icons.stories.tsx` for animated, static, and decorative states.
