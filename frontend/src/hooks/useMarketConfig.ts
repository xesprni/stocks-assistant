import { useToast } from "@/components/common/Toast";
import { getMessages, type AppLanguage } from "@/i18n";
import { getMarketConfig, saveMarketConfig } from "@/lib/api";
import type { ConfigSaveState } from "@/lib/config-autosave";
import { createMarketConfigController, type MarketConfigEditor } from "@/lib/market-config-controller";
import type { MarketDashboardConfig } from "@/types/app";
import { useEffect, useRef, useState } from "react";

export function useMarketConfig(language: AppLanguage, canRead: boolean, canWrite: boolean) {
  const { showToast } = useToast();
  const [config, setConfig] = useState<MarketDashboardConfig | null>(null);
  const [savedConfig, setSavedConfig] = useState<MarketDashboardConfig | null>(null);
  const [saveState, setSaveState] = useState<ConfigSaveState>("idle");
  const controllerRef = useRef<ReturnType<typeof createMarketConfigController> | null>(null);
  const feedbackRef = useRef({ language, showToast });
  feedbackRef.current = { language, showToast };

  useEffect(() => {
    if (!canRead) return;
    const notify = (kind: "success" | "error", error?: unknown, loading = false) => {
      const { language, showToast } = feedbackRef.current;
      const copy = getMessages(language).marketConfig;
      showToast({
        kind, title: copy.title, message: kind === "success" ? copy.saved
          : error instanceof Error ? error.message : loading ? copy.loadFailed : copy.saveFailed
      });
    };
    const controller = createMarketConfigController({
      persist: saveMarketConfig,
      onDraft: setConfig,
      onSaved: setSavedConfig,
      onState: setSaveState,
      onSuccess: () => notify("success"),
      onError: (error) => notify("error", error),
    });
    controllerRef.current = controller;
    let active = true;
    void getMarketConfig().then((result) => {
      if (active) controller.acceptSaved(result);
    }).catch((error) => { if (active) notify("error", error, true); });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!controller.isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      active = false;
      controller.dispose();
      window.removeEventListener("beforeunload", beforeUnload);
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [canRead]);

  const editor: MarketConfigEditor = {
    config, saveState,
    onPatch: (patch) => { if (canWrite) controllerRef.current?.patch(patch); },
    onSave: () => { if (canWrite) void controllerRef.current?.flush(); },
  };
  return { editor, savedConfig, reset: () => controllerRef.current?.reset() };
}
