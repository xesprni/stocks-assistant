import { X } from "lucide-react";
import { formatTemplate, getMessages, type AppLanguage } from "@/i18n";
import { RADAR_MAX_SYMBOLS } from "@/lib/earnings-radar-controller";

interface EarningsSymbolInputProps {
  language: AppLanguage;
  symbols: string[];
  draft: string;
  disabled: boolean;
  invalid: boolean;
  count: number;
  onDraftChange: (value: string) => void;
  onCommit: (value: string) => void;
  onRemove: (symbol: string) => void;
}

export function EarningsSymbolInput({ language, symbols, draft, disabled, invalid, count, onDraftChange, onCommit, onRemove }: EarningsSymbolInputProps) {
  const copy = getMessages(language).earnings;
  return <div className="earnings-symbol-field" data-disabled={disabled} data-invalid={invalid}>
    <label htmlFor="radar-symbols" className="earnings-market-label" title={copy.symbols}>US<span className="sr-only"> {copy.symbols}</span></label>
    <div className="earnings-symbol-tokens">
      {symbols.map((symbol) => <span className="earnings-symbol-token" key={symbol}>
        <span>{symbol.replace(/\.US$/, "")}</span>
        <button type="button" disabled={disabled} aria-label={formatTemplate(copy.removeSymbol, { symbol })}
          onClick={() => onRemove(symbol)}><X className="size-3" aria-hidden="true" /></button>
      </span>)}
      <input id="radar-symbols" className="earnings-symbol-entry" value={draft} disabled={disabled}
        aria-label={copy.symbols} aria-invalid={invalid} aria-describedby={invalid ? "radar-validation" : "radar-input-hint"}
        autoComplete="off" autoCapitalize="characters" spellCheck={false}
        placeholder={symbols.length ? copy.addSymbol : copy.symbolEntry}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (["Enter", ",", "，", ";", "；", " "].includes(event.key) && draft.trim()) {
            event.preventDefault();
            onCommit(draft);
          } else if (event.key === "Backspace" && !draft && symbols.length) {
            event.preventDefault();
            onRemove(symbols[symbols.length - 1]);
          }
        }}
        onPaste={(event) => {
          // 保留多行粘贴的分隔符；原生单行输入会先吞掉换行并拼接代码。
          const pasted = event.clipboardData.getData("text");
          if (!pasted) return;
          event.preventDefault();
          const input = event.currentTarget;
          onCommit(draft.slice(0, input.selectionStart ?? draft.length) + pasted + draft.slice(input.selectionEnd ?? draft.length));
        }} />
    </div>
    <span className="earnings-input-count" aria-hidden="true">{count}<span> / {RADAR_MAX_SYMBOLS}</span></span>
  </div>;
}
