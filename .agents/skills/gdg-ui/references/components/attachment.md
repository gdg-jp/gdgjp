# Attachment

## Use case

Use as a display composition for upload and download attachments. `state` is `idle | uploading | processing | error | done` (default done), `size` is `default | sm | xs`, and orientation is horizontal/vertical. Compose title/description/action with parts, and communicate progress and errors in text as well.

Avoid: using it as a general Card or image gallery, or making it responsible for the actual file-upload process.

## Public API

`Attachment`, `AttachmentMedia`, `AttachmentContent`, `AttachmentTitle`, `AttachmentDescription`, `AttachmentActions`, `AttachmentAction`, `AttachmentTrigger`, `AttachmentGroup`, `AttachmentState`, `AttachmentSize`, `AttachmentPartProps`. Check `ui/src/components/Attachment/index.ts` and the implementation `.tsx` for exact types and defaults, and preserve native/Radix-derived props, events, and refs.

## Minimal example

```tsx
<Attachment state="done"><AttachmentContent><AttachmentTitle>report.pdf</AttachmentTitle></AttachmentContent><AttachmentActions><AttachmentAction>Open</AttachmentAction></AttachmentActions></Attachment>
```

See `ui/src/components/Attachment/Attachment.stories.tsx` for states, compositions, and narrow-width layouts.
