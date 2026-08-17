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
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  onValueChange: (value: string) => void;
  options?: SelectOption[];
  children?: React.ReactNode;
  placeholder?: string;
  value: string;
};

type SelectItemProps = { children: React.ReactNode; disabled?: boolean; value: string };

function SelectItem(_props: SelectItemProps) {
  return null;
}

function SelectContent({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function SelectTrigger({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function SelectValue() {
  return null;
}

function optionsFromChildren(children: React.ReactNode): SelectOption[] {
  const values: SelectOption[] = [];
  function visit(node: React.ReactNode) {
    React.Children.forEach(node, (child) => {
      if (!React.isValidElement(child)) return;
      if (child.type === SelectItem) {
        const props = child.props as SelectItemProps;
        values.push({ value: props.value, label: String(props.children), disabled: props.disabled });
        return;
      }
      visit((child.props as { children?: React.ReactNode }).children);
    });
  }
  visit(children);
  return values;
}

const Select = React.forwardRef<HTMLButtonElement, SelectProps>(
  ({ "aria-describedby": ariaDescribedBy, "aria-invalid": ariaInvalid, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, children, className, disabled, id, onValueChange, options: providedOptions, placeholder, value }, ref) => {
    const options = React.useMemo(
      () => providedOptions ?? optionsFromChildren(children),
      [children, providedOptions],
    );
    const [open, setOpen] = React.useState(false);
    const [present, setPresent] = React.useState(false);
    const [activeIndex, setActiveIndex] = React.useState(-1);
    const rootRef = React.useRef<HTMLDivElement>(null);
    const triggerRef = React.useRef<HTMLButtonElement | null>(null);
    const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
    const typeaheadRef = React.useRef({ text: "", timer: 0 });
    const listboxId = React.useId();
    const generatedTriggerId = React.useId();
    const triggerId = id ?? generatedTriggerId;
    const selected = options.find((option) => option.value === value);
    const label = selected?.label || placeholder || "";

    React.useEffect(() => {
      if (open) {
        setPresent(true);
        return undefined;
      }
      if (!present) return undefined;
      const timer = window.setTimeout(() => setPresent(false), 170);
      return () => window.clearTimeout(timer);
    }, [open, present]);

    React.useEffect(() => {
      if (!open) return undefined;

      const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
      const firstEnabledIndex = options.findIndex((option) => !option.disabled);
      const nextIndex = selectedIndex >= 0 ? selectedIndex : firstEnabledIndex;
      setActiveIndex(nextIndex);
      const focusFrame = window.requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus({ preventScroll: true }));

      function closeOnOutside(event: PointerEvent) {
        const path = event.composedPath();
        if (!rootRef.current || !path.includes(rootRef.current)) setOpen(false);
      }

      function closeOnEscape(event: KeyboardEvent) {
        if (event.key === "Escape") {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus({ preventScroll: true });
        }
      }

      document.addEventListener("pointerdown", closeOnOutside);
      document.addEventListener("keydown", closeOnEscape);
      return () => {
        window.cancelAnimationFrame(focusFrame);
        document.removeEventListener("pointerdown", closeOnOutside);
        document.removeEventListener("keydown", closeOnEscape);
      };
    }, [open, options, value]);

    React.useEffect(() => () => window.clearTimeout(typeaheadRef.current.timer), []);

    function selectOption(option: SelectOption) {
      if (option.disabled) return;
      onValueChange(option.value);
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    }

    function moveActive(direction: 1 | -1 | "first" | "last") {
      const enabled = options.map((option, index) => ({ option, index })).filter(({ option }) => !option.disabled);
      if (!enabled.length) return;
      const current = enabled.findIndex(({ index }) => index === activeIndex);
      const next = direction === "first"
        ? enabled[0]
        : direction === "last"
          ? enabled[enabled.length - 1]
          : enabled[(Math.max(current, 0) + direction + enabled.length) % enabled.length];
      setActiveIndex(next.index);
      optionRefs.current[next.index]?.focus({ preventScroll: true });
      optionRefs.current[next.index]?.scrollIntoView({ block: "nearest" });
    }

    function handleTypeahead(key: string) {
      if (key.length !== 1 || !/\S/.test(key)) return false;
      window.clearTimeout(typeaheadRef.current.timer);
      const text = `${typeaheadRef.current.text}${key}`.toLocaleLowerCase();
      typeaheadRef.current.text = text;
      typeaheadRef.current.timer = window.setTimeout(() => {
        typeaheadRef.current.text = "";
      }, 500);
      const match = options.findIndex((option) => !option.disabled && option.label.toLocaleLowerCase().startsWith(text));
      if (match < 0) return false;
      setActiveIndex(match);
      optionRefs.current[match]?.focus({ preventScroll: true });
      return true;
    }

    function handleOptionKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveActive(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveActive(-1);
      } else if (event.key === "Home") {
        event.preventDefault();
        moveActive("first");
      } else if (event.key === "End") {
        event.preventDefault();
        moveActive("last");
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectOption(options[index]);
      } else if (event.key === "Tab") {
        setOpen(false);
      } else if (handleTypeahead(event.key)) {
        event.preventDefault();
      }
    }

    return (
      <div
        className={cn("relative min-w-0", className)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}
        ref={rootRef}
      >
        <button
          aria-controls={listboxId}
          aria-describedby={ariaDescribedBy}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-invalid={ariaInvalid}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className={cn(
            "apple-control apple-pressable flex min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-[0.625rem] border border-input bg-[var(--control-bg)] px-3 py-2 text-left text-sm text-foreground shadow-[var(--control-shadow)] transition-[background-color,border-color,box-shadow,transform] duration-150",
            "hover:border-primary/45 hover:bg-[var(--control-hover-bg)] focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15",
            "disabled:cursor-not-allowed disabled:opacity-50",
            open && "border-primary/60 bg-[var(--control-selected-bg)] ring-2 ring-primary/15",
          )}
          disabled={disabled}
          id={triggerId}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setOpen(true);
            }
          }}
          ref={(node) => {
            triggerRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          type="button"
        >
          <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>{label}</span>
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180 text-primary")} />
        </button>

        {present ? (
          <div
            aria-hidden={!open || undefined}
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel ? undefined : (ariaLabelledBy ?? triggerId)}
            className="apple-popover apple-select-popover apple-material-popover absolute left-0 right-0 top-full z-50 mt-1.5 max-h-64 overflow-y-auto rounded-[0.875rem] border border-border/60 p-1.5 text-popover-foreground shadow-2xl"
            data-state={open ? "open" : "closed"}
            id={listboxId}
            role="listbox"
          >
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  aria-selected={active}
                  className={cn(
                    "apple-pressable flex min-h-9 w-full min-w-0 items-start gap-2 rounded-[0.625rem] px-2.5 py-2 text-left text-xs transition-[background-color,color,transform]",
                    active ? "bg-primary/10 text-primary" : "hover:bg-muted/70",
                    activeIndex === options.indexOf(option) && "ring-2 ring-primary/20",
                    option.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                  )}
                  disabled={option.disabled}
                  key={option.value}
                  onClick={() => selectOption(option)}
                  onFocus={() => setActiveIndex(options.indexOf(option))}
                  onKeyDown={(event) => handleOptionKeyDown(event, options.indexOf(option))}
                  ref={(node) => {
                    optionRefs.current[options.indexOf(option)] = node;
                  }}
                  role="option"
                  tabIndex={open && activeIndex === options.indexOf(option) ? 0 : -1}
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

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
