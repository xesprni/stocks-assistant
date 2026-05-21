import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, Check, CircleDot, Copy, History, Loader2, MessageSquareText, Plus, Send, Square, Trash2, WandSparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatTemplate, i18n } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ChatHistoryState } from "@/hooks/useConversations";
import type { ChatMessage, ChatTraceEvent, Conversation } from "@/types/app";
import type { Page } from "@/types/ui";

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(e: ReactMouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API not available
    }
  }

  return (
    <button
      type="button"
      className={cn(
        "shrink-0 rounded-md p-1 text-current/60 transition-colors hover:bg-foreground/10 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={handleCopy}
      title={copied ? "已复制" : "复制"}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

function formatRelativeDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDate.getTime() === today.getTime()) return "今天";
  if (msgDate.getTime() === yesterday.getTime()) return "昨天";
  return "更早";
}

function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let nonAscii = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 127) nonAscii += 1;
  }
  const ascii = text.length - nonAscii;
  return Math.max(1, Math.ceil(nonAscii * 1.5 + ascii * 0.25) + 1);
}

function estimateMessageTokens(message: ChatMessage): number {
  return estimateTextTokens(message.content) + 4;
}

function recentContextMessages(messages: ChatMessage[], maxTurns: number): ChatMessage[] {
  if (maxTurns <= 0) return messages;

  let userTurns = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      userTurns += 1;
      if (userTurns >= maxTurns) {
        return messages.slice(index);
      }
    }
  }

  return messages;
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)));
}

