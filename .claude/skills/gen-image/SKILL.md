---
name: gen-image-cli
description: Generate images inside Claude Code (CLI) by calling the locally installed Codex CLI via Bash (backed by OpenAI Image-2, API model gpt-image-2), saving outputs to ./images/ in the current working directory. Only for use inside the Claude Code environment. Trigger words: generate image, draw an image, make an image, 生圖.
allowed-tools: Bash(codex:*) Bash(mkdir:*) Bash(ls:*) Bash(pwd:*)
---

# Image Generation Skill (Claude Code CLI version)

**For use only in the Claude Code terminal environment** — this Skill calls the user's locally installed Codex CLI directly via Bash. If you are in the Claude desktop app / Cowork window, use the `gen-image-app` Skill instead.

When the user says "generate image", "draw an image", "make an image", or "生圖", follow the steps below.

## Prerequisites

- Codex CLI 0.125 or later is installed on the user's machine
- The user is logged into Codex via their ChatGPT account (`codex login status` shows `Logged in using ChatGPT`)

## Steps

1. **Create the output directory**: `mkdir -p ./images` (the `-C "$(pwd)"` flag below re-evaluates the cwd inline, so no separate `pwd` capture is needed — only run `pwd` if you need to sanity-check that the cwd matches the user's expected project root)
2. **Extract the prompt body and filename from the user's request**:
   - **Strip framing tokens first**: remove leading imperatives ("Generate / Draw / Make / 生圖：" etc.) and trailing politeness ("for me / please / お願い"). What remains is the **image-description phrase**. All word counts below refer to this phrase, not the full user message.
   - **Image description for the prompt body** — built from three buckets, in this order:
     1. *Verbatim core*: the image-description phrase, kept as close to the user's wording as possible. You may light-edit articles for grammatical flow inside the template (e.g. "an architecture diagram showing …").
     2. *User-stated constraints*: any explicit constraint clauses the user gave (e.g. "all labels in English", "16:9 aspect", "no text in image"). Preserve verbatim. Do not invent constraints.
     3. *Optional qualifiers*: when the image-description phrase is **bare (≤4 words)** and contains no structural detail, you may add up to ~5 short stylistic qualifiers (lighting / mood / medium / setting). Do **not** add qualifiers when the phrase already names structural elements (components, counts, layouts). Attribute clauses on a single subject ("wearing sunglasses", "holding a sword", "colored red") are **not** structural — they count toward the word budget but still permit qualifiers.
   - **Filename**: short English, kebab-case, lowercase ASCII, ≤4 hyphen-separated segments, ending in `.png`. Pick the most distinctive noun(s) from the image-description phrase. Examples: `cyberpunk-cat.png`, `shiba-glasses.png`, `microservices-arch.png`. For variations of one subject, suffix the variant inside the 4-segment budget (`cyberpunk-cat-neon.png`).
   - **Collision**: if the chosen filename already exists in `./images/`, append `-2`, `-3`, … until unique. Do not overwrite.
3. **Call codex exec to generate the image**:

   ```bash
   codex exec -C "$(pwd)" -s workspace-write \
     --skip-git-repo-check \
     "Please use the image generation tool to generate: [image description], and save it as ./images/[filename].png"
   ```

   **If the user asks for N images** (e.g. "three cyberpunk cats in different styles"): repeat this step N times, once per image, each with a distinct filename (e.g. `cyberpunk-cat-neon.png`, `cyberpunk-cat-graffiti.png`, `cyberpunk-cat-anime.png`) and a prompt body that names the variation. Do not try to batch N images into one `codex exec` call — the template names exactly one output file.
4. **Check the output**: run `ls -la ./images/` to confirm the file(s) exist
5. **Report the absolute path(s)** back to the user. Mirror the user's language (e.g. reply in Chinese if they invoked the skill with `生圖`).

## Notes

- `-C "$(pwd)"` re-expands the current cwd at call time, so the codex call always runs in the cwd. Only manually `pwd` if you suspect the cwd is wrong.
- The first run may be blocked by `~/.codex` permission issues; the user has to run this once themselves:
  `sudo chown -R $(whoami) ~/.codex`
- The first image takes about 1 minute; subsequent ones are faster
- ChatGPT Plus / Pro / Business users get "advanced output from the thinking model"; free users can still use the basic version

## Example conversation

> User: "Generate a cyberpunk-style cat for me" (cwd: `/Users/me/blog`)
>
> Skill behavior:
> 1. `mkdir -p ./images`
> 2. User input is bare ("cyberpunk-style cat") → add stylistic qualifiers. Filename: `cyberpunk-cat.png` (kebab-case, 2 words).
> 3. `codex exec -C "$(pwd)" -s workspace-write --skip-git-repo-check "Please use the image generation tool to generate: a cyberpunk-style cat, neon lights, night scene, rainy night, and save it as ./images/cyberpunk-cat.png"`
> 4. `ls -la ./images/` → confirm `cyberpunk-cat.png` exists
> 5. Report: "Image saved to `/Users/me/blog/images/cyberpunk-cat.png`"
