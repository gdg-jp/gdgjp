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
5. Every image belongs to exactly one chapter; anyone in that chapter can view, replace, move, or
   delete it. Use `folders` to organize images within a chapter (flat, no nesting) and `share` to
   re-attribute an image to a different chapter the caller belongs to.
6. After a mutation, report the returned ID/URL and preserve JSON output when automation needs it.

## Commands

```sh
gdg img list [--chapter-id ID] [--folder-id ID|unfiled] [--limit N] [--cursor CURSOR]
gdg img get IMAGE_ID
gdg img upload FILE [--chapter-id ID]
gdg img replace IMAGE_ID FILE
gdg img mobile IMAGE_ID FILE
gdg img slug IMAGE_ID [SLUG] [--clear]
gdg img move IMAGE_ID (--folder-id ID | --clear)
gdg img share IMAGE_ID --chapter-id ID
gdg img delete IMAGE_ID

gdg img folders list [--chapter-id ID] [--limit N] [--cursor CURSOR]
gdg img folders get FOLDER_ID
gdg img folders create --name NAME [--chapter-id ID]
gdg img folders update FOLDER_ID --name NAME
gdg img folders delete FOLDER_ID
```

`list` and `folders list` each return a page and pagination cursor; neither auto-pages. `replace`
keeps the existing public URL stable. `mobile` uploads a separate mobile-optimized variant for an
existing image. `move` assigns an image to a folder in its own chapter — a folder in a different
chapter is rejected. `share` re-attributes an image to a different chapter and clears its folder
as a side effect (a folder belongs to exactly one chapter); only a super admin may target a
chapter the caller doesn't belong to. Deleting a folder does not delete its images; they fall
back to unfiled.

## Safety and access

- Supply `--chapter-id` on upload/folder-create when the caller belongs to multiple chapters.
  Never guess it.
- Verify local files exist before upload, replace, or mobile operations.
- `delete` removes the hosted image. Run it only for an explicitly identified image.
- `folders delete` does not require the folder to be empty; confirm with the user before deleting
  a folder that still has images in it.
