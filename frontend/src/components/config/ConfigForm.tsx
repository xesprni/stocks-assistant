import type { ComponentProps, ReactNode } from "react";
import { Check } from "lucide-react";

import { Field } from "@/components/common/Field";
import { cn } from "@/lib/utils";

import "./config-form.css";

export function ConfigField({ className, ...props }: ComponentProps<typeof Field>) {
  return <Field {...props} className={cn("config-field space-y-0", className)} />;
}

export function ConfigChoiceCard({
  description,
  disabled,
  icon,
  label,
  onSelect,
  selected,
}: {
  description: string;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-pressed={selected}
      className="config-choice-card"
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span aria-hidden="true" className="config-choice-card-icon">{icon}</span>
      <span className="config-choice-card-content">
        <span className="config-choice-card-label">{label}</span>
        <span className="config-choice-card-description">{description}</span>
      </span>
      <span aria-hidden="true" className="config-choice-card-indicator">
        {selected ? <Check /> : null}
      </span>
    </button>
  );
}

export function ConfigSegmentedControl<T extends string>({
  onValueChange,
  options,
  value,
}: {
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  value: T;
}) {
  return (
    <div className="config-segmented-control">
      {options.map((option) => (
        <button
          aria-pressed={value === option.value}
          key={option.value}
          onClick={() => onValueChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
