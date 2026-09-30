import type { AppLanguage } from "@/i18n";
import { getMessages } from "@/i18n";
import type { ChatMessage } from "@/types/app";
import {
  ExternalLink
} from "lucide-react";

export function ChatSources({ message, language }: { message: ChatMessage; language: AppLanguage }) {
  if (!message.sources?.length) return null;
  return (
    <div className="not-prose mt-3 border-t border-border/60 pt-2.5">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {getMessages(language).chat.sources}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {message.sources.map((source) => {
          const content = (
            <>
              <span className="max-w-[260px] truncate">{source.title}</span>
              {source.locator ? <span className="text-muted-foreground">· {source.locator}</span> : null}
              {source.stale ? <span className="text-amber-600 dark:text-amber-300">STALE</span> : null}
              {source.url ? <ExternalLink className="size-3" /> : null}
            </>
          );
          const className = "inline-flex min-h-7 items-center gap-1 rounded-md border border-border/75 bg-background/70 px-2 py-1 text-[11px] text-foreground transition-colors hover:border-primary/45 hover:bg-primary/5";
          return (
            <span className="inline-flex items-center gap-1" key={source.id}>
              {source.url ? (
                <a className={className} href={source.url} rel="noreferrer" target="_blank" title={`${source.provider} · ${source.as_of || source.fetched_at}`}>{content}</a>
              ) : (
                <span className={className} title={`${source.provider} · ${source.as_of || source.fetched_at}`}>{content}</span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
