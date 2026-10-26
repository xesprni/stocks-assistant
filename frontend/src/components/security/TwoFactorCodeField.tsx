import { useId } from "react";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/i18n/react";

export function TwoFactorCodeField({ value, onChange, disabled, setup = false, autoFocus = false }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  setup?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const { messages } = useI18n();
  const copy = messages.twoFactor;
  return <div className="space-y-2">
    <label className="text-sm font-medium" htmlFor={id}>{setup ? copy.totpLabel : copy.codeLabel}</label>
    <Input id={id} name="two-factor-code" autoFocus={autoFocus} autoComplete="one-time-code"
      inputMode={setup ? "numeric" : "text"} autoCapitalize="none" spellCheck={false}
      maxLength={setup ? 6 : 32} pattern={setup ? "[0-9]{6}" : undefined} required
      aria-describedby={setup ? undefined : `${id}-hint`} disabled={disabled} value={value}
      onChange={(event) => onChange(event.target.value)} />
    {!setup && <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">{copy.codeHint}</p>}
  </div>;
}
