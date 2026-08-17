import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import { useDialogFocus } from "@/hooks/useDialogFocus";

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
  const [renderedOptions, setRenderedOptions] = useState(options);
  const [visible, setVisible] = useState(Boolean(options));
  const formRef = useRef<HTMLFormElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (options) {
      setRenderedOptions(options);
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }
    if (!renderedOptions) return undefined;
    setVisible(false);
    const timer = window.setTimeout(() => setRenderedOptions(null), 230);
    return () => window.clearTimeout(timer);
  }, [options, renderedOptions]);

  const initialFocusRef = renderedOptions?.destructive ? cancelRef : confirmRef;
  useDialogFocus(Boolean(renderedOptions), formRef, () => {
    if (visible) onCancel();
  }, initialFocusRef);

  if (!renderedOptions || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="apple-dialog-layer fixed inset-0 z-[1100] flex items-center justify-center px-4"
      data-state={visible ? "open" : "closed"}
    >
      <div
        aria-hidden="true"
        className="apple-dialog-backdrop absolute inset-0"
        onClick={() => {
          if (visible) onCancel();
        }}
      />
      <form
        aria-describedby={renderedOptions.description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="apple-dialog-surface apple-material-thick relative w-full max-w-sm rounded-[1.375rem] border border-border/60 p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
        ref={formRef}
        role="alertdialog"
        tabIndex={-1}
      >
        <h2 className="text-[1.05rem] font-semibold leading-6 tracking-[-0.012em]" id={titleId}>{renderedOptions.title}</h2>
        {renderedOptions.description ? (
          <p className="mt-2 text-sm leading-5 text-muted-foreground" id={descriptionId}>{renderedOptions.description}</p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button ref={cancelRef} variant="outline" type="button" onClick={onCancel}>
            {renderedOptions.cancelText}
          </Button>
          <Button ref={confirmRef} variant={renderedOptions.destructive ? "destructive" : "default"} type="submit">
            {renderedOptions.confirmText}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
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
