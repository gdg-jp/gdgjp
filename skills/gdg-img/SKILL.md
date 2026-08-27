---
name: gdg-img
description: Use the gdg CLI to discover, upload, replace, optimize, or delete images on img.gdgs.jp. Apply to `gdg img` image-management tasks, not general local image editing.
---

# GDG Image CLI

Use `gdg img` for hosted image management. The service returns indented JSON on success.

## Workflow

1. Check `gdg img --help` and the chosen subcommand's help before composing a command.
2. Ensure `gdg login` has been completed. `GDG_IMG_URL` is only for intentionally targeting a
   development service; production defaults to `https://img.gdgs.jp`.
3. Discover IDs with `list` or verify a target with `get` before replacing, adding a mobile
   variant, or deleting when the target is not already unambiguous.
4. Use `upload` for a new public URL, `replace` to preserve an existing public URL, and `mobile`
   only to attach the mobile-optimized variant.
5. After a mutation, report the returned ID/URL and preserve JSON output when automation needs it.

## Commands

```sh
gdg img list [--chapter-id ID] [--limit N] [--cursor CURSOR]
gdg img get IMAGE_ID
gdg img upload FILE [--chapter-id ID]
gdg img replace IMAGE_ID FILE
gdg img mobile IMAGE_ID FILE
gdg img delete IMAGE_ID
```

`list` returns a page and pagination cursor; it does not auto-page. `replace` keeps the existing
public URL stable. `mobile` uploads a separate mobile-optimized variant for an existing image.

## Safety and access

- Supply `--chapter-id` on upload when the caller belongs to multiple chapters. Never guess it.
- Verify local files exist before upload, replace, or mobile operations.
- `delete` removes the hosted image. Run it only for an explicitly identified image.
