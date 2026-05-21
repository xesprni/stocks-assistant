import type { AppConfig, ConfigDraft } from "@/types/app";

export function toDraft(config: AppConfig): ConfigDraft {
  return {
    ...config,
    llm_api_key: "",
    embedding_api_key: "",
    telegram_bot_token: "",
    telegram_chat_id: config.telegram_chat_id ?? "",
    telegram_api_base: config.telegram_api_base ?? "https://api.telegram.org",
    telegram_parse_mode: config.telegram_parse_mode ?? "",
    longbridge_app_key: "",
    longbridge_app_secret: "",
    longbridge_access_token: "",
    longbridge_http_url: config.longbridge_http_url ?? "",
    longbridge_quote_ws_url: config.longbridge_quote_ws_url ?? "",
    agent_tool_allowlist: config.agent_tool_allowlist ?? [],
    agent_allow_all_mcp_tools: config.agent_allow_all_mcp_tools ?? true,
    mcp_servers_text: JSON.stringify(config.mcp_servers ?? {}, null, 2),
    mcp_tool_timeout_seconds: config.mcp_tool_timeout_seconds ?? 60,
  };
}
