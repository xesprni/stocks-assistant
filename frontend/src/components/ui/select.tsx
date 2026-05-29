import * as React from "react";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

export type SelectOption = {
  description?: string;
  disabled?: boolean;
  label: string;
  value: string;
};

export type SelectProps = {
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  value: string;
};

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  ({ "aria-label": ariaLabel, className, disabled, onValueChange, options, placeholder, value }, ref) => {
    const [open, setOpen] = React.useState(false);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const listboxId = React.useId();
    const selected = options.find((option) => option.value === value);
    const label = selected?.label || placeholder || "";

    React.useEffect(() => {
      if (!open) return undefined;

      function closeOnOutside(event: PointerEvent) {
        const path = event.composedPath();
        if (!rootRef.current || !path.includes(rootRef.current)) setOpen(false);
      }

      function closeOnEscape(event: KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
      }

      document.addEventListener("pointerdown", closeOnOutside);
      document.addEventListener("keydown", closeOnEscape);
      return () => {
        document.removeEventListener("pointerdown", closeOnOutside);
        document.removeEventListener("keydown", closeOnEscape);
      };
    }, [open]);

    function selectOption(option: SelectOption) {
      if (option.disabled) return;
      onValueChange(option.value);
      setOpen(false);
    }

    return (
      <div className={cn("relative min-w-0", className)} ref={rootRef}>
        <button
          aria-controls={listboxId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          className={cn(
            "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background/70 px-3 py-1.5 text-left text-sm text-foreground shadow-sm transition-all",
            "hover:border-primary/45 hover:bg-background focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
            "disabled:cursor-not-allowed disabled:opacity-50",
            open && "border-primary/60 bg-background ring-2 ring-primary/15",
          )}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          ref={ref}
          type="button"
        >
          <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>{label}</span>
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180 text-primary")} />
        </button>

        {open ? (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border/80 bg-popover p-1 text-popover-foreground shadow-[0_18px_46px_hsl(var(--foreground)_/_0.16)]"
            id={listboxId}
            role="listbox"
          >
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  aria-selected={active}
                  className={cn(
                    "flex w-full min-w-0 items-start gap-2 rounded-sm px-2.5 py-2 text-left text-xs transition-colors",
                    active ? "bg-primary/10 text-primary" : "hover:bg-muted/70",
                    option.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                  )}
                  disabled={option.disabled}
                  key={option.value}
                  onClick={() => selectOption(option)}
                  role="option"
                  type="button"
                >
                  <Check className={cn("mt-0.5 size-3.5 shrink-0", active ? "opacity-100" : "opacity-0")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{option.label}</span>
                    {option.description ? <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{option.description}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    );
  },
);
Select.displayName = "Select";

export { Select };
