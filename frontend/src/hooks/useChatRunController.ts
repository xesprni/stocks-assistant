import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/common/Toast";
import { ApiHttpError, cancelChatRun, cancelChatInput, submitChatInput, resumeChatInputQueue, getChatSession, resumeChatStream, streamChat, trackProductEvent } from "@/lib/api";
import { resetChatThinkingEnabled } from "@/lib/chat-thinking";
import { ChatStreamHttpError } from "@/lib/chat-stream";
import { chatInputDraftKey, hasPendingChatQueue, prepareChatInputRequest } from "@/lib/chat-inputs";
import { chatRunReducer, initialChatRunState } from "@/lib/chat-run-reducer";
import { formatTemplate, i18n, localeFor, type AppLanguage } from "@/lib/i18n";
import type { ChatHistoryState } from "@/hooks/useConversations";
import type { ChatMessage, ChatInput, ChatInputMode, ChatInputRequest, ChatRunSummary, ChatStreamEvent } from "@/types/app";

function chatTime(language: AppLanguage = "zh") {
  return new Date().toLocaleTimeString(localeFor(language), { hour: "2-digit", minute: "2-digit" });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function isNetworkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Load failed|Failed to fetch|NetworkError|network connection was lost|offline|cancelled/i.test(message);
}

function chatFailureMessage(error: unknown, language: AppLanguage): string {
  if (isNetworkLoadError(error)) return i18n[language].chat.networkLoadFailed;
  return error instanceof Error ? error.message : (language === "en" ? "Chat request failed" : "对话请求失败");
}