function ContextUsageRing({
  copy,
  total,
  used,
}: {
  copy: {
    contextUsage: string;
    contextUsed: string;
    contextTotal: string;
    contextTokens: string;
  };
  total: number;
  used: number;
}) {
  const safeTotal = Math.max(1, total);
  const ratio = total > 0 ? Math.min(1, Math.max(0, used / safeTotal)) : 0;
  const percent = Math.round(ratio * 100);
  const degrees = Math.round(ratio * 360);
  const fill = percent >= 90 ? "hsl(var(--destructive))" : percent >= 70 ? "hsl(var(--secondary))" : "hsl(var(--primary))";
  const style = {
    background: `conic-gradient(${fill} ${degrees}deg, hsl(var(--muted)) ${degrees}deg 360deg)`,
  } satisfies CSSProperties;
  const label = `${copy.contextUsage}: ${formatTokenCount(used)} / ${formatTokenCount(total)} ${copy.contextTokens}`;

  return (
    <div className="group/context relative shrink-0" title={label}>
      <div
        aria-label={label}
        aria-valuemax={Math.max(0, total)}
        aria-valuemin={0}
        aria-valuenow={Math.min(Math.max(0, used), Math.max(0, total))}
        className="grid size-10 place-items-center rounded-full border border-border/80 shadow-sm outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring group-hover/context:scale-[1.03]"
        role="meter"
        style={style}
        tabIndex={0}
      >
        <div className="grid size-7 place-items-center rounded-full bg-background text-[10px] font-semibold tabular-nums text-foreground">
          {percent}%
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-[calc(100%+0.55rem)] right-0 z-50 min-w-[188px] rounded-md border border-border/90 bg-popover/95 px-3 py-2 text-xs text-popover-foreground opacity-0 shadow-2xl backdrop-blur transition-opacity group-hover/context:opacity-100 group-focus-within/context:opacity-100">
        <p className="mb-1 font-semibold">{copy.contextUsage}</p>
        <div className="flex items-center justify-between gap-4 text-muted-foreground">
          <span>{copy.contextUsed}</span>
          <span className="font-medium tabular-nums text-foreground">{formatTokenCount(used)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-4 text-muted-foreground">
          <span>{copy.contextTotal}</span>
          <span className="font-medium tabular-nums text-foreground">{formatTokenCount(total)}</span>
        </div>
      </div>
    </div>
  );
}


function TraceIcon({ status }: { status: ChatTraceEvent["status"] }) {
  if (status === "running") return <Loader2 className="size-3 animate-spin text-primary" />;
  if (status === "done") return <Check className="size-3 text-emerald-500" />;
  if (status === "error") return <X className="size-3 text-destructive" />;
  return <CircleDot className="size-3 text-muted-foreground" />;
}

function ChatTraceList({ trace }: { trace?: ChatTraceEvent[] }) {
  if (!trace?.length) return null;

  return (
    <div className="mb-3 space-y-1 rounded-md border border-border/80 bg-background/70 px-2.5 py-2 text-xs text-muted-foreground shadow-sm">
      {trace.map((item) => (
        <div className="flex min-w-0 items-start gap-2" key={item.id}>
          <span className="mt-1 shrink-0">
            <TraceIcon status={item.status} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-medium text-foreground/85">{item.label}</span>
              <span className="text-[10px] text-muted-foreground/80">{item.createdAt}</span>
            </div>
            {item.detail ? <p className="mt-0.5 break-words text-[11px] leading-4">{item.detail}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}


export function ChatPage({
  chatScrollRef,
  endRef,
  handleSend,
  handleChatScroll,
  handleStopStreaming,
  isSending,
  language,
  messages,
  prompt,
  quickPrompts,
  chatHistory,
  contextTokenLimit,
  contextTurnLimit,
  setPage,
  setPrompt,
}: {
  chatScrollRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
  handleSend: (event?: { preventDefault: () => void }, value?: string) => void;
  handleChatScroll: () => void;
  handleStopStreaming: () => void;
  isSending: boolean;
  language: AppLanguage;
  messages: ChatMessage[];
  prompt: string;
  quickPrompts: string[];
  chatHistory: ChatHistoryState;
  contextTokenLimit: number;
  contextTurnLimit: number;
  setPage: (page: Page) => void;
  setPrompt: (value: string) => void;
}) {
  const { conversations, activeId, createConversation, switchConversation, deleteConversation, clearMessages } = chatHistory;
  const chatCopy = i18n[language].chat;
  const common = i18n[language].common;
  const uiCopy = i18n[language].chatUi;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [promptDockOpen, setPromptDockOpen] = useState(false);
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const promptDockRef = useRef<HTMLDivElement | null>(null);
  const contextUsage = useMemo(() => {
    const windowMessages = recentContextMessages(messages, contextTurnLimit);
    const messageTokens = windowMessages.reduce((total, message) => total + estimateMessageTokens(message), 0);
    const draftTokens = prompt.trim() ? estimateTextTokens(prompt) + 4 : 0;
    return {
      total: Math.max(0, contextTokenLimit),
      used: Math.max(0, Math.round(messageTokens + draftTokens)),
    };
  }, [contextTokenLimit, contextTurnLimit, messages, prompt]);

  const grouped = useMemo(() => {
    const groups: Record<string, Conversation[]> = {};
    for (const c of conversations) {
      const label = formatRelativeDate(c.updatedAt);
      (groups[label] ??= []).push(c);
    }
    return groups;
  }, [conversations]);

  useEffect(() => {
    function closeFloatingPanels(event: globalThis.MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (historyMenuRef.current && !historyMenuRef.current.contains(target)) {
        setHistoryOpen(false);
      }
      if (promptDockRef.current && !promptDockRef.current.contains(target)) {
        setPromptDockOpen(false);
      }
    }

    document.addEventListener("mousedown", closeFloatingPanels);
    return () => document.removeEventListener("mousedown", closeFloatingPanels);
  }, []);

  function handleNew() {
    createConversation().catch(() => {
      // 新建失败时保留当前会话。
    });
  }

  return (
    <div className="page-enter flex h-full min-h-0 flex-1 overflow-hidden">
      <section className="panel motion-panel flex min-h-0 min-w-0 flex-1 flex-col rounded-lg">
        <div className="panel-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-md border border-primary/25 bg-primary/10 text-primary">
                <Bot className="size-4" />
              </span>
              <p className="font-semibold">Agent Chat</p>
            </div>
            <p className="text-xs text-muted-foreground">{uiCopy.endpoint}</p>
          </div>
          <div className="flex gap-2">
            <Button
              aria-label="新建对话"
              variant="outline"
              size="sm"
              onClick={handleNew}
              type="button"
            >
              <Plus />
              {common.newChat}
            </Button>
            <div className="relative" ref={historyMenuRef}>
              <Button
                aria-expanded={historyOpen}
                aria-haspopup="menu"
                variant="outline"
                size="sm"
                onClick={() => setHistoryOpen((current) => !current)}
                type="button"
              >
                <History />
                {common.history}
              </Button>
              {historyOpen ? (
                <div className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-[320px] max-w-[calc(100vw-2rem)] rounded-lg border border-border/90 bg-popover/95 p-2 shadow-2xl backdrop-blur">
                  <div className="mb-2 px-1">
                    <div>
                      <p className="text-xs font-semibold">{common.history}</p>
                      <p className="text-[10px] text-muted-foreground">{formatTemplate(uiCopy.sessions, { count: conversations.length })}</p>
                    </div>
                  </div>
                  <div className="max-h-[360px] overflow-y-auto">
                    {Object.entries(grouped).map(([label, convs]) => (
                      <div key={label} className="mb-1 last:mb-0">
                        <p className="px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">{label}</p>
                        {convs.map((c) => (
                          <div
                            key={c.id}
                            className={cn(
                              "group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              activeId === c.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                            )}
                            onClick={() => {
                              switchConversation(c.id);
                              setHistoryOpen(false);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              switchConversation(c.id);
                              setHistoryOpen(false);
                            }}
                            role="button"
                            tabIndex={0}
                          >
                            <MessageSquareText className="size-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">{c.title}</span>
                            <button
                              aria-label={uiCopy.deleteConversation}
                              className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                              onClick={(event) => {
                                event.stopPropagation();
                                deleteConversation(c.id);
                              }}
                              title={uiCopy.deleteConversation}
                              type="button"
                            >
                              <X className="size-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                    {conversations.length === 0 ? (
                      <div className="px-2 py-6 text-center text-xs text-muted-foreground">{uiCopy.emptyHistory}</div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            <Button aria-label={common.clear} variant="outline" size="sm" onClick={() => { if (activeId) clearMessages(activeId); }}>
              <Trash2 />
              {common.clear}
            </Button>
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4"
          onScroll={handleChatScroll}
          ref={chatScrollRef}
        >
          <div className="mr-auto w-full space-y-4">
            {messages.map((message) => (
              <div className={cn("group flex min-w-0 gap-2 sm:gap-3", message.role === "user" ? "justify-end" : "justify-start")} key={message.id}>
                {message.role === "assistant" ? (
                  <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-md border border-primary/25 bg-primary/10 text-primary shadow-sm">
                    {message.pending ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                  </div>
                ) : null}
                <div
                  className={cn(
                    "message-bubble min-w-0 max-w-[92%] rounded-lg border px-3.5 py-3 shadow-sm sm:max-w-[84%] sm:px-4 sm:py-3.5 xl:max-w-[78%]",
                    message.role === "user"
                      ? "chat-bubble-user"
                      : "chat-bubble-assistant",
                  )}
                >
                  {message.role === "assistant" ? <ChatTraceList trace={message.trace} /> : null}
                  {message.role === "assistant" && message.pending && message.status ? (
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Loader2 className="size-3 animate-spin text-primary" />
                      <span>{message.status}</span>
                    </div>
                  ) : null}
                  {message.pending && message.status && message.content === message.status ? null : (
                    <div className="chat-message-content prose prose-sm dark:prose-invert max-w-none break-words prose-headings:my-2 prose-p:my-1 prose-p:text-inherit prose-pre:my-2 prose-pre:rounded-md prose-code:text-primary prose-strong:text-inherit prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-li:text-inherit prose-table:my-2">
                      {message.role === "assistant" ? (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>
                  )}
                  <div
                    className={cn(
                      "mt-2 flex items-center gap-1.5",
                      message.role === "user" ? "text-current/70" : "text-muted-foreground",
                    )}
                  >
                    <span className="text-[11px]">{message.createdAt}</span>
                    <CopyButton
                      text={message.content}
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </div>
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        <form className="border-t border-border/80 bg-card/35 px-3 py-3 sm:px-4" onSubmit={handleSend}>
          <div className="mr-auto flex w-full items-end gap-2 rounded-lg border border-border/80 bg-background/90 p-2 shadow-sm transition-all focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/20">
            <div className="relative shrink-0" ref={promptDockRef}>
              <Button
                aria-expanded={promptDockOpen}
                aria-haspopup="menu"
                aria-label={uiCopy.promptDock}
                className="h-10 w-10 rounded-md border-border/80 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setPromptDockOpen((current) => !current)}
                type="button"
                variant="outline"
              >
                <WandSparkles />
              </Button>
              {promptDockOpen ? (
                <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-40 w-[340px] max-w-[calc(100vw-2rem)] rounded-lg border border-border/90 bg-popover/95 p-2 shadow-2xl backdrop-blur">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <WandSparkles className="size-4 text-secondary" />
                    <div>
                      <p className="text-xs font-semibold">{uiCopy.promptDock}</p>
                      <p className="text-[10px] text-muted-foreground">{uiCopy.quickInput}</p>
                    </div>
                  </div>
                  <div className="max-h-[300px] space-y-1 overflow-y-auto">
                    {quickPrompts.map((item) => (
                      <button
                        className="w-full rounded-md border border-border/80 bg-background/70 px-2.5 py-2 text-left text-xs leading-5 text-muted-foreground shadow-sm transition-colors hover:border-primary/50 hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        key={item}
                        onClick={() => {
                          setPrompt(item);
                          setPage("chat");
                          setPromptDockOpen(false);
                        }}
                        type="button"
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <Textarea
              className="max-h-[160px] min-h-10 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[15px] leading-6 shadow-none focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0"
              disabled={isSending}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  handleSend(event);
                }
              }}
              placeholder={uiCopy.promptPlaceholder}
              value={prompt}
            />
            <ContextUsageRing copy={uiCopy} total={contextUsage.total} used={contextUsage.used} />
            {isSending ? (
              <Button className="h-10 w-10 shrink-0 rounded-md sm:w-auto sm:px-4" onClick={handleStopStreaming} type="button" variant="destructive">
                <Square className="fill-current" />
                <span className="hidden sm:inline">{chatCopy.stop}</span>
              </Button>
            ) : (
              <Button className="h-10 w-10 shrink-0 rounded-md sm:w-auto sm:px-4" disabled={!prompt.trim()} type="submit">
                <Send />
                <span className="hidden sm:inline">{common.send}</span>
              </Button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
