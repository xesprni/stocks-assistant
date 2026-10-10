import { ChevronDown, CircleAlert } from "lucide-react";
import { formatTemplate, getMessages, type AppLanguage } from "@/i18n";
import { optionDiagnosticText } from "@/lib/earnings-radar-presentation";
import type { EarningsRadarItem } from "@/types/earnings";

export function EarningsDataNotes({ item, language }: { item: EarningsRadarItem; language: AppLanguage }) {
  const copy = getMessages(language).earnings;
  if (!item.issues.length && !item.option_diagnostics?.length) return null;
  // 优先展示影响定价的提示，其余原因与原始错误码仍可展开查看。
  const primaryIssue = item.issues.find((issue) => issue.startsWith("options_")) ?? item.issues[0];
  return <details className="earnings-data-notes">
    <summary>
      <CircleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium">
          {copy.dataNotes}<span className="text-[11px] font-normal text-muted-foreground">
            {formatTemplate(copy.noteCount, { count: item.issues.length || item.option_diagnostics?.length || 0 })}
          </span>
        </span>
        {primaryIssue && <span className="mt-1 block text-[11px] leading-5 text-muted-foreground">
          {copy.issues[primaryIssue as keyof typeof copy.issues] ?? primaryIssue}
        </span>}
      </span>
      <ChevronDown className="earnings-disclosure-icon size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </summary>
    <div className="earnings-notes-body">
      <ul className="space-y-2 text-xs leading-5 text-muted-foreground">
        {item.issues.map((issue) => <li className="flex gap-2" key={issue}>
          <span className="mt-2 size-1 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
          <span>{copy.issues[issue as keyof typeof copy.issues] ?? issue}</span>
        </li>)}
      </ul>
      {!!item.option_diagnostics?.length && <div className="mt-4 border-t border-border/60 pt-3">
        <h4 className="text-xs font-medium">{copy.optionDiagnostics}</h4>
        <ul className="mt-2 space-y-2 break-words text-[11px] leading-5 text-muted-foreground">
          {item.option_diagnostics.map((diagnostic, index) => <li key={index}>{optionDiagnosticText(diagnostic, language)}</li>)}
        </ul>
      </div>}
    </div>
  </details>;
}
