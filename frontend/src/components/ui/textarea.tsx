import * as React from "react";

import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "apple-control flex min-h-[7rem] w-full resize-y rounded-[0.75rem] border border-input bg-[var(--control-bg)] px-3 py-2.5 text-sm leading-6 text-foreground shadow-[var(--control-shadow)] transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:bg-[var(--control-selected-bg)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
