import { ChatSources } from "@/components/chat/ChatSources";
import { ChatTraceList } from "@/components/chat/ChatTraceList";
import { CopyButton } from "@/components/chat/CopyButton";
import { parseFinanceChart } from "@/components/chat/finance-chart-model";
import { FinanceChartBlock } from "@/components/chat/FinanceChartBlock";
import { formatRelativeDate } from "@/components/chat/history-format";
import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { RenderImagePreview } from "@/components/RenderImagePreview";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ChatHistoryState } from "@/hooks/useConversations";
import type { AppLanguage } from "@/i18n";
import { formatTemplate, getMessages, i18n } from "@/i18n";
import { hasPendingChatQueue, visibleChatInputs } from "@/lib/chat-inputs";
import { persistChatThinkingEnabled, readChatThinkingEnabled, resetChatThinkingEnabled } from "@/lib/chat-thinking";
import { cn } from "@/lib/utils";
import type { ChatInput, ChatInputMode, ChatMessage, Conversation } from "@/types/app";
import {
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  History,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minimize2,
  PencilLine,
  Plus,
  Send,
  Square,
  Trash2,
  X
} from "lucide-react";
import type { FormEvent, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export function ChatPage({
  chatScrollRef,
  confirmAction,
  endRef,
  handleSend,
  handleChatScroll,
  handleStopStreaming,
  embedded = false,
  expanded = false,
  isSending,
  canSteer,
  isInputBusy,
  inputError,
  inputRetryMode,
  handleCancelInput,
  handleResumeInputQueue,
  language,
  displayName,
  onToggleExpanded,
  messages,
  mobileNavVisible = true,
  prompt,
  chatHistory,
  setPrompt,
}: {
  chatScrollRef: RefObject<HTMLDivElement | null>;
  confirmAction: ConfirmFn;
  endRef: RefObject<HTMLDivElement | null>;
  handleSend: (event?: { preventDefault: () => void }, value?: string, options?: { forceNewSession?: boolean; newSession?: boolean; thinkingEnabled?: boolean; inputMode?: ChatInputMode }) => void;
  handleChatScroll: () => void;
  handleStopStreaming: () => void;
  embedded?: boolean;
  expanded?: boolean;
  isSending: boolean;
  canSteer: boolean;
  isInputBusy: boolean;
  inputError?: string;
  inputRetryMode?: ChatInputMode;
  handleCancelInput: (input: ChatInput) => void;
  handleResumeInputQueue: () => void;
  language: AppLanguage;
  displayName?: string;
  onToggleExpanded?: () => void;
  messages: ChatMessage[];
  mobileNavVisible?: boolean;
  prompt: string;
  chatHistory: ChatHistoryState;
  setPrompt: (value: string) => void;
}) {
  const {
    conversations,
    activeId,
    createConversation,
    switchConversation,
    deleteConversation,
    clearMessages,
    clearAllConversations,
    isCreatingConversation,
    isActiveConversationLoading,
  } = chatHistory;
  const chatCopy = i18n[language].chat;
  const common = i18n[language].common;
  const uiCopy = i18n[language].chatUi;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mobileComposerOpen, setMobileComposerOpen] = useState(false);
  const [thinkingEnabled, setThinkingEnabled] = useState(readChatThinkingEnabled);
  const [inputMode, setInputMode] = useState<ChatInputMode>("queue");
  const historyMenuRef = useRef<HTMLDivElement | null>(null);
  const openComposerLabel = getMessages(language).chat.openComposerLabel;
  const closeComposerLabel = getMessages(language).chat.closeComposerLabel;
  const expandLabel = expanded
    ? (getMessages(language).chat.collapseChat)
    : (getMessages(language).chat.expandChat);
  const composerCopy = getMessages(language).chat;
  const thinkingLabel = formatTemplate(composerCopy.thinkingLabel, {
    state: thinkingEnabled ? composerCopy.thinkingOn : composerCopy.thinkingOff,
  });
  const isHistoryLoading = chatHistory.isLoading;
  const inputs = visibleChatInputs(chatHistory.activeConversation?.inputs ?? []);
  const hasPendingQueue = hasPendingChatQueue(inputs);
  const inputQueuePaused = chatHistory.activeConversation?.inputQueuePaused === true;
  const effectiveInputMode = inputRetryMode ?? inputMode;
  const queueSubmission = isSending || hasPendingQueue || inputQueuePaused;
  const sendLabel = isInputBusy ? chatCopy.inputSubmitting
    : effectiveInputMode === "steer" ? chatCopy.inputSteer
      : queueSubmission ? chatCopy.inputQueue : common.send;
  const canSubmit = Boolean(prompt.trim()) && !isInputBusy && !isActiveConversationLoading
    && (!isSending || Boolean(activeId))
    && (effectiveInputMode !== "steer" || canSteer || inputRetryMode === "steer");
  const isNewConversation = !isHistoryLoading && !isActiveConversationLoading && messages.length === 0 && !isSending;
  const greeting = displayName
    ? formatTemplate(uiCopy.greeting, { name: displayName })
    : uiCopy.greetingAnonymous;
  const explorePrompts = [
    {
      icon: <BriefcaseBusiness className="size-5" />,
      label: uiCopy.explorePortfolio,
      prompt: getMessages(language).chat.analyzePortfolio,
    },
  ];
  const markdownComponents = useMemo<Components>(
    () => ({
      pre({ children }) {
        return <div className="not-prose my-2 overflow-x-auto rounded-md bg-muted/35 p-3">{children}</div>;
      },
      code({ className, children, ...props }) {
        const match = /language-([\w-]+)/.exec(className ?? "");
        const lang = match?.[1]?.toLowerCase();
        const raw = String(children ?? "").replace(/\n$/, "");
        if (lang === "finance-chart" || lang === "finance_chart" || lang === "financechart") {
          const chart = parseFinanceChart(raw);
          if (chart) return <FinanceChartBlock chart={chart} language={language} />;
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
      a({ href, children }) {
        return (
          <a href={href} rel="noreferrer" target="_blank">
            {children}
          </a>
        );
      },
    }),
    [language],
  );

  const grouped = useMemo(() => {
    const groups: Record<string, Conversation[]> = {};
    for (const c of conversations) {
      const label = formatRelativeDate(c.updatedAt, language);
      (groups[label] ??= []).push(c);
    }
    return groups;
  }, [conversations, language]);

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

  useEffect(() => {
    persistChatThinkingEnabled(thinkingEnabled);
  }, [thinkingEnabled]);

  useEffect(() => {
    setInputMode("queue");
  }, [activeId, isSending]);

  function resetThinkingMode() {
    resetChatThinkingEnabled();
    setThinkingEnabled(false);
  }

  function handleNew() {
    resetThinkingMode();
    if (isSending || isCreatingConversation || isNewConversation) return;
    void createConversation().catch(() => {
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

  function toggleThinkingEnabled() {
    setThinkingEnabled((current) => {
      const next = !current;
      persistChatThinkingEnabled(next);
      return next;
    });
  }

  function handleClearCurrent() {
    if (!activeId) return;
    resetThinkingMode();
    clearMessages(activeId);
  }

  function handleSwitchConversation(conversation: Conversation) {
    const isEmptyConversation = conversation.messageCount === 0 || (conversation.messages.length === 0 && !conversation.lastMessage);
    if (isEmptyConversation) {
      resetThinkingMode();
    }
    switchConversation(conversation.id);
    setHistoryOpen(false);
  }

  function handleComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    handleSend(event, undefined, { thinkingEnabled, inputMode: effectiveInputMode });
    if (!queueSubmission && !inputRetryMode) {
      closeMobileComposer();
    }
  }

  function handleToggleFullscreen() {
    if (embedded && onToggleExpanded) {
      onToggleExpanded();
      return;
    }
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

  function sendPrompt(value: string) {
    const text = value.trim();
    if (!text || isSending) return;
    handleSend(undefined, text, { thinkingEnabled });
    closeMobileComposer();
  }

  function renderComposer(mode: "desktop" | "mobile") {
    const isMobile = mode === "mobile";
    const largeComposer = isNewConversation && !embedded;

    return (
      <form
        className={cn(
          isMobile
            ? "absolute inset-x-2 rounded-[30px] border border-border/80 bg-card/95 p-2.5 shadow-2xl backdrop-blur"
            : cn("bg-transparent px-2 pb-2 pt-1 sm:px-3 sm:pb-4", embedded ? "block" : "hidden lg:block"),
          isMobile && (mobileNavVisible ? "bottom-[calc(4.75rem+env(safe-area-inset-bottom))]" : "bottom-[calc(0.75rem+env(safe-area-inset-bottom))]"),
        )}
        onSubmit={handleComposerSubmit}
      >
        <div
          className={cn(
            "mr-auto flex w-full flex-col rounded-[30px] border border-border/80 bg-background/95 px-3 py-2 shadow-[var(--control-shadow)] transition-all focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/15 sm:px-4 sm:py-3",
            largeComposer ? "min-h-[150px]" : "min-h-[48px] sm:min-h-[60px]",
          )}
        >
          <div className="flex min-h-0 flex-1 items-start gap-2">
            <Textarea
              className={cn(
                "max-h-[180px] min-w-0 flex-1 resize-none border-0 bg-transparent px-0 py-1 text-[18px] leading-7 shadow-none focus-visible:border-transparent focus-visible:bg-transparent focus-visible:ring-0",
                largeComposer ? "min-h-[78px]" : "min-h-8 text-[15px] leading-6 sm:min-h-10",
                embedded && "text-[14px] leading-6",
              )}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  if (!canSubmit) return;
                  handleSend(event, undefined, { thinkingEnabled, inputMode: effectiveInputMode });
                  if (!queueSubmission && !inputRetryMode) {
                    closeMobileComposer();
                  }
                }
              }}
              placeholder={uiCopy.promptPlaceholder}
              value={prompt}
            />
          </div>
          <div className="mt-1 flex items-end justify-between gap-2 sm:mt-2 sm:gap-3">
            <div className="flex shrink-0 items-center gap-1">
              <Button
                aria-label={common.newChat}
                aria-busy={isCreatingConversation}
                className="h-9 w-9 shrink-0 rounded-2xl text-muted-foreground hover:text-foreground sm:h-10 sm:w-10"
                disabled={isSending || isCreatingConversation || isNewConversation}
                onClick={handleNew}
                size="icon"
                title={common.newChat}
                type="button"
                variant="ghost"
              >
                {isCreatingConversation ? <Loader2 className="size-4 animate-spin sm:size-5" /> : <Plus className="size-4 sm:size-5" />}
              </Button>
              <Button
                aria-label={thinkingLabel}
                aria-pressed={thinkingEnabled}
                className={cn(
                  "h-9 w-9 shrink-0 rounded-2xl transition-colors sm:h-10 sm:w-10",
                  thinkingEnabled
                    ? "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={toggleThinkingEnabled}
                size="icon"
                title={thinkingLabel}
                type="button"
                variant="ghost"
              >
                <BrainCircuit className="size-4 sm:size-5" />
              </Button>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              {isSending ? (
                <Button aria-label={chatCopy.stop} className="h-9 w-9 shrink-0 rounded-full sm:h-10 sm:w-10" onClick={handleStopStreaming} title={chatCopy.stop} type="button" variant="destructive">
                  <Square className="size-4 fill-current" />
                </Button>
              ) : null}
              <Button aria-label={sendLabel} className="h-9 shrink-0 rounded-full px-3 text-xs sm:h-10 sm:px-4 sm:text-sm" disabled={!canSubmit} title={sendLabel} type="submit">
                {isInputBusy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                <span>{sendLabel}</span>
              </Button>
            </div>
          </div>
          {isSending || inputRetryMode ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/50 pt-2">
              <select
                aria-label={chatCopy.inputMode}
                className="h-8 max-w-full rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                disabled={isInputBusy || Boolean(inputRetryMode)}
                onChange={(event) => setInputMode(event.target.value as ChatInputMode)}
                value={effectiveInputMode}
              >
                <option value="queue">{chatCopy.inputQueue}</option>
                <option disabled={!canSteer && inputRetryMode !== "steer"} value="steer">{chatCopy.inputSteer}</option>
              </select>
              <p className="text-[11px] text-muted-foreground">
                {effectiveInputMode === "steer" ? chatCopy.inputSteerHint : !canSteer && isSending ? chatCopy.inputAwaitingRun : chatCopy.inputQueueHint}
              </p>
            </div>
          ) : null}
          {inputError ? (
            <p className="mt-2 text-xs text-destructive" role="alert">{inputError} {inputRetryMode ? chatCopy.inputRetryHint : ""}</p>
          ) : null}
        </div>
      </form>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 flex-1 overflow-hidden", embedded && "min-h-0 rounded-none")}>
      <section className="finance-flat-page flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
        <div className={cn("shrink-0 border-b border-border/60 px-3 py-3 sm:px-4", embedded && "py-2.5")}>
          <div className="flex items-center justify-between gap-3">
            <h1 className={cn("truncate font-semibold tracking-normal", embedded ? "text-base sm:text-lg" : "text-3xl sm:text-4xl")}>{uiCopy.title}</h1>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                aria-label={common.newChat}
                aria-busy={isCreatingConversation}
                className="h-11 w-11 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground sm:h-12 sm:w-12"
                disabled={isSending || isCreatingConversation || isNewConversation}
                onClick={handleNew}
                size="icon"
                title={common.newChat}
                type="button"
                variant="ghost"
              >
                {isCreatingConversation ? <Loader2 className="size-5 animate-spin" /> : <PencilLine className="size-5" />}
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
                  <div
                    className={cn(
                      "absolute top-[calc(100%+0.5rem)] z-40 max-h-[min(520px,72dvh)] w-[calc(100vw-1.5rem)] max-w-[22rem] overflow-hidden rounded-xl border border-border/90 bg-popover/95 p-2 shadow-2xl backdrop-blur lg:right-0 lg:max-h-none lg:w-[320px] lg:max-w-[calc(100vw-2rem)] lg:rounded-lg",
                      embedded ? "right-[-2.75rem]" : "right-[-3.25rem] sm:right-[-3.5rem]",
                    )}
                  >
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
                        onClick={handleClearCurrent}
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
                                handleSwitchConversation(c);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return;
                                event.preventDefault();
                                handleSwitchConversation(c);
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
                aria-label={embedded ? expandLabel : uiCopy.fullscreen}
                className={cn(
                  "h-11 w-11 rounded-full text-muted-foreground hover:bg-muted/70 hover:text-foreground sm:h-12 sm:w-12",
                  embedded && "h-9 w-9 sm:h-9 sm:w-9",
                )}
                onClick={handleToggleFullscreen}
                size="icon"
                title={embedded ? expandLabel : uiCopy.fullscreen}
                type="button"
                variant="ghost"
              >
                {embedded && expanded ? <Minimize2 className="size-4" /> : <Maximize2 className={embedded ? "size-4" : "size-5"} />}
              </Button>
            </div>
          </div>
        </div>

        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-3 pt-4 sm:px-4 sm:pt-5 lg:pb-3",
            embedded ? "pb-4 sm:pb-4" : mobileNavVisible ? "pb-20 sm:pb-24" : "pb-14 sm:pb-16",
          )}
          onScroll={handleChatScroll}
          ref={chatScrollRef}
        >
          <div className="mr-auto w-full space-y-4">
            {isActiveConversationLoading ? (
              <div className="flex min-h-56 items-center justify-center">
                <div className="flex items-center gap-2 rounded-md border border-border/75 bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  {common.loading}
                </div>
              </div>
            ) : null}
            {isNewConversation ? (
              <div className={cn("mx-auto w-full max-w-5xl space-y-10 py-6 sm:py-10", embedded && "space-y-5 py-2 sm:py-4")}>
                <div className={cn("space-y-8", embedded && "space-y-4")}>
                  <h2 className={cn("max-w-4xl font-semibold leading-tight tracking-normal", embedded ? "text-lg sm:text-xl" : "text-2xl sm:text-3xl")}>
                    {greeting}
                  </h2>
                </div>
                <div className={cn("space-y-4", embedded && "space-y-2")}>
                  <p className={cn("font-semibold text-muted-foreground", embedded ? "text-sm" : "text-lg sm:text-xl")}>{uiCopy.exploreTitle}</p>
                  <div className="flex max-w-4xl flex-wrap gap-3">
                    {explorePrompts.map((item) => (
                      <button
                        className={cn(
                          "inline-flex min-h-11 items-center gap-2 rounded-full bg-muted/55 px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-muted/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-base",
                          embedded && "min-h-9 px-3 py-1.5 text-xs sm:text-sm",
                        )}
                        key={item.label}
                        onClick={() => sendPrompt(item.prompt)}
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
            {!isActiveConversationLoading && messages.map((message) => (
              <div className={cn("group flex min-w-0 gap-2 sm:gap-3", message.role === "user" ? "justify-end" : "justify-start")} key={message.id}>
                {message.role === "assistant" ? (
                  <div className="mt-1 grid size-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    {message.pending ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
                  </div>
                ) : null}
                <div
                  className={cn(
                    "message-bubble min-w-0 max-w-[92%] rounded-2xl border px-3.5 py-3 shadow-sm sm:max-w-[84%] sm:px-4 sm:py-3.5 xl:max-w-[78%]",
                    embedded && "sm:max-w-[92%] xl:max-w-[88%]",
                    message.role === "user"
                      ? "chat-bubble-user"
                      : "chat-bubble-assistant",
                  )}
                >
                  {message.role === "assistant" ? <ChatTraceList trace={message.trace} /> : null}
                  {message.role === "assistant" ? message.renderedImages?.map((artifact) => (
                    <RenderImagePreview artifact={artifact} key={artifact.artifact_id} language={language} />
                  )) : null}
                  {message.role === "assistant" && message.pending && message.status ? (
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Loader2 className="size-3 animate-spin text-primary" />
                      <span>{message.status}</span>
                    </div>
                  ) : null}
                  {message.pending && message.status && message.content === message.status ? null : (
                    <div className="chat-message-content prose prose-sm dark:prose-invert max-w-none break-words prose-headings:my-2 prose-p:my-1 prose-p:text-inherit prose-pre:my-2 prose-pre:rounded-md prose-code:text-primary prose-strong:text-inherit prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-li:text-inherit prose-table:my-2">
                      {message.role === "assistant" ? (
                        <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                      ) : (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      )}
                    </div>
                  )}
                  {message.role === "assistant" && !message.pending ? <ChatSources language={language} message={message} /> : null}
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

        {inputs.length > 0 ? (
          <div className="shrink-0 border-t border-border/50 px-3 py-2 sm:px-4">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">{chatCopy.inputList} · {inputs.length}</p>
              {!isSending && hasPendingQueue ? (
                <Button className="h-7 px-2 text-xs" disabled={isInputBusy || isActiveConversationLoading} onClick={handleResumeInputQueue} type="button" variant="outline">
                  {isInputBusy ? <Loader2 className="size-3 animate-spin" /> : null}{chatCopy.inputResume}
                </Button>
              ) : null}
            </div>
            {inputQueuePaused && hasPendingQueue ? <p className="mb-1.5 text-[11px] text-muted-foreground">{chatCopy.inputPaused}</p> : null}
            <ul aria-label={chatCopy.inputList} aria-live="polite" className="max-h-36 space-y-1.5 overflow-y-auto">
              {inputs.map((input) => (
                <li className="flex items-start gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs" key={input.id}>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{input.mode === "steer" ? chatCopy.inputSteer : chatCopy.inputQueue}</span>
                      <span className={cn(input.status === "failed" && "text-destructive")}>
                        {input.status === "pending" ? input.mode === "steer" ? chatCopy.inputPendingSteer : chatCopy.inputPendingQueue
                          : input.status === "running" ? chatCopy.inputRunning : input.status === "applied" ? chatCopy.inputApplied : chatCopy.inputFailed}
                      </span>
                    </div>
                    <p className="line-clamp-2 whitespace-pre-wrap break-words" title={input.message}>{input.message}</p>
                    {input.error ? <p className="mt-0.5 line-clamp-2 break-words text-[11px] text-destructive" title={input.error}>{input.error}</p> : null}
                  </div>
                  {input.status === "pending" || input.status === "failed" ? (
                    <Button aria-label={chatCopy.inputRemove} className="size-7 shrink-0" disabled={isInputBusy} onClick={() => handleCancelInput(input)} size="icon" title={chatCopy.inputRemove} type="button" variant="ghost"><X className="size-3.5" /></Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {renderComposer("desktop")}
      </section>
      {!embedded && mobileComposerOpen ? (
        <div className="fixed inset-0 z-[1000] lg:hidden">
          <button
            aria-label={closeComposerLabel}
            className="absolute inset-0 bg-background/35 backdrop-blur-[1px]"
            onClick={closeMobileComposer}
            type="button"
          />
          {renderComposer("mobile")}
        </div>
      ) : !embedded ? (
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
      ) : null}
    </div>
  );
}
