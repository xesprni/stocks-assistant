import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent, RefObject } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  Check,
  CircleDot,
  Copy,
  History,
  Loader2,
  Maximize2,
  MessageSquareText,
  PencilLine,
  Plus,
  Search,
  Send,
  Square,
  Trash2,
  TrendingUp,
  WandSparkles,
  X,
} from "lucide-react";

import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatTemplate, i18n } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ChatHistoryState } from "@/hooks/useConversations";
import type { ChatMessage, ChatTraceEvent, Conversation } from "@/types/app";

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
  confirmAction,
  endRef,
  handleSend,
  handleChatScroll,
  handleStopStreaming,
  isSending,
  language,
  displayName,
  messages,
  mobileNavVisible = true,
  prompt,
  quickPrompts,
  chatHistory,
  setPrompt,
}: {
  chatScrollRef: RefObject<HTMLDivElement | null>;
  confirmAction: ConfirmFn;
  endRef: RefObject<HTMLDivElement | null>;
  handleSend: (event?: { preventDefault: () => void }, value?: string, options?: { forceNewSession?: boolean; newSession?: boolean }) => void;
  handleChatScroll: () => void;
  handleStopStreaming: () => void;
  isSending: boolean;
  language: AppLanguage;
  displayName?: string;
  messages: ChatMessage[];
  mobileNavVisible?: boolean;
  prompt: string;
  quickPrompts: string[];
  chatHistory: ChatHistoryState;
  setPrompt: (value: string) => void;
}) {
  const { conversations, activeId, createConversation, switchConversation, deleteConversation, clearMessages, clearAllConversations } = chatHistory;
  const chatCopy = i18n[language].chat;
  const common = i18n[language].common;
  const uiCopy = i18n[language].chatUi;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mobileComposerOpen, setMobileComposerOpen] = useState(false);
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const openComposerLabel = language === "en" ? "Open question input" : "打开提问输入框";
  const closeComposerLabel = language === "en" ? "Close input" : "关闭输入框";
  const isNewConversation = messages.length === 0 && !isSending;
  const greeting = displayName
    ? formatTemplate(uiCopy.greeting, { name: displayName })
    : uiCopy.greetingAnonymous;
  const suggestionPrompts = quickPrompts.slice(0, 3);
  const explorePrompts = [
    { icon: <Search className="size-5" />, label: uiCopy.exploreDeepSearch, prompt: uiCopy.exploreDeepSearch },
    { icon: <TrendingUp className="size-5" />, label: uiCopy.exploreWatchlist, prompt: language === "en" ? "Analyze my watchlist" : "分析我的监控列表" },
    { icon: <WandSparkles className="size-5" />, label: uiCopy.exploreAnything, prompt: uiCopy.exploreAnything },
  ];

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
    }

    document.addEventListener("mousedown", closeFloatingPanels);
    return () => document.removeEventListener("mousedown", closeFloatingPanels);
  }, []);

  useEffect(() => {
    if (prompt.trim()) {
      setMobileComposerOpen(true);
    }
  }, [prompt]);

  function handleNew() {
    createConversation().catch(() => {
      // 新建失败时保留当前会话。
    });
  }

  async function handleClearAllHistory() {
    const confirmed = await confirmAction({
      cancelText: common.cancel,
      confirmText: common.clear,
      description: uiCopy.clearAllHistoryConfirmDescription,
      destructive: true,
      title: uiCopy.clearAllHistory,
    });
    if (!confirmed) return;
    clearAllConversations();
    setHistoryOpen(false);
  }

  function closeMobileComposer() {
    setMobileComposerOpen(false);
  }

  function handleComposerSubmit(event: FormEvent<HTMLFormElement>) {
    const shouldClose = Boolean(prompt.trim()) && !isSending;
    handleSend(event);
    if (shouldClose) {
      closeMobileComposer();
    }
  }

  function handleToggleFullscreen() {
    const root = document.documentElement;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {
        // Ignore browsers that block programmatic fullscreen exit.
      });
      return;
    }
    root.requestFullscreen?.().catch(() => {
      // Fullscreen is a convenience action and can be blocked by the browser.
    });
  }

  function applyPrompt(value: string) {
    setPrompt(value);
  }

  function renderComposer(mode: "desktop" | "mobile") {
    const isMobile = mode === "mobile";
    const largeComposer = isNewConversation;

    return (
      <form
        className={cn(
          isMobile
            ? "absolute inset-x-2 rounded-[30px] border border-border/80 bg-card/95 p-2.5 shadow-2xl backdrop-blur"
            : "hidden bg-transparent px-3 pb-4 pt-1 sm:px-4 lg:block",
          isMobile && (mobileNavVisible ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))]" : "bottom-[calc(0.75rem+env(safe-area-inset-bottom))]"),
        )}
        onSubmit={handleComposerSubmit}
      >
        <div
          className={cn(
            "mr-auto flex w-full flex-col rounded-[30px] border border-border/80 bg-background/95 px-4 py-3 shadow-[var(--control-shadow)] transition-all focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/15",
            largeComposer ? "min-h-[150px]" : "min-h-[60px]",
          )}
        >
          <div className="flex min-h-0 flex-1 items-start gap-2">
            <Textarea
              className={cn(
                "max-h-[180px] min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-1 text-[18px] leading-7 shadow-none focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0",
                largeComposer ? "min-h-[78px]" : "min-h-10 text-[15px] leading-6",
              )}
              disabled={isSending}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  const shouldClose = Boolean(prompt.trim()) && !isSending;
                  handleSend(event);
                  if (shouldClose) {
                    closeMobileComposer();
                  }
                }
              }}
              placeholder={uiCopy.promptPlaceholder}
              value={prompt}
            />
          </div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <Button
              aria-label={common.newChat}
              className="h-10 w-10 shrink-0 rounded-2xl text-muted-foreground hover:text-foreground"
              onClick={handleNew}
              size="icon"
              title={common.newChat}
              type="button"
              variant="ghost"
            >
              <Plus className="size-5" />
            </Button>
            {isSending ? (
              <Button className="h-10 w-10 shrink-0 rounded-full sm:w-auto sm:px-4" onClick={handleStopStreaming} type="button" variant="destructive">
                <Square className="fill-current" />
                <span className="hidden sm:inline">{chatCopy.stop}</span>
              </Button>
            ) : (
              <Button className="h-10 w-10 shrink-0 rounded-full sm:w-auto sm:px-4" disabled={!prompt.trim()} type="submit">
                <Send className="size-5" />
                <span className="hidden sm:inline">{common.send}</span>
              </Button>
            )}
          </div>
        </div>
      </form>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      <section className="finance-flat-page flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
        <div className="shrink-0 border-b border-border/60 px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="truncate text-3xl font-semibold tracking-normal sm:text-4xl">{uiCopy.title}</h1>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                aria-label="新建对话"
                className="h-11 w-11 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground sm:h-12 sm:w-12"
                onClick={handleNew}
                size="icon"
                title={common.newChat}
                type="button"
                variant="ghost"
              >
                <PencilLine className="size-5" />
              </Button>
              <div className="relative" ref={historyMenuRef}>
                <Button
                  aria-expanded={historyOpen}
                  aria-haspopup="menu"
                  aria-label={common.history}
                  className="h-11 w-11 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground sm:h-12 sm:w-12"
                  onClick={() => setHistoryOpen((current) => !current)}
                  size="icon"
                  title={common.history}
                  type="button"
                  variant="ghost"
                >
                  <History className="size-5" />
                </Button>
                {historyOpen ? (
                  <div className="fixed inset-x-2 top-[calc(0.75rem+env(safe-area-inset-top))] z-[60] max-h-[min(520px,72dvh)] w-auto max-w-none overflow-hidden rounded-xl border border-border/90 bg-popover/95 p-2 shadow-2xl backdrop-blur lg:absolute lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-[calc(100%+0.5rem)] lg:z-40 lg:max-h-none lg:w-[320px] lg:max-w-[calc(100vw-2rem)] lg:rounded-lg">
                    <div className="mb-2 flex items-center justify-between gap-2 px-1">
                      <div>
                        <p className="text-xs font-semibold">{common.history}</p>
                        <p className="text-[10px] text-muted-foreground">{formatTemplate(uiCopy.sessions, { count: conversations.length })}</p>
                      </div>
                      {conversations.length > 0 ? (
                        <Button
                          aria-label={uiCopy.clearAllHistory}
                          className="h-7 shrink-0 px-2 text-[11px]"
                          onClick={handleClearAllHistory}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <Trash2 className="size-3" />
                          {uiCopy.clearAllHistory}
                        </Button>
                      ) : null}
                    </div>
                    {activeId ? (
                      <Button
                        className="mb-2 h-8 w-full justify-start px-2 text-xs"
                        onClick={() => clearMessages(activeId)}
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 className="size-3.5" />
                        {uiCopy.clearCurrent}
                      </Button>
                    ) : null}
                    <div className="max-h-[min(410px,58dvh)] overflow-y-auto lg:max-h-[360px]">
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
                                className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive lg:size-5 lg:opacity-0 lg:group-hover:opacity-100"
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
              <Button
                aria-label={uiCopy.fullscreen}
                className="h-11 w-11 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground sm:h-12 sm:w-12"
                onClick={handleToggleFullscreen}
                size="icon"
                title={uiCopy.fullscreen}
                type="button"
                variant="ghost"
              >
                <Maximize2 className="size-5" />
              </Button>
            </div>
          </div>
        </div>

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-3 pt-4 sm:px-4 sm:pt-5 lg:pb-3",
            mobileNavVisible ? "pb-20 sm:pb-24" : "pb-14 sm:pb-16",
          )}
          onScroll={handleChatScroll}
          ref={chatScrollRef}
        >
          <div className="mr-auto w-full space-y-4">
            {isNewConversation ? (
              <div className="mx-auto w-full max-w-5xl space-y-10 py-6 sm:py-10">
                <div className="space-y-8">
                  <h2 className="max-w-4xl text-2xl font-semibold leading-tight tracking-normal sm:text-3xl">
                    {greeting}
                  </h2>
                  {suggestionPrompts.length > 0 ? (
                    <div className="max-w-4xl space-y-2">
                      {suggestionPrompts.map((item) => (
                        <button
                          className="group flex min-h-14 w-full items-center justify-between gap-4 rounded-2xl bg-muted/35 px-4 py-3 text-left text-base font-medium text-foreground transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5"
                          key={item}
                          onClick={() => applyPrompt(item)}
                          type="button"
                        >
                          <span className="min-w-0 truncate">{item}</span>
                          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-background/65 text-muted-foreground transition-colors group-hover:text-primary">
                            <Search className="size-5" />
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="space-y-4">
                  <p className="text-lg font-semibold text-muted-foreground sm:text-xl">{uiCopy.exploreTitle}</p>
                  <div className="flex max-w-4xl flex-wrap gap-3">
                    {explorePrompts.map((item) => (
                      <button
                        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-muted/55 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-base"
                        key={item.label}
                        onClick={() => applyPrompt(item.prompt || uiCopy.promptPlaceholder)}
                        type="button"
                      >
                        <span className="text-muted-foreground">{item.icon}</span>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
            {messages.map((message) => (
              <div className={cn("group flex min-w-0 gap-2 sm:gap-3", message.role === "user" ? "justify-end" : "justify-start")} key={message.id}>
                {message.role === "assistant" ? (
                  <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    {message.pending ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                  </div>
                ) : null}
                <div
                  className={cn(
                    "message-bubble min-w-0 max-w-[92%] rounded-2xl border px-3.5 py-3 shadow-sm sm:max-w-[84%] sm:px-4 sm:py-3.5 xl:max-w-[78%]",
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

        {renderComposer("desktop")}
      </section>
      {mobileComposerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label={closeComposerLabel}
            className="absolute inset-0 bg-background/35 backdrop-blur-[1px]"
            onClick={closeMobileComposer}
            type="button"
          />
          {renderComposer("mobile")}
        </div>
      ) : (
        <button
          aria-label={openComposerLabel}
          className={cn(
            "fixed right-3 z-30 grid size-12 place-items-center rounded-full border border-primary/35 bg-primary text-primary-foreground shadow-[0_14px_34px_hsl(var(--primary)_/_0.28)] transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background lg:hidden",
            mobileNavVisible ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))]" : "bottom-[calc(0.75rem+env(safe-area-inset-bottom))]",
          )}
          onClick={() => setMobileComposerOpen(true)}
          title={openComposerLabel}
          type="button"
        >
          {isSending ? <Loader2 className="size-5 animate-spin" /> : <MessageSquareText className="size-5" />}
          {prompt.trim() ? <span className="absolute right-1 top-1 size-2.5 rounded-full bg-secondary ring-2 ring-background" /> : null}
        </button>
      )}
    </div>
  );
}
