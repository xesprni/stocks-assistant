import { useEffect, useMemo, useRef, useState } from "react";

import { clearChatSessionMessages, createChatSession, deleteAllChatSessions, deleteChatSession, getChatSession, listChatSessions, updateChatSessionTitle } from "@/lib/api";
import { mergeChatInputs, upsertChatInput } from "@/lib/chat-inputs";
import { reconcileConversationClear } from "@/lib/conversation-reconciliation";
import type { ChatInput, ChatMessage, ChatRunSummary, Conversation } from "@/types/app";

const ACTIVE_SESSION_KEY = "stocks-assistant-active-session";
const MAX_CONVERSATIONS = 50;
export const CHAT_AUTO_SCROLL_THRESHOLD = 96;

function titleFromMessage(message?: ChatMessage): string {
  const title = message?.content.trim().replace(/\s+/g, " ") ?? "";
  if (!title) return "新对话";
  return title.slice(0, 30) + (title.length > 30 ? "..." : "");
}

function isEmptyConversation(conversation: Conversation | null | undefined): boolean {
  if (!conversation) return false;
  return conversation.messages.length === 0 && !conversation.lastMessage && (conversation.messageCount ?? 0) === 0;
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => localStorage.getItem(ACTIVE_SESSION_KEY));
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [loadingConversationId, setLoadingConversationId] = useState<string | null>(null);
  const userMutationVersionRef = useRef(0);
  const switchLoadVersionRef = useRef(0);
  const conversationsRef = useRef<Conversation[]>([]);
  const activeIdRef = useRef<string | null>(activeId);
  const clearOperationRef = useRef(0);
  const deletedConversationIdsRef = useRef(new Set<string>());
  const conversationMutationRef = useRef(new Map<string, number>());

  function beginConversationMutation(id: string) {
    const version = (conversationMutationRef.current.get(id) ?? 0) + 1;
    conversationMutationRef.current.set(id, version);
    const clearOperation = clearOperationRef.current;
    return () => conversationMutationRef.current.get(id) === version && clearOperationRef.current === clearOperation;
  }

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  function rememberActive(id: string | null) {
    setActiveId(id);
    activeIdRef.current = id;
    if (id) {
      localStorage.setItem(ACTIVE_SESSION_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_SESSION_KEY);
    }
  }

  function mergeConversation(conv: Conversation, preserveMessages = false) {
    setConversations((prev) => {
      const existing = prev.find((c) => c.id === conv.id);
      const merged = existing
        ? { ...existing, ...conv, messages: preserveMessages && conv.messages.length === 0 ? existing.messages : conv.messages }
        : conv;
      return [merged, ...prev.filter((c) => c.id !== conv.id)].slice(0, MAX_CONVERSATIONS);
    });
  }

  function mergeLoadedSessions(sessions: Conversation[], preserveLocal: boolean) {
    if (!preserveLocal) {
      setConversations(sessions.slice(0, MAX_CONVERSATIONS));
      return;
    }
    setConversations((prev) => {
      const sessionIds = new Set(sessions.map((session) => session.id));
      const localOnly = prev.filter((conversation) => !sessionIds.has(conversation.id));
      const mergedSessions = sessions.map((session) => {
        const existing = prev.find((conversation) => conversation.id === session.id);
        if (!existing) return session;
        return {
          ...existing,
          ...session,
          messages: session.messages.length > 0 ? session.messages : existing.messages,
        };
      });
      return [...localOnly, ...mergedSessions].slice(0, MAX_CONVERSATIONS);
    });
  }

  async function loadConversation(id: string, isCurrent = () => true) {
    const detail = await getChatSession(id);
    if (isCurrent()) mergeConversation(detail);
    return detail;
  }

  useEffect(() => {
    let mounted = true;
    const loadVersion = userMutationVersionRef.current;

    async function loadSessions() {
      try {
        const sessions = await listChatSessions();
        if (!mounted) return;
        const hasUserMutation = userMutationVersionRef.current !== loadVersion;
        mergeLoadedSessions(sessions, hasUserMutation);
        if (hasUserMutation) return;

        const stored = localStorage.getItem(ACTIVE_SESSION_KEY);
        const nextActive = stored && sessions.some((c) => c.id === stored) ? stored : sessions[0]?.id ?? null;
        rememberActive(nextActive);
        if (nextActive) {
          const detail = await getChatSession(nextActive);
          if (mounted && userMutationVersionRef.current === loadVersion) mergeConversation(detail);
        }
      } catch {
        if (mounted && userMutationVersionRef.current === loadVersion) {
          setConversations([]);
          rememberActive(null);
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    loadSessions();
    return () => {
      mounted = false;
    };
  }, []);

  async function createConversation(firstMessage?: ChatMessage): Promise<string> {
    if (!firstMessage) {
      const active = conversationsRef.current.find((conversation) => conversation.id === activeIdRef.current);
      if (active && isEmptyConversation(active)) return active.id;
      userMutationVersionRef.current += 1;
      setLoadingConversationId(null);
      rememberActive(null);
      return "";
    }

    const title = titleFromMessage(firstMessage);
    setIsCreatingConversation(true);
    try {
      const conv = await createChatSession(title);
      userMutationVersionRef.current += 1;
      const next = { ...conv, title, messages: firstMessage ? [firstMessage] : conv.messages };
      mergeConversation(next);
      rememberActive(next.id);
      return next.id;
    } finally {
      setIsCreatingConversation(false);
    }
  }

  function switchConversation(id: string) {
    if (id === activeIdRef.current) return;
    userMutationVersionRef.current += 1;
    const mutationVersion = userMutationVersionRef.current;
    const loadVersion = ++switchLoadVersionRef.current;
    rememberActive(id);
    // 切回会话时同步后台进度，不能因本地已有消息而跳过运行状态。
    setLoadingConversationId(id);
    loadConversation(id, () => switchLoadVersionRef.current === loadVersion
      && userMutationVersionRef.current === mutationVersion && activeIdRef.current === id).catch(() => {
      // 留在当前本地列表，下一次刷新会重新同步。
    }).finally(() => {
      if (switchLoadVersionRef.current === loadVersion) {
        setLoadingConversationId((current) => (current === id ? null : current));
      }
    });
  }

  function addMessage(convId: string, message: ChatMessage) {
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        const messages = [...c.messages, message];
        const title = c.messages.length === 0 && message.role === "user"
          ? message.content.slice(0, 30) + (message.content.length > 30 ? "..." : "")
          : c.title;
        return { ...c, messages, title, updatedAt: new Date().toISOString() };
      });
      return next;
    });
  }

  function updateMessage(convId: string, messageId: string, patch: Partial<ChatMessage>) {
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        return { ...c, messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)) };
      });
      return next;
    });
  }

  function updateRun(convId: string, activeRun: ChatRunSummary | null) {
    setConversations((prev) => prev.map((conversation) => (
      conversation.id === convId ? { ...conversation, activeRun } : conversation
    )));
  }

  function updateInput(convId: string, input: ChatInput) {
    if (input.session_id !== convId) return;
    setConversations((prev) => prev.map((conversation) => conversation.id === convId
      ? { ...conversation, inputs: upsertChatInput(conversation.inputs ?? [], input) }
      : conversation));
  }

  async function refreshConversation(convId: string) {
    const detail = await getChatSession(convId);
    setConversations((prev) => prev.map((conversation) => {
      if (conversation.id !== convId) return conversation;
      // 结束后同步持久化历史与下一轮运行，同时保留本地已完成回复的工具轨迹。
      const messages = detail.messages.map((message) => {
        const existing = conversation.messages.find((item) => item.id === message.id && !item.pending);
        return existing ? { ...existing, ...message } : message;
      });
      if (detail.activeRun && detail.activeRun.run_id === conversation.activeRun?.run_id) {
        messages.push(...conversation.messages.filter((message) => message.pending
          && !messages.some((loaded) => loaded.id === message.id)));
      }
      return { ...conversation, ...detail, messages,
        inputs: mergeChatInputs(conversation.inputs ?? [], detail.inputs ?? []) };
    }));
    return detail;
  }

  function deleteConversation(id: string) {
    userMutationVersionRef.current += 1;
    const isCurrent = beginConversationMutation(id);
    deletedConversationIdsRef.current.add(id);
    const remaining = conversationsRef.current.filter((c) => c.id !== id);
    setConversations((current) => current.filter((c) => c.id !== id));
    if (activeId === id) rememberActive(remaining[0]?.id ?? null);
    deleteChatSession(id).catch(() => {
      if (!isCurrent()) return;
      deletedConversationIdsRef.current.delete(id);
      loadConversation(id, isCurrent).catch(() => {
        // 删除失败时尽量恢复该会话；恢复失败说明服务端也不存在。
      });
    });
  }

  function clearMessages(convId: string) {
    userMutationVersionRef.current += 1;
    const isCurrent = beginConversationMutation(convId);
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        return { ...c, messages: [], inputs: [], activeRun: null, inputQueuePaused: false,
          title: "新对话", updatedAt: new Date().toISOString() };
      });
      return next;
    });
    clearChatSessionMessages(convId).catch(() => {
      if (!isCurrent()) return;
      loadConversation(convId, isCurrent).catch(() => {
        // 清空失败时尝试恢复最新服务端状态。
      });
    });
  }

  function clearAllConversations() {
    userMutationVersionRef.current += 1;
    const mutationVersion = userMutationVersionRef.current;
    const operation = ++clearOperationRef.current;
    const previousConversations = conversationsRef.current;
    const previousActiveId = activeIdRef.current;
    setConversations([]);
    rememberActive(null);
    deleteAllChatSessions().catch(async () => {
      // A lost response may mean the delete succeeded. Prefer fresh server truth,
      // and retain new conversations, local edits, and later explicit deletions.
      const persisted = await listChatSessions().catch(() => previousConversations);
      if (clearOperationRef.current !== operation) return;
      setConversations((current) => reconcileConversationClear({
        current, persisted, snapshot: previousConversations, deletedIds: deletedConversationIdsRef.current,
      }));
      if (userMutationVersionRef.current === mutationVersion && !activeIdRef.current) {
        rememberActive(persisted.find((item) => item.id === previousActiveId)?.id ?? persisted[0]?.id ?? null);
      }
    });
  }

  function updateTitle(convId: string, title: string) {
    userMutationVersionRef.current += 1;
    const isCurrent = beginConversationMutation(convId);
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        return { ...c, title, updatedAt: new Date().toISOString() };
      });
      return next;
    });
    updateChatSessionTitle(convId, title).then((conv) => {
      if (!isCurrent()) return;
      // A title acknowledgement owns only title metadata, never streamed messages or run state.
      setConversations((current) => current.map((item) => item.id === convId
        ? { ...item, title: conv.title, updatedAt: conv.updatedAt } : item));
    }).catch(() => {
      // 标题同步失败不影响当前对话。
    });
  }

  return {
    conversations,
    activeId,
    activeConversation,
    isLoading,
    isCreatingConversation,
    isActiveConversationLoading: activeId != null && loadingConversationId === activeId,
    createConversation,
    switchConversation,
    addMessage,
    updateMessage,
    updateRun,
    updateInput,
    refreshConversation,
    updateTitle,
    deleteConversation,
    clearMessages,
    clearAllConversations,
  };
}


export type ChatHistoryState = ReturnType<typeof useConversations>;
