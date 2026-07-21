# Wiki animation improvement plans

These plans were produced from a read-only audit of the wiki app at commit `2257801`. They cover
all 11 vetted corrective findings. Additive missed opportunities were intentionally excluded.

| # | Plan | Severity | Status | Dependencies |
| --- | --- | --- | --- | --- |
| 001 | [Stop polling sidebar popover position every frame](001-stop-sidebar-popover-frame-loop.md) | HIGH | TODO | None |
| 002 | [Make desktop sidebar motion compositor-friendly](002-make-sidebar-motion-compositor-friendly.md) | HIGH | TODO | None |
| 003 | [Make anchored overlay motion interruptible](003-make-anchored-overlays-interruptible.md) | HIGH | TODO | None |
| 004 | [Respect reduced motion on the landing page](004-respect-reduced-motion-on-landing.md) | MEDIUM | DONE | None |
| 005 | [Standardize accessible loading motion](005-standardize-accessible-loading-motion.md) | MEDIUM | TODO | None |
| 006 | [Remove layout animation from the Share dialog](006-remove-share-dialog-layout-animation.md) | MEDIUM | TODO | Prefer 011 first |
| 007 | [Replace broad transition-all utilities](007-replace-transition-all.md) | MEDIUM | TODO | None |
| 008 | [Refine push-notification toggle motion](008-refine-push-toggle-motion.md) | MEDIUM | TODO | None |
| 009 | [Restrain the theme icon scale crossfade](009-restrain-theme-icon-scale.md) | MEDIUM | DONE | None |
| 010 | [Anchor sidebar popover motion to its trigger](010-anchor-sidebar-popover-to-trigger.md) | MEDIUM | TODO | 001 |
| 011 | [Unify MotionPresence timing defaults](011-unify-motion-presence-timings.md) | LOW | TODO | None |

## Recommended execution order

1. **001** removes continuous work from every open sidebar panel and establishes the event-driven
   positioning function that **010** extends.
2. **002** removes the highest-cost layout animation from the desktop shell.
3. **003** repairs the shared high-frequency overlay primitives before local polish work.
4. **011** aligns the shared presence defaults so later consumers inherit the final timing scale.
5. **006** replaces the Share dialog's layout animation using that aligned presence primitive.
6. **004** and **005** close the continuous-motion accessibility gaps.
7. **007** narrows broad transitions across cards and CTAs.
8. **008** and **009** refine isolated controls.
9. **010** adds trigger-relative origin calculation on top of **001**'s positioning lifecycle.

Plans without dependencies may be executed in parallel, but changes touching the same file should
be serialized. In particular, execute **001** before **010**, and preferably **011** before **006**.

## Execution

Run one plan at a time with `improve-animations execute <plan-path>`, review its diff and feel-check,
then mark its status `DONE` here and in the plan file. Each executor must stop if source has drifted
from the stamped commit rather than improvising beyond the plan boundaries.
