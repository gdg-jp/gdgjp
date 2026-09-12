# Full migration procedure

Follow this procedure only when the requested scope explicitly includes a complete app migration.

1. Confirm that `@gdgjp/ui` exports `DropdownMenuRadioItem`, `Stack` accepts `align`, `Button`
   accepts `fullWidth`, `FormField` accepts `hideLabel`, and `AppShell` renders `SidebarTrigger`.
   If any are absent, stop and submit a library-defect report instead of adding an app workaround.
2. Before editing, inventory every `app/routes/` file (screen and authentication requirement),
   every `app/components/ui/*` file to be removed (replacement and missing capability), and all
   direct imports of `lucide-react`, `radix-ui`, `@radix-ui/*`, `class-variance-authority`,
   `sonner`, `next-themes`, and `tailwind-merge` under `app/**`.
3. Establish the foundation first: stylesheet layer order and imports, root provider, and app
   shell. Keep it in its own commit and confirm any difference is token-derived.
4. Convert one screen at a time. For each: check light/dark at 390px and 1280px in a browser,
   explain each visual difference in one sentence, check keyboard reachability, then commit.
   Do not combine two screens in one commit.
5. Delete `app/components/ui/` as a directory, then remove dependencies used only by it.
6. Remove locale keys made unused by the migration.
7. Submit the library-defect report described in the main skill.
8. Handoff with changed files, final inventory, defect report, commands and results, unverified
   work, and each intentional visual difference.

Run these completion checks:

```sh
pnpm ci:quick
pnpm --filter @gdgjp/<app> exec vitest run
pnpm --filter @gdgjp/<app> exec playwright test
pnpm --filter @gdgjp/ui test:consumer # when shared imports, exports, or CSS changed
node scripts/check-ui-conventions.mjs <app>
```

Then inspect every touched screen in both themes at 390px and 1280px: no floating black or white
hairlines, no horizontal document overflow, visible ordered Tab focus, a collapsing sidebar with
content reflow, and menu labels that do not shift when selection changes. Passing axe and tests
do not replace this browser review.
