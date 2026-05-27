const THINKING_MODE_STORAGE_KEY = "stocks-assistant-chat-thinking-enabled";

export function readChatThinkingEnabled(): boolean {
  try {
    return window.localStorage.getItem(THINKING_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function persistChatThinkingEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(THINKING_MODE_STORAGE_KEY, String(enabled));
  } catch {
    // 浏览器禁用本地存储时，保留当前页面内状态即可。
  }
}

export function resetChatThinkingEnabled() {
  persistChatThinkingEnabled(false);
}
