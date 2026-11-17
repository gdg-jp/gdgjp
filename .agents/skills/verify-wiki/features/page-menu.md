# Page display settings

## Sub-features

An author changes small text and full width, retains those settings for that page, and leaves another page unchanged.

## How to get to it (user POV)

Open a Wiki page on a desktop viewport and choose **More actions**.

## Driving it with Orca browser

Set the author fixture cookie and navigate to the seeded page. Record the visible article's width through Orca eval. Open **More actions**, click **Small text**, then **Full width**. Observe `data-small-text=true`, increased width, and 14px computed text size for `.md-editor-preview`.

Reload through Orca, reopen the menu, and confirm **Full width** remains checked. Create another page through POST `/s/gdg-jp/wiki/new` with the author cookie and real title and content fields. Navigate to its returned Location. Open **More actions** and confirm **Full width** is unchecked there.

Capture the actions and screenshots. The existing recipe is `desktop menu copies Markdown and persists page-local display settings` in `page-menu.spec.ts`; its clipboard checks are additional optional coverage.

## Gotchas

This journey covers a desktop viewport. Mobile navigation has separate existing tests. New pages are local fixtures and disappear with the helper's scratch workspace.
