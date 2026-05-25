import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export type ConfirmDialogOptions = {
  cancelText: string;
  confirmText: string;
  description?: string;
  destructive?: boolean;
  title: string;
};

export type ConfirmFn = (options: ConfirmDialogOptions) => Promise<boolean>;

export function ConfirmDialog({
  onCancel,
  onConfirm,
  options,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  options: ConfirmDialogOptions | null;
}) {
  if (!options) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
      <button
        aria-label={options.cancelText}
        className="absolute inset-0 bg-background/60 backdrop-blur-[2px]"
        onClick={onCancel}
        type="button"
      />
      <form
        className="relative w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <p className="text-sm font-semibold">{options.title}</p>
        {options.description ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{options.description}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" type="button" onClick={onCancel}>
            {options.cancelText}
          </Button>
          <Button variant={options.destructive ? "destructive" : "default"} size="sm" type="submit">
            {options.confirmText}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function useConfirmDialog() {
  const [options, setOptions] = useState<ConfirmDialogOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  function close(value: boolean) {
    resolverRef.current?.(value);
    resolverRef.current = null;
    setOptions(null);
  }

  const confirm: ConfirmFn = (nextOptions) => {
    resolverRef.current?.(false);
    setOptions(nextOptions);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  };

  return {
    confirm,
    dialog: <ConfirmDialog options={options} onCancel={() => close(false)} onConfirm={() => close(true)} />,
  };
}
