import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-5 items-center rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold leading-4 tracking-[0.01em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-primary/25 bg-primary text-primary-foreground",
        secondary: "border-secondary/30 bg-secondary text-secondary-foreground",
        muted: "border-border/80 bg-muted/70 text-muted-foreground",
        outline: "border-border/80 bg-[var(--control-bg)] text-foreground",
        danger: "border-destructive/40 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
