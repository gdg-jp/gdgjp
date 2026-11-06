#!/bin/sh
# Push the eval fixture pages into the e2e spaces through a runner-token clone (/sync).
#   RUNNER_TOKEN=… sh docs/eval/fixtures/push.sh
set -eu
: "${RUNNER_TOKEN:?RUNNER_TOKEN is required}"
WIKI="${GDG_WIKI_URL:-https://wiki.gdgs.jp}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
for space_dir in "$HERE"/pages/*/; do
  space="$(basename "$space_dir")"
  clone="$WORK/$space"
  GDG_WIKI_TOKEN="$RUNNER_TOKEN" GDG_WIKI_URL="$WIKI" \
    gdg wiki clone --space "$space" --no-raw --remote "gdg-wiki::$WIKI/api/cli/wiki" "$clone" >/dev/null
  for file in "$space_dir"*.md; do
    slug="$(basename "$file" .md)"
    title="$(sed -n 's/^title: //p' "$file" | head -1)"
    visibility="$(sed -n 's/^visibility: //p' "$file" | head -1)"
    mkdir -p "$clone/pages/$slug"
    {
      printf -- '---\ngdg_wiki: 1\nslug: %s\nlanguage: ja\ntitle: %s\nsummary: ""\n' "$slug" "$title"
      printf 'translation_status: ai\nvisibility: %s\ngeneral_role: viewer\n---\n\n' "$visibility"
      sed '1,/^---$/d' "$file"
    } > "$clone/pages/$slug/page.md"
  done
  git -C "$clone" add -A pages
  if ! git -C "$clone" diff --cached --quiet; then
    git -C "$clone" -c user.name="Eval fixtures" -c user.email=runner@wiki.gdgs.jp commit -qm "eval fixtures"
    GDG_WIKI_TOKEN="$RUNNER_TOKEN" git -C "$clone" push -q origin HEAD:main
  fi
  echo "pushed $space"
done
