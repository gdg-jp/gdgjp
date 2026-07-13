import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { SubmitButton } from "~/components/ui/submit-button";

export function CampaignDialog() {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<{ ok: true } | { error: string }>();
  const pending = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && "ok" in fetcher.data) {
      setOpen(false);
    }
  }, [fetcher.data, fetcher.state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Create campaign
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="border-b">
          <DialogTitle>Create campaign</DialogTitle>
          <DialogDescription>
            Group links for one event. The code only suggests short link slugs; it does not restrict
            them.
          </DialogDescription>
        </DialogHeader>
        <fetcher.Form method="post" className="space-y-5 px-5 pb-5">
          <input type="hidden" name="intent" value="create" />
          <div className="space-y-2">
            <Label htmlFor="campaign-name">Event name</Label>
            <Input id="campaign-name" name="name" required maxLength={80} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="campaign-code">Short code</Label>
            <Input
              id="campaign-code"
              name="code"
              required
              maxLength={16}
              pattern="[A-Za-z0-9][A-Za-z0-9_-]*"
              placeholder="df26"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Letters, numbers, underscores, and hyphens. Saved in lowercase.
            </p>
          </div>
          {fetcher.data && "error" in fetcher.data ? (
            <Alert variant="destructive">
              <AlertDescription>{fetcher.data.error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <SubmitButton pending={pending} pendingLabel="Creating…">
              Create campaign
            </SubmitButton>
          </DialogFooter>
        </fetcher.Form>
      </DialogContent>
    </Dialog>
  );
}
