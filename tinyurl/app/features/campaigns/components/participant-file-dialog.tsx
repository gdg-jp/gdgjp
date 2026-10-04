import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  type CampaignChannelOption,
  CampaignParticipantImportWizard,
  type ConnpassImportDraft,
} from "~/features/campaigns/components/participant-import-wizard";
import type { DetailChannel } from "~/features/campaigns/detail-types";

export async function analyzeParticipantFile(
  file: File,
  channels: CampaignChannelOption[],
): Promise<ConnpassImportDraft> {
  const { analyzeConnpassParticipantsFile } = await import(
    "~/features/campaigns/campaign-participant-import.client"
  );
  return analyzeConnpassParticipantsFile(file, channels);
}

export function ImportConnpassDialog({
  channels,
  triggerLabel,
}: {
  channels: DetailChannel[];
  triggerLabel: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="size-4" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader className="border-b">
          <DialogTitle>{triggerLabel}</DialogTitle>
          <DialogDescription>
            Extract participant acquisition data and map each questionnaire option to one Campaign
            channel.
          </DialogDescription>
        </DialogHeader>
        <CampaignParticipantImportWizard
          analyzeFile={analyzeParticipantFile}
          channels={channels.map(({ id, name, code }) => ({ id, name, code }))}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
