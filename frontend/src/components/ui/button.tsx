import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "apple-button apple-pressable inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[0.625rem] text-[0.8125rem] font-semibold transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border border-primary/70 bg-primary text-primary-foreground shadow-[0_1px_2px_hsl(var(--primary)_/_0.22),inset_0_1px_0_hsl(0_0%_100%_/_0.18)] hover:bg-primary/90",
        destructive: "border border-destructive/70 bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline: "border border-input bg-[var(--control-bg)] text-foreground shadow-[var(--control-shadow)] hover:border-primary/45 hover:bg-[var(--control-hover-bg)]",
        secondary: "border border-secondary/55 bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/88",
        ghost: "border border-transparent hover:bg-muted/75 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-9 px-3.5 py-2",
        sm: "min-h-8 px-3 py-1.5 text-xs",
        lg: "min-h-11 px-5 text-sm",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
