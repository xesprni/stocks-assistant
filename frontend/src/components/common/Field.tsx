import { Children, cloneElement, isValidElement, useId } from "react";
import type { ElementType, ReactElement, ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FieldChildProps = {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-labelledby"?: string;
  children?: ReactNode;
  id?: string;
};

const LABELABLE_INTRINSIC_TYPES = new Set(["input", "select", "textarea"]);
const LABELABLE_COMPONENT_NAMES = new Set(["Input", "Select", "Switch", "Textarea"]);

function mergeIdRefs(...values: Array<string | undefined>) {
  const ids = values.flatMap((value) => value?.split(/\s+/).filter(Boolean) ?? []);
  return [...new Set(ids)].join(" ") || undefined;
}

function componentName(type: ElementType) {
  if (typeof type === "string") return type;
  const component = type as { displayName?: string; name?: string };
  return component.displayName ?? component.name ?? "";
}

function isLabelableControl(element: ReactElement<FieldChildProps>) {
  if (typeof element.type === "string") return LABELABLE_INTRINSIC_TYPES.has(element.type);
  return LABELABLE_COMPONENT_NAMES.has(componentName(element.type));
}

function findFirstControl(children: ReactNode): ReactElement<FieldChildProps> | null {
  let match: ReactElement<FieldChildProps> | null = null;
  Children.forEach(children, (child) => {
    if (match || !isValidElement<FieldChildProps>(child)) return;
    if (isLabelableControl(child)) {
      match = child;
      return;
    }
    match = findFirstControl(child.props.children);
  });
  return match;
}

function injectControlProps(
  children: ReactNode,
  target: ReactElement<FieldChildProps>,
  props: FieldChildProps,
): ReactNode {
  return Children.map(children, (child) => {
    if (!isValidElement<FieldChildProps>(child)) return child;
    if (child === target) return cloneElement(child, props);
    if (child.props.children === undefined) return child;
    return cloneElement(child, undefined, injectControlProps(child.props.children, target, props));
  });
}

export function Field({
  children,
  className,
  description,
  error,
  id,
  label,
}: {
  children: ReactNode;
  className?: string;
  description?: string;
  error?: string;
  id?: string;
  label: string;
}) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const labelId = `${fieldId}-label`;
  const descriptionId = description ? `${fieldId}-description` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = mergeIdRefs(descriptionId, errorId);
  const control = findFirstControl(children);
  const controlId = control?.props.id ?? id ?? generatedId;
  const content = control
    ? injectControlProps(children, control, {
      "aria-describedby": mergeIdRefs(control.props["aria-describedby"], describedBy),
      "aria-invalid": error ? true : control.props["aria-invalid"],
      "aria-labelledby": mergeIdRefs(labelId, control.props["aria-labelledby"]),
      id: controlId,
    })
    : children;

  return (
    <div
      aria-describedby={control ? undefined : describedBy}
      aria-invalid={control ? undefined : Boolean(error)}
      aria-labelledby={control ? undefined : labelId}
      className={cn("min-w-0 space-y-2", className)}
      role={control ? undefined : "group"}
    >
      {control ? (
        <Label htmlFor={controlId} id={labelId}>{label}</Label>
      ) : (
        <Label asChild>
          <span id={labelId}>{label}</span>
        </Label>
      )}
      {description ? <p className="text-xs leading-5 text-muted-foreground" id={descriptionId}>{description}</p> : null}
      {content}
      {error ? <p className="text-xs leading-5 text-destructive" id={errorId} role="alert">{error}</p> : null}
    </div>
  );
}
