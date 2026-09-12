import type { Meta, StoryObj } from "@storybook/react-vite";
import { FileText, Image as ImageIcon } from "lucide-react";
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
} satisfies Meta<typeof Attachment>;
export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <AttachmentGroup style={{ width: 420 }}>
      <Attachment state="uploading">
        <AttachmentMedia>
          <FileText size={20} aria-hidden="true" />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>speaker-notes.pdf</AttachmentTitle>
          <AttachmentDescription>アップロード中… 2.4 MB</AttachmentDescription>
        </AttachmentContent>
        <AttachmentActions>
          <AttachmentAction aria-label="アップロードをキャンセル" />
        </AttachmentActions>
      </Attachment>
      <Attachment size="sm" state="done">
        <AttachmentMedia variant="image">
          <ImageIcon size={20} aria-hidden="true" />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>venue-photo.png</AttachmentTitle>
          <AttachmentDescription>完了</AttachmentDescription>
        </AttachmentContent>
      </Attachment>
    </AttachmentGroup>
  ),
};
