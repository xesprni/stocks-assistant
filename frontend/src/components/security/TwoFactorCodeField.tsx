import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTemplate } from "@/i18n";
import { useI18n } from "@/i18n/react";
import { isCompleteTwoFactorInput, type TwoFactorInput } from "./two-factor-utils";

const DIGIT_COUNT = 6;

export function TwoFactorCodeField({ value, onChange, onComplete, disabled, setup = false, autoFocus = false }: {
  value: TwoFactorInput;
  onChange: (value: TwoFactorInput) => void;
  onComplete?: (value: TwoFactorInput) => void;
  disabled?: boolean;
  setup?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const { messages } = useI18n();
  const copy = messages.twoFactor;
  const digits = useRef<(HTMLInputElement | null)[]>([]);
  const recoveryInput = useRef<HTMLInputElement>(null);
  const previousMethod = useRef(value.method);
  const recovery = !setup && value.method === "recovery";

  useEffect(() => {
    if (previousMethod.current !== value.method) {
      (recovery ? recoveryInput.current : digits.current[0])?.focus();
      previousMethod.current = value.method;
    }
  }, [value.method, recovery]);

  function focusDigit(index: number) {
    digits.current[Math.max(0, Math.min(index, DIGIT_COUNT - 1))]?.focus();
  }

  function writeDigits(index: number, text: string) {
    if (disabled || !/^[0-9\s]*$/.test(text)) return;
    const input = text.replace(/\s/g, "");
    if (input.length > DIGIT_COUNT) return;
    // 保留中间被删除的位置，避免后续数字左移；完整粘贴或系统自动填充替换整组。
    const slots = value.code.padEnd(DIGIT_COUNT, " ").split("");
    const start = input.length === DIGIT_COUNT ? 0 : index;
    if (start + input.length > DIGIT_COUNT) return;
    if (input) Array.from(input).forEach((digit, offset) => { slots[start + offset] = digit; });
    else slots[index] = " ";
    const next: TwoFactorInput = { method: "totp", code: slots.join("").trimEnd() };
    onChange(next);
    if (input) focusDigit(start + input.length);
    // 仅由用户输入事件触发，直接传递最新值，避免 React 更新时序或 StrictMode 重复提交。
    if (next.code !== value.code && isCompleteTwoFactorInput(next)) onComplete?.(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      focusDigit(index + (event.key === "ArrowLeft" ? -1 : 1));
    } else if (event.key === "Backspace" && !value.code[index]?.trim() && index > 0) {
      event.preventDefault();
      writeDigits(index - 1, "");
      focusDigit(index - 1);
    }
  }

  return <div className="space-y-3">
    {recovery ? <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={`${id}-recovery`}>{copy.recoveryLabel}</label>
      <Input ref={recoveryInput} id={`${id}-recovery`} name="recovery-code" autoComplete="off"
        inputMode="text" autoCapitalize="none" spellCheck={false} maxLength={32} required
        aria-describedby={`${id}-hint`} disabled={disabled} value={value.code}
        onChange={(event) => onChange({ method: "recovery", code: event.target.value })} />
    </div> : <fieldset className="min-w-0 space-y-2" aria-describedby={`${id}-hint`}>
      <legend className="text-sm font-medium">{copy.totpLabel}</legend>
      <div className="grid max-w-80 grid-cols-6 gap-1.5 sm:gap-2" dir="ltr">
        {Array.from({ length: DIGIT_COUNT }, (_, index) => <Input
          key={index} ref={(element) => { digits.current[index] = element; }}
          aria-label={formatTemplate(copy.digitLabel, { position: index + 1 })}
          name={`two-factor-digit-${index + 1}`} autoFocus={autoFocus && index === 0}
          autoComplete={index === 0 ? "one-time-code" : "off"} inputMode="numeric"
          autoCapitalize="none" spellCheck={false} maxLength={DIGIT_COUNT} pattern="[0-9]" required
          className="aspect-square min-h-0 min-w-0 px-0 py-0 text-center text-xl font-medium tabular-nums"
          disabled={disabled} value={value.code[index]?.trim() ?? ""}
          onFocus={(event) => event.target.select()}
          onChange={(event) => writeDigits(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          onPaste={(event) => { event.preventDefault(); writeDigits(index, event.clipboardData.getData("text")); }}
        />)}
      </div>
    </fieldset>}
    <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
      {recovery ? copy.recoveryInputHint : onComplete ? copy.autoSubmitHint : copy.codeHint}
    </p>
    {!setup && <Button type="button" variant="link" size="sm" className="h-auto px-0 py-1"
      disabled={disabled} onClick={() => onChange({ method: recovery ? "totp" : "recovery", code: "" })}>
      {recovery ? copy.useAuthenticator : copy.useRecovery}
    </Button>}
  </div>;
}
