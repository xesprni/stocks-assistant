import {
  Loader2
} from "lucide-react";

export function PageFallback() {
  return (
    <div className="grid h-full min-h-0 flex-1 place-items-center">
      <div className="flex items-center gap-2 rounded-md border border-border/80 bg-background/70 px-3 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-primary" />
        Loading...
      </div>
    </div>
  );
}