export function useChatRunController({ chatHistory, language, productAnalyticsEnabled, onSendStart }: {
  chatHistory: ChatHistoryState;
  language: AppLanguage;
  productAnalyticsEnabled: boolean;
  onSendStart: (resuming: boolean) => void;
}) {
  const { showToast } = useToast();
  const ui = i18n[language];
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});
  const [inputBusySessions, setInputBusySessions] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const streamRunRef = useRef<string | null>(null);
  const streamSessionRef = useRef<string | null>(null);
  const stopRequestedRef = useRef(false);
  const isSendingRef = useRef(false);
  const inputRequestsRef = useRef(new Map<string, ChatInputRequest>());
  const inputBusyRef = useRef(new Set<string>());
  const messages = chatHistory.activeConversation?.messages ?? [];
  const activeConvId = chatHistory.activeId;
  const draftKey = chatInputDraftKey(activeConvId);
  const prompt = chatDrafts[draftKey] ?? "";
  const activeRun = chatHistory.activeConversation?.activeRun;
  const activeIsSending = Boolean(activeRun && (activeRun.status === "running" || activeRun.status === "stopping"))
    || (isSending && streamSessionRef.current === activeConvId);
  const canSteer = Boolean(activeRun?.status === "running" && activeRun.session_id === activeConvId
    && !(streamSessionRef.current === activeConvId && stopRequestedRef.current));
  function setPrompt(value: string) {
    setChatDrafts((current) => ({ ...current, [draftKey]: value }));
  }
  useEffect(() => () => {
    streamAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (streamSessionRef.current && streamSessionRef.current !== activeConvId) {
      streamAbortRef.current?.abort();
    }
    if (chatHistory.isLoading || chatHistory.isActiveConversationLoading || isSendingRef.current) return;
    const run = chatHistory.activeConversation?.activeRun;
    if (run && (run.status === "running" || run.status === "stopping")) {
      void handleSend(undefined, run.user_message, { resumeRun: run });
    }
  }, [activeConvId, chatHistory.isLoading, chatHistory.isActiveConversationLoading, chatHistory.activeConversation?.activeRun?.run_id, isSending]);

  async function handleSend(
    event?: { preventDefault: () => void },
    value = prompt,
    options: { forceNewSession?: boolean; newSession?: boolean; thinkingEnabled?: boolean; resumeRun?: ChatRunSummary; inputMode?: ChatInputMode } = {},
  ) {
    event?.preventDefault();
    const text = (options.resumeRun?.user_message ?? value).trim();
    const retry = activeConvId ? inputRequestsRef.current.get(activeConvId) : undefined;
    if (!options.resumeRun && !options.forceNewSession && !options.newSession && activeConvId
      && (activeIsSending || hasPendingChatQueue(chatHistory.activeConversation?.inputs ?? [])
        || chatHistory.activeConversation?.inputQueuePaused || retry?.message === text || options.inputMode === "steer")) {
      await handleSubmitInput(activeConvId, text, options.inputMode ?? "queue", options.thinkingEnabled === true);
      return;
    }
    if (!text || isSendingRef.current) return;

    onSendStart(Boolean(options.resumeRun));
    const createdAt = chatTime(language);
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      createdAt,
    };
    const pendingMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: ui.chat.connecting,
      createdAt,
      pending: true,
      status: ui.chat.connecting,
      trace: [{ id: crypto.randomUUID(), label: ui.chat.connecting, status: "running", createdAt }],
    };

    if (!options.resumeRun) setPrompt("");
    isSendingRef.current = true;
    setIsSending(true);
    if (!options.resumeRun && productAnalyticsEnabled) {
      void trackProductEvent("research_started").catch(() => undefined);
    }

    const shouldCreateNewSession = options.forceNewSession === true || options.newSession === true;
    if (shouldCreateNewSession && options.thinkingEnabled !== true) {
      resetChatThinkingEnabled();
    }
    let convId = options.resumeRun?.session_id ?? (shouldCreateNewSession ? null : activeConvId);
    let assistantMessageId = pendingMessage.id;
    let view = initialChatRunState(pendingMessage);
    const requestId = options.resumeRun?.request_id ?? crypto.randomUUID();
    const previousMessageIds = new Set(messages.map((message) => message.id));
    let streamEventHandler: ((event: ChatStreamEvent) => void) | undefined;
    const abortController = new AbortController();
    streamAbortRef.current = abortController;
    streamRunRef.current = options.resumeRun?.run_id ?? null;
    streamSessionRef.current = convId;
    stopRequestedRef.current = options.resumeRun?.status === "stopping";

    const updateAssistant = (patch: Partial<ChatMessage>) => {
      if (!convId) return;
      chatHistory.updateMessage(convId, assistantMessageId, patch);
      view = { ...view, message: { ...view.message, ...patch } };
      if (typeof patch.id === "string") {
        assistantMessageId = patch.id;
      }
    };

    const commitStreamState = (patch: Partial<ChatMessage> = {}) => {
      const displayStatus = stopRequestedRef.current && patch.pending !== false ? ui.chat.stopping : view.currentStatus;
      updateAssistant({
        content: view.streamedContent || displayStatus,
        status: displayStatus,
        trace: view.trace,
        renderedImages: view.renderedImages,
        ...patch,
      });
    };

    try {
      if (options.resumeRun && convId) {
        const existing = messages.find((message) => message.role === "assistant" && message.pending);
        if (existing) {
          assistantMessageId = existing.id;
          view = initialChatRunState({ ...pendingMessage, id: existing.id });
          commitStreamState({ pending: true });
        } else {
          chatHistory.addMessage(convId, pendingMessage);
        }
      } else if (!convId) {
        convId = await chatHistory.createConversation(userMessage);
        chatHistory.addMessage(convId, pendingMessage);
      } else {
        chatHistory.addMessage(convId, userMessage);
        chatHistory.addMessage(convId, pendingMessage);
      }

      streamSessionRef.current = convId;
      abortController.signal.throwIfAborted();

      const onStreamEvent = (streamEvent: ChatStreamEvent) => {
        const data = streamEvent.data;
        if (streamEvent.run_id) streamRunRef.current = streamEvent.run_id;

        if (streamEvent.type === "input_updated") {
          const input = data?.input as ChatInput | undefined;
          if (convId && input?.id && input.session_id === convId) chatHistory.updateInput(convId, input);
          return;
        }

        if (streamEvent.type === "run_started") {
          if (convId && streamEvent.run_id) {
            if (!options.resumeRun) {
              chatHistory.updateMessage(convId, userMessage.id, { id: `run-user:${streamEvent.run_id}` });
            }
            chatHistory.updateRun(convId, {
              run_id: streamEvent.run_id,
              request_id: typeof data?.request_id === "string" ? data.request_id : "",
              session_id: convId,
              user_message: text,
              status: stopRequestedRef.current ? "stopping" : "running",
            });
          }
          if (stopRequestedRef.current) void handleStopStreaming(convId);
          return;
        }

        view = chatRunReducer(view, { event: streamEvent, language, stopping: stopRequestedRef.current, createdAt: chatTime(language) });
        updateAssistant(view.message);
        if (view.sawAgentEnd && convId) chatHistory.updateRun(convId, null);
        if (streamEvent.type === "agent_end" && productAnalyticsEnabled) {
          void trackProductEvent("research_response_completed", { source_count: view.message.sources?.length ?? 0 }).catch(() => undefined);
        }
        if (view.error) throw new Error(view.error);
      };
      streamEventHandler = onStreamEvent;
      if (options.resumeRun) {
        await resumeChatStream(options.resumeRun.run_id, onStreamEvent, abortController.signal);
      } else {
        await streamChat(text, convId, onStreamEvent, false, abortController.signal, options.thinkingEnabled === true, requestId);
      }

      if (!view.sawAgentEnd) {
        view.trace = view.trace.map((item) => (item.status === "running" ? { ...item, status: "done" } : item));
        updateAssistant({
          content: view.streamedContent || ui.chat.empty,
          pending: false,
          status: ui.chat.complete,
          trace: view.trace,
          createdAt: chatTime(language),
        });
      }
    } catch (caught) {
      // 卸载和切换会话只关闭订阅，后台任务继续运行。
      if (abortController.signal.aborted || isAbortError(caught)) return;
      if (convId && caught instanceof ChatStreamHttpError && (caught.status === 404 || caught.status === 410)) {
        try {
          const synced = await getChatSession(convId);
          abortController.signal.throwIfAborted();
          if (synced.activeRun?.request_id === requestId && streamEventHandler) {
            await resumeChatStream(synced.activeRun.run_id, streamEventHandler, abortController.signal);
            return;
          }
          let userIndex = -1;
          for (let index = synced.messages.length - 1; index >= 0; index -= 1) {
            if (synced.messages[index].role === "user" && synced.messages[index].content === text) {
              userIndex = index;
              break;
            }
          }
          const completed = userIndex < 0 ? undefined : synced.messages.slice(userIndex + 1).find(
            (message) => message.role === "assistant" && !previousMessageIds.has(message.id),
          );
          if (completed) {
            view.trace = view.trace.map((item) => item.status === "running" ? { ...item, status: "done" } : item);
            updateAssistant({ ...completed, pending: false, status: ui.chat.complete, trace: view.trace });
            chatHistory.updateRun(convId, null);
            return;
          }
        } catch (recoveryError) {
          if (abortController.signal.aborted || isAbortError(recoveryError)) return;
        }
      }
      if (convId) chatHistory.updateRun(convId, null);
      const msg = chatFailureMessage(caught, language);
      showToast({ kind: "error", message: msg, title: language === "en" ? "Chat" : "对话" });
      if (convId) {
        chatHistory.updateMessage(convId, assistantMessageId, {
          content: [view.streamedContent.trimEnd(), formatTemplate(ui.chat.requestFailed, { message: msg })].filter(Boolean).join("\n\n"),
          pending: false,
        });
      }
    } finally {
      if (convId && !abortController.signal.aborted && (view.sawAgentEnd || view.terminalEventReceived)) {
        try {
          // 服务端原子切换 FIFO 队列后读取下一轮，随后由订阅 effect 接流。
          await chatHistory.refreshConversation(convId);
        } catch (error) {
          showToast({ kind: "error", message: chatFailureMessage(error, language), title: ui.chat.inputSyncFailed });
        }
      }
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
        streamRunRef.current = null;
        streamSessionRef.current = null;
        stopRequestedRef.current = false;
        isSendingRef.current = false;
        setIsSending(false);
      }
    }
  }

  function markInputBusy(sessionId: string, busy: boolean) {
    if (busy) inputBusyRef.current.add(sessionId);
    else inputBusyRef.current.delete(sessionId);
    setInputBusySessions([...inputBusyRef.current]);
  }

  async function handleSubmitInput(sessionId: string, text: string, mode: ChatInputMode, thinkingEnabled: boolean) {
    if (!text || inputBusyRef.current.has(sessionId)) return;
    const previous = inputRequestsRef.current.get(sessionId);
    // 响应丢失后的重试保留原目标，即使当前运行已经结束也查询同一幂等请求。
    const retry = previous?.message === text ? previous : undefined;
    const targetRunId = mode === "steer" && activeRun?.session_id === sessionId && canSteer ? activeRun.run_id : undefined;
    if (!retry && mode === "steer" && !targetRunId) return;
    const request = retry ?? prepareChatInputRequest({
      message: text, mode, target_run_id: targetRunId, thinking_enabled: thinkingEnabled,
    }, previous, () => crypto.randomUUID());
    inputRequestsRef.current.set(sessionId, request);
    markInputBusy(sessionId, true);
    setInputErrors((current) => ({ ...current, [sessionId]: "" }));
    try {
      const input = await submitChatInput(sessionId, request);
      chatHistory.updateInput(sessionId, input);
      inputRequestsRef.current.delete(sessionId);
      const key = chatInputDraftKey(sessionId);
      setChatDrafts((current) => current[key]?.trim() === text ? { ...current, [key]: "" } : current);
      if (streamSessionRef.current !== sessionId || !isSendingRef.current) {
        try {
          await chatHistory.refreshConversation(sessionId);
        } catch (error) {
          showToast({ kind: "error", message: chatFailureMessage(error, language), title: ui.chat.inputSyncFailed });
        }
      }
    } catch (error) {
      setInputErrors((current) => ({ ...current, [sessionId]: chatFailureMessage(error, language) }));
      if (error instanceof ApiHttpError && error.status >= 400 && error.status < 500 && error.status !== 408) {
        // 明确拒绝说明未接收输入，解除旧目标以便用户改为排队；网络/服务端异常仍保留幂等重试。
        inputRequestsRef.current.delete(sessionId);
        try {
          await chatHistory.refreshConversation(sessionId);
        } catch {
          // 原始拒绝原因已展示，草稿保留供用户重试。
        }
      }
    } finally {
      markInputBusy(sessionId, false);
    }
  }

  async function handleCancelInput(input: ChatInput) {
    const sessionId = input.session_id;
    if (inputBusyRef.current.has(sessionId)) return;
    markInputBusy(sessionId, true);
    try {
      chatHistory.updateInput(sessionId, await cancelChatInput(sessionId, input.id));
    } catch (error) {
      showToast({ kind: "error", message: chatFailureMessage(error, language), title: ui.chat.inputRemove });
    } finally {
      markInputBusy(sessionId, false);
    }
  }

  async function handleResumeInputQueue() {
    const sessionId = activeConvId;
    if (!sessionId || inputBusyRef.current.has(sessionId)) return;
    markInputBusy(sessionId, true);
    try {
      await resumeChatInputQueue(sessionId);
      await chatHistory.refreshConversation(sessionId);
    } catch (error) {
      showToast({ kind: "error", message: chatFailureMessage(error, language), title: ui.chat.inputResume });
    } finally {
      markInputBusy(sessionId, false);
    }
  }

  async function handleStopStreaming(targetSessionId = activeConvId) {
    if (!targetSessionId) return;
    const ownsStream = streamSessionRef.current === targetSessionId;
    if (!ownsStream) {
      // 切换订阅的短暂窗口中，停止按钮仍只针对当前展示的会话。
      if (activeRun?.session_id !== targetSessionId) return;
      try {
        chatHistory.updateRun(targetSessionId, await cancelChatRun(activeRun.run_id));
      } catch (error) {
        showToast({ kind: "error", message: chatFailureMessage(error, language), title: ui.chat.stop });
      }
      return;
    }
    stopRequestedRef.current = true;
    const runId = streamRunRef.current;
    const controller = streamAbortRef.current;
    const sessionId = streamSessionRef.current;
    if (!runId) return;
    try {
      await cancelChatRun(runId);
      if (streamAbortRef.current !== controller || streamRunRef.current !== runId) return;
      const conversation = chatHistory.conversations.find((item) => item.id === sessionId);
      const pending = conversation?.messages.find((message) => message.pending);
      if (sessionId && pending) chatHistory.updateMessage(sessionId, pending.id, { status: ui.chat.stopping });
      // 保留订阅直到 agent_stopped，确保服务端释放会话后才允许发送下一条。
    } catch (error) {
      if (streamAbortRef.current !== controller || streamRunRef.current !== runId) return;
      stopRequestedRef.current = false;
      showToast({ kind: "error", message: chatFailureMessage(error, language), title: language === "en" ? "Stop generation" : "停止生成" });
    }
  }


  return { prompt, setPrompt, activeIsSending, canSteer, handleSend, handleStopStreaming, handleCancelInput, handleResumeInputQueue,
    isInputBusy: activeConvId != null && inputBusySessions.includes(activeConvId),
    inputError: activeConvId ? inputErrors[activeConvId] : undefined,
    inputRetryMode: activeConvId && inputRequestsRef.current.get(activeConvId)?.message === prompt.trim()
      ? inputRequestsRef.current.get(activeConvId)?.mode : undefined,
  };
}
