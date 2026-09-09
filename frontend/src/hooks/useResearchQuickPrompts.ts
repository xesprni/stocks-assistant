import { useEffect, useRef, useState } from "react";

import { getResearchQuickPrompts } from "@/lib/api";
import type { AppLanguage } from "@/lib/i18n";
import type { ResearchQuickPromptsResponse } from "@/types/app";

interface QuickPromptsState {
  owner: string;
  data: ResearchQuickPromptsResponse | null;
  error: string | null;
  loading: boolean;
}

export function useResearchQuickPrompts({
  enabled,
  language,
  userId,
  refreshIntervalSeconds,
}: {
  enabled: boolean;
  language: AppLanguage;
  userId: string;
  refreshIntervalSeconds: number;
}) {
  const owner = `${userId}:${language}`;
  const [state, setState] = useState<QuickPromptsState | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled || !userId) return;
    let active = true;
    let inFlight = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule(delay: number) {
      clearTimeout(timer);
      if (active && document.visibilityState !== "hidden") {
        timer = setTimeout(() => void load(false), Math.max(1000, delay));
      }
    }

    async function load(forceRefresh: boolean) {
      if (!active || inFlight || document.visibilityState === "hidden") return;
      clearTimeout(timer);
      inFlight = true;
      setState((current) => ({
        owner,
        data: current?.owner === owner ? current.data : null,
        error: null,
        loading: true,
      }));
      try {
        const result = await getResearchQuickPrompts(language, forceRefresh);
        if (!active) return;
        setState({ owner, data: result, error: result.error, loading: false });
        const expiresAt = result.expires_at ? Date.parse(result.expires_at) : NaN;
        // 过期缓存或失败至少等待一分钟再重试，避免模型不可用时连续请求。
        schedule(result.stale || result.error
          ? 60_000
          : Number.isFinite(expiresAt) ? expiresAt - Date.now() : refreshIntervalSeconds * 1000);
      } catch (error) {
        if (!active) return;
        setState((current) => ({
          owner,
          data: current?.owner === owner ? current.data : null,
          error: error instanceof Error ? error.message : "",
          loading: false,
        }));
        schedule(60_000);
      } finally {
        inFlight = false;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") clearTimeout(timer);
      else void load(false);
    }

    refreshRef.current = () => void load(true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void load(false);
    return () => {
      // 用户、语言、会话可见性变化后，旧请求不能覆盖当前推荐。
      active = false;
      clearTimeout(timer);
      refreshRef.current = null;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, language, owner, refreshIntervalSeconds, userId]);

  const current = state?.owner === owner ? state : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: enabled && (!current || current.loading),
    refresh: () => refreshRef.current?.(),
  };
}
