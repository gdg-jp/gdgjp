import { FileText, Image as ImageIcon } from "lucide-react";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "./Attachment";
const meta = {
  title: "Components/Attachment",
  component: Attachment,
  parameters: { layout: "centered" },
};
export default meta;
export const States = {
  render: () =>
    _jsxs(AttachmentGroup, {
      style: { width: 420 },
      children: [
        _jsxs(Attachment, {
          state: "uploading",
          children: [
            _jsx(AttachmentMedia, {
              children: _jsx(FileText, { size: 20, "aria-hidden": "true" }),
            }),
            _jsxs(AttachmentContent, {
              children: [
                _jsx(AttachmentTitle, { children: "speaker-notes.pdf" }),
                _jsx(AttachmentDescription, {
                  children: "\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u4E2D\u2026 2.4 MB",
                }),
              ],
            }),
            _jsx(AttachmentActions, {
              children: _jsx(AttachmentAction, {
                "aria-label":
                  "\u30A2\u30C3\u30D7\u30ED\u30FC\u30C9\u3092\u30AD\u30E3\u30F3\u30BB\u30EB",
              }),
            }),
          ],
        }),
        _jsxs(Attachment, {
          size: "sm",
          state: "done",
          children: [
            _jsx(AttachmentMedia, {
              variant: "image",
              children: _jsx(ImageIcon, { size: 20, "aria-hidden": "true" }),
            }),
            _jsxs(AttachmentContent, {
              children: [
                _jsx(AttachmentTitle, { children: "venue-photo.png" }),
                _jsx(AttachmentDescription, { children: "\u5B8C\u4E86" }),
              ],
            }),
          ],
        }),
      ],
    }),
};
