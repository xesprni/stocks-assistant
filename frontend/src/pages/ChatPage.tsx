import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
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
        "shrink-0 rounded p-1 text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground",
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


function TraceIcon({ status }: { status: ChatTraceEvent["status"] }) {
  if (status === "running") return <Loader2 className="size-3 animate-spin text-primary" />;
  if (status === "done") return <Check className="size-3 text-emerald-500" />;
  if (status === "error") return <X className="size-3 text-destructive" />;
  return <CircleDot className="size-3 text-muted-foreground" />;
}

function ChatTraceList({ trace }: { trace?: ChatTraceEvent[] }) {
  if (!trace?.length) return null;

  return (
    <div className="mb-3 space-y-1 rounded-md border border-border/70 bg-muted/25 px-2.5 py-2 text-xs text-muted-foreground">
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
      <section className="panel motion-panel flex min-h-0 min-w-0 flex-1 flex-col rounded-md">
        <div className="panel-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Bot className="size-5 text-primary" />
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
                <div className="absolute right-0 top-[calc(100%+0.5rem)] z-40 w-[320px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-2 shadow-xl">
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
                              "group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                              activeId === c.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
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
          <div className="space-y-4">
            {messages.map((message) => (
              <div className={cn("group flex gap-2 sm:gap-3", message.role === "user" ? "justify-end" : "justify-start")} key={message.id}>
                {message.role === "assistant" ? (
                  <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                    {message.pending ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                  </div>
                ) : null}
                <div
                  className={cn(
                    "message-bubble max-w-[min(760px,92%)] rounded-lg border px-3 py-2.5 text-sm leading-6 shadow-sm sm:px-4 sm:py-3",
                    message.role === "user"
                      ? "border-primary/50 bg-primary text-primary-foreground"
                      : "border-border/80 bg-background/60 text-foreground",
                  )}
                >
                  {message.role === "assistant" ? <ChatTraceList trace={message.trace} /> : null}
                  {message.role === "assistant" && message.pending && message.status ? (
                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin text-primary" />
                      <span>{message.status}</span>
                    </div>
                  ) : null}
                  {message.pending && message.status && message.content === message.status ? null : (
                    <div className="prose prose-sm dark:prose-invert max-w-none break-words prose-p:my-1 prose-pre:my-2 prose-pre:rounded-md prose-pre:bg-muted/40 prose-code:text-primary prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-table:my-2">
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
                      message.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground",
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

        <form className="border-t border-border/80 bg-muted/20 px-3 py-2.5 sm:px-4" onSubmit={handleSend}>
          <div className="mx-auto flex max-w-5xl items-end gap-2 rounded-2xl border border-border/80 bg-background/85 p-2 shadow-sm">
            <div className="relative shrink-0" ref={promptDockRef}>
              <Button
                aria-expanded={promptDockOpen}
                aria-haspopup="menu"
                aria-label={uiCopy.promptDock}
                className="h-10 w-10 rounded-full border-border/80 bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setPromptDockOpen((current) => !current)}
                type="button"
                variant="outline"
              >
                <WandSparkles />
              </Button>
              {promptDockOpen ? (
                <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-40 w-[340px] max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-2 shadow-xl">
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
                        className="w-full rounded-md border border-border/80 bg-background/50 px-2.5 py-2 text-left text-xs leading-5 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
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
              className="max-h-[160px] min-h-10 min-w-0 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0"
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
            {isSending ? (
              <Button className="h-10 w-10 shrink-0 rounded-full sm:w-auto sm:px-4" onClick={handleStopStreaming} type="button" variant="destructive">
                <Square className="fill-current" />
                <span className="hidden sm:inline">{chatCopy.stop}</span>
              </Button>
            ) : (
              <Button className="h-10 w-10 shrink-0 rounded-full sm:w-auto sm:px-4" disabled={!prompt.trim()} type="submit">
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
