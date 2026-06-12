import { useEffect, useMemo, useRef, useState } from "react";

import { clearChatSessionMessages, createChatSession, deleteAllChatSessions, deleteChatSession, getChatSession, listChatSessions, updateChatSessionTitle } from "@/lib/api";
import type { ChatMessage, Conversation } from "@/types/app";

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
  const userMutationVersionRef = useRef(0);
  const conversationsRef = useRef<Conversation[]>([]);
  const activeIdRef = useRef<string | null>(activeId);
  const pendingEmptyConversationRef = useRef<Promise<string> | null>(null);

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

  async function loadConversation(id: string) {
    const detail = await getChatSession(id);
    mergeConversation(detail);
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
      if (pendingEmptyConversationRef.current) return pendingEmptyConversationRef.current;
    }

    const title = titleFromMessage(firstMessage);
    const createRequest = (async () => {
      const conv = await createChatSession(title);
      userMutationVersionRef.current += 1;
      const next = { ...conv, title, messages: firstMessage ? [firstMessage] : conv.messages };
      mergeConversation(next);
      rememberActive(next.id);
      return next.id;
    })();

    if (firstMessage) {
      return createRequest;
    }

    pendingEmptyConversationRef.current = createRequest;
    setIsCreatingConversation(true);
    try {
      return await createRequest;
    } finally {
      if (pendingEmptyConversationRef.current === createRequest) {
        pendingEmptyConversationRef.current = null;
        setIsCreatingConversation(false);
      }
    }
  }

  function switchConversation(id: string) {
    userMutationVersionRef.current += 1;
    rememberActive(id);
    const conv = conversations.find((c) => c.id === id);
    if (!conv || conv.messages.length === 0) {
      loadConversation(id).catch(() => {
        // 留在当前本地列表，下一次刷新会重新同步。
      });
    }
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

  function deleteConversation(id: string) {
    userMutationVersionRef.current += 1;
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    if (activeId === id) rememberActive(remaining[0]?.id ?? null);
    deleteChatSession(id).catch(() => {
      loadConversation(id).catch(() => {
        // 删除失败时尽量恢复该会话；恢复失败说明服务端也不存在。
      });
    });
  }

  function clearMessages(convId: string) {
    userMutationVersionRef.current += 1;
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        return { ...c, messages: [], title: "新对话", updatedAt: new Date().toISOString() };
      });
      return next;
    });
    clearChatSessionMessages(convId).catch(() => {
      loadConversation(convId).catch(() => {
        // 清空失败时尝试恢复最新服务端状态。
      });
    });
  }

  function clearAllConversations() {
    userMutationVersionRef.current += 1;
    const previousConversations = conversations;
    const previousActiveId = activeId;
    setConversations([]);
    rememberActive(null);
    deleteAllChatSessions().catch(() => {
      setConversations(previousConversations);
      rememberActive(previousActiveId);
    });
  }

  function updateTitle(convId: string, title: string) {
    userMutationVersionRef.current += 1;
    setConversations((prev) => {
      const next = prev.map((c) => {
        if (c.id !== convId) return c;
        return { ...c, title, updatedAt: new Date().toISOString() };
      });
      return next;
    });
    updateChatSessionTitle(convId, title).then((conv) => mergeConversation(conv, true)).catch(() => {
      // 标题同步失败不影响当前对话。
    });
  }

  return {
    conversations,
    activeId,
    activeConversation,
    isLoading,
    isCreatingConversation,
    createConversation,
    switchConversation,
    addMessage,
    updateMessage,
    updateTitle,
    deleteConversation,
    clearMessages,
    clearAllConversations,
  };
}


export type ChatHistoryState = ReturnType<typeof useConversations>;
