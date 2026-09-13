import { Dialog, DialogContent, DialogTitle } from "@gdgjp/ui";

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
        aria-describedby={undefined}
        // gdg-ui-allow: literal-color — app-specific-layout-or-token
        className="w-[calc(100%-1.5rem)] max-w-md gap-0 overflow-hidden rounded-2xl border-border bg-surface p-0 text-foreground shadow-2xl shadow-content-primary/20"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}
