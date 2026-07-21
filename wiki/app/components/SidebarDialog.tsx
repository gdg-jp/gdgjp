import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";

interface SidebarDialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
}

export default function SidebarDialog({
  open,
  onClose,
  children,
  title = "Navigation panel",
}: SidebarDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-[calc(100%-1.5rem)] max-w-md gap-0 overflow-hidden rounded-2xl border-border bg-card p-0 text-card-foreground shadow-2xl shadow-black/20"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
