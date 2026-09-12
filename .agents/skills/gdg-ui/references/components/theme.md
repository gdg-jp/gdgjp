# Theme API

## Use case

Place one ThemeProvider in the app document and use the default system theme with the `gdg-apps-theme` storage key. Follow app integration for the CSP nonce, forcedTheme, and hydration. ThemeToggle selects system/light/dark. `cn` is the public class-composition helper built with clsx and tailwind-merge.

Avoid: multiple Providers, subtree themes, DOM branches based on the theme value before mount, or dependencies on internal classes.

## Public API

`ThemeProvider`, `ThemeToggle`, `useTheme`, `ThemeProviderProps` (`ui/src/themes/`) and `cn` (`ui/src/utils/`). Check `ui/src/themes/` and `ui/src/utils/` for exact types and defaults.

## Minimal example

```tsx
<ThemeProvider nonce={nonce}><App /><ThemeToggle /></ThemeProvider>
```

See `ui/src/themes/ThemeProvider.stories.tsx` for states and compositions.
