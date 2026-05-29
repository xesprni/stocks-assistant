import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, CircleDot, Cpu, ExternalLink, Eye, Loader2, Pencil, Plug, Plus, RefreshCw, Save, Settings2, TerminalSquare, Trash2, X, Zap } from "lucide-react";

import { Field } from "@/components/common/Field";
import { SideDrawer } from "@/components/common/SideDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { deleteMcpOAuth, getMcpStatus, getMcpTools, loadConfig, reconnectMcpServers, saveConfig, startMcpOAuthAuthorization } from "@/lib/api";
import { formatTemplate } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import { parseJsonObject } from "@/lib/json";
import { cn } from "@/lib/utils";
import type { MCPServerStatus, MCPToolInfo } from "@/types/app";

// ── MCP Servers Management ──────────────────────────────────────────────────────

const mcpPageCopy = {
  zh: {
    title: "MCP 服务器",
    subtitle: "Model Context Protocol 工具服务器管理与连接状态",
    toolTimeout: "工具超时（秒）",
    loadFailed: "加载 MCP 配置失败",
    saveFailed: "保存失败",
    servers: "MCP 服务器",
    serverCount: "{count} 台服务器",
    refresh: "刷新",
    reconnect: "重连",
    add: "添加",
    addServer: "添加 MCP 服务器",
    editServer: "编辑 MCP 服务器",
    formMode: "表单模式",
    jsonMode: "JSON 模式",
    serverName: "服务器名称",
    transport: "传输方式",
    bearerToken: "Bearer Token（可选）",
    headers: "Headers（可选，每行 key: value 或 JSON 对象）",
    args: "Args（空格分隔）",
    authToken: "Auth Token（写入 MCP_AUTH_TOKEN，可选）",
    env: "Env（可选，每行 key: value 或 JSON 对象）",
    jsonHint: '粘贴 JSON，格式：{"server-name": {"transport": "streamable_http", "url": "https://example.com/mcp"}}；stdio 使用 command/args/env。',
    cancel: "取消",
    save: "保存",
    nameRequired: "请输入服务器名称",
    nameExists: "该名称已存在",
    httpUrlRequired: "HTTP/SSE 模式需要填写 URL",
    stdioCommandRequired: "stdio 模式需要填写 command",
    configFormatError: "配置格式错误",
    mcpConfigFormatError: "MCP 配置格式错误",
    jsonSyntaxError: "JSON 格式错误，请检查语法",
    invalidTransport: "transport 只支持 streamable_http、sse 或 stdio",
    stringValueRequired: "{label}.{key} 必须是字符串",
    mapLineFormat: "{label} 每行格式应为 key: value",
    objectRequired: 'JSON 必须是对象，如 {"server-name": {"transport": "streamable_http", "url": "https://example.com/mcp"}}',
    invalidServerName: '服务器名称 "{name}" 只能包含字母、数字、下划线和连字符',
    serverConfigObjectRequired: "{name} 的配置必须是对象",
    commandRequired: "{name} 的 stdio 配置需要 command",
    argsArrayRequired: "{name} 的 args 必须是字符串数组",
    urlRequired: "{name} 的 {transport} 配置需要 http(s) URL",
    headersObjectRequired: "{name} 的 headers 必须是对象",
    envObjectRequired: "{name} 的 env 必须是对象",
    enabledBooleanRequired: "{name} 的 enabled 必须是布尔值",
    unsaved: "unsaved",
    connecting: "connecting",
    authRequired: "login required",
    connected: "connected",
    error: "error",
    disconnected: "disconnected",
    disabled: "disabled",
    enabledState: "ON",
    disabledState: "OFF",
    enableServer: "启用服务器",
    disableServer: "停用服务器",
    tools: "tools",
    unconfiguredUrl: "未配置 URL",
    draftOnly: "配置只在当前草稿中，尚未保存到 SQLite。",
    login: "登录",
    relogin: "重新登录",
    viewTools: "查看工具",
    editAction: "编辑服务器",
    deleteAction: "删除服务器",
    oauthStartFailed: "启动 MCP 登录失败",
    noServers: "暂无 MCP 服务器",
    noServersHint: "点击上方添加按钮新增 MCP 服务器配置。",
    toolsTitle: "{server} - Tools",
    toolsAvailable: "{count} tools available",
    parameters: "Parameters",
    required: "required",
    noTools: "未发现工具。服务器可能未连接或尚未注册工具。",
    rawJson: "Raw JSON",
  },
  en: {
    title: "MCP Servers",
    subtitle: "Model Context Protocol tool server management and connection status",
    toolTimeout: "Tool timeout (seconds)",
    loadFailed: "Failed to load MCP config",
    saveFailed: "Save failed",
    servers: "MCP Servers",
    serverCount: "{count} servers",
    refresh: "Refresh",
    reconnect: "Reconnect",
    add: "Add",
    addServer: "Add MCP Server",
    editServer: "Edit MCP Server",
    formMode: "Form mode",
    jsonMode: "JSON mode",
    serverName: "Server name",
    transport: "Transport",
    bearerToken: "Bearer token (optional)",
    headers: "Headers (optional, one key: value per line or JSON object)",
    args: "Args (space-separated)",
    authToken: "Auth token (saved to MCP_AUTH_TOKEN, optional)",
    env: "Env (optional, one key: value per line or JSON object)",
    jsonHint: 'Paste JSON such as {"server-name": {"transport": "streamable_http", "url": "https://example.com/mcp"}}; stdio uses command/args/env.',
    cancel: "Cancel",
    save: "Save",
    nameRequired: "Enter a server name",
    nameExists: "That name already exists",
    httpUrlRequired: "HTTP/SSE mode requires a URL",
    stdioCommandRequired: "stdio mode requires a command",
    configFormatError: "Invalid config format",
    mcpConfigFormatError: "Invalid MCP config format",
    jsonSyntaxError: "Invalid JSON syntax",
    invalidTransport: "transport only supports streamable_http, sse, or stdio",
    stringValueRequired: "{label}.{key} must be a string",
    mapLineFormat: "{label} lines must use key: value",
    objectRequired: 'JSON must be an object, e.g. {"server-name": {"transport": "streamable_http", "url": "https://example.com/mcp"}}',
    invalidServerName: 'Server name "{name}" can only contain letters, numbers, underscores, and hyphens',
    serverConfigObjectRequired: "{name} config must be an object",
    commandRequired: "{name} stdio config requires command",
    argsArrayRequired: "{name} args must be a string array",
    urlRequired: "{name} {transport} config requires an http(s) URL",
    headersObjectRequired: "{name} headers must be an object",
    envObjectRequired: "{name} env must be an object",
    enabledBooleanRequired: "{name} enabled must be a boolean",
    unsaved: "unsaved",
    connecting: "connecting",
    authRequired: "login required",
    connected: "connected",
    error: "error",
    disconnected: "disconnected",
    disabled: "disabled",
    enabledState: "ON",
    disabledState: "OFF",
    enableServer: "Enable server",
    disableServer: "Disable server",
    tools: "tools",
    unconfiguredUrl: "No URL configured",
    draftOnly: "This config only exists in the current draft and has not been saved to SQLite.",
    login: "Login",
    relogin: "Re-login",
    viewTools: "View tools",
    editAction: "Edit server",
    deleteAction: "Delete server",
    oauthStartFailed: "Failed to start MCP login",
    noServers: "No MCP servers",
    noServersHint: "Click Add above to add an MCP server config.",
    toolsTitle: "{server} - Tools",
    toolsAvailable: "{count} tools available",
    parameters: "Parameters",
    required: "required",
    noTools: "No tools found. The server may be disconnected or has not registered tools yet.",
    rawJson: "Raw JSON",
  },
} as const;

type McpPageCopy = (typeof mcpPageCopy)[AppLanguage];

export function MCPPage({ language }: { language: AppLanguage }) {
  const copy = mcpPageCopy[language];
  const [mcpServersText, setMcpServersText] = useState("{}");
  const [toolTimeoutSeconds, setToolTimeoutSeconds] = useState(60);
  const [isSavingTimeout, setIsSavingTimeout] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadConfig()
      .then((cfg) => {
        setMcpServersText(JSON.stringify(cfg.mcp_servers ?? {}, null, 2));
        setToolTimeoutSeconds(cfg.mcp_tool_timeout_seconds ?? 60);
      })
      .catch((e) => setError(e instanceof Error ? e.message : copy.loadFailed));
  }, []);

  async function handleServersChange(updated: Record<string, Record<string, unknown>>) {
    setError("");
    try {
      const next = await saveConfig({ mcp_servers: updated });
      setMcpServersText(JSON.stringify(next.mcp_servers ?? {}, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.saveFailed);
    }
  }

  async function handleSaveTimeout() {
    setError("");
    setIsSavingTimeout(true);
    try {
      const timeout = Math.max(1, Number(toolTimeoutSeconds) || 60);
      const next = await saveConfig({ mcp_tool_timeout_seconds: timeout });
      setToolTimeoutSeconds(next.mcp_tool_timeout_seconds ?? timeout);
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.saveFailed);
    } finally {
      setIsSavingTimeout(false);
    }
  }

  return (
    <section className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Plug className="size-5 text-primary" />
            <p className="font-semibold">{copy.title}</p>
          </div>
          <p className="text-xs text-muted-foreground">{copy.subtitle}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label={copy.toolTimeout}>
            <Input
              className="w-32"
              min={1}
              type="number"
              value={toolTimeoutSeconds}
              onChange={(event) => setToolTimeoutSeconds(Number(event.target.value))}
            />
          </Field>
          <Button size="sm" variant="outline" onClick={handleSaveTimeout} disabled={isSavingTimeout}>
            {isSavingTimeout ? <Loader2 className="animate-spin" /> : <Save />}
            {copy.save}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="panel-body min-h-0 flex-1 lg:overflow-y-auto">
        <MCPServersPanel copy={copy} mcpServersText={mcpServersText} setMcpServersText={setMcpServersText} onServersChange={handleServersChange} />
      </div>
    </section>
  );
}

interface MCPServersPanelProps {
  copy: McpPageCopy;
  mcpServersText: string;
  setMcpServersText: (text: string) => void;
  onServersChange?: (servers: Record<string, Record<string, unknown>>) => void | Promise<void>;
}

type MCPTransport = "streamable_http" | "sse" | "stdio";

const emptyMcpAddForm = {
  name: "",
  transport: "streamable_http" as MCPTransport,
  url: "",
  command: "",
  args: "",
  headers: "",
  authToken: "",
  env: "",
};

function MCPServersPanel({ copy, mcpServersText, setMcpServersText, onServersChange }: MCPServersPanelProps) {
  const [serverStatuses, setServerStatuses] = useState<MCPServerStatus[]>([]);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingServerName, setEditingServerName] = useState<string | null>(null);
  const [showToolsFor, setShowToolsFor] = useState<string | null>(null);
  const [toolsData, setToolsData] = useState<MCPToolInfo[]>([]);
  const [isLoadingTools, setIsLoadingTools] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const [addMode, setAddMode] = useState<"form" | "json">("form");
  const [addForm, setAddForm] = useState(emptyMcpAddForm);
  const [addJson, setAddJson] = useState("");
  const [addError, setAddError] = useState("");
  const [oauthError, setOauthError] = useState("");

  function parseMcpServers(text: string): Record<string, Record<string, unknown>> {
    try {
      return parseJsonObject(text || "{}", "MCP Servers JSON") as Record<string, Record<string, unknown>>;
    } catch {
      return {};
    }
  }

  const servers = parseMcpServers(mcpServersText);

  function normalizeMcpTransport(value: unknown, config: Record<string, unknown>): MCPTransport {
    if (value == null || value === "") return config.command ? "stdio" : "streamable_http";
    if (value === "http" || value === "streamable-http" || value === "streamable_http") return "streamable_http";
    if (value === "sse") return "sse";
    if (value === "stdio") return "stdio";
    throw new Error(copy.invalidTransport);
  }

  function parseStringMap(text: string, label: string) {
    const trimmed = text.trim();
    const result: Record<string, string> = {};
    if (!trimmed) return result;
    if (trimmed.startsWith("{")) {
      const parsed = parseJsonObject(trimmed, label);
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== "string") throw new Error(formatTemplate(copy.stringValueRequired, { label, key }));
        result[key] = value;
      }
      return result;
    }
    for (const line of trimmed.split("\n")) {
      if (!line.trim()) continue;
      const idx = line.indexOf(":");
      if (idx <= 0) throw new Error(formatTemplate(copy.mapLineFormat, { label }));
      result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    return result;
  }

  function validateMcpServersConfig(input: unknown) {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new Error(copy.objectRequired);
    }
    const normalized: Record<string, Record<string, unknown>> = {};
    for (const [name, rawConfig] of Object.entries(input)) {
      if (!/^[A-Za-z0-9_-]+$/.test(name)) {
        throw new Error(formatTemplate(copy.invalidServerName, { name }));
      }
      if (typeof rawConfig !== "object" || rawConfig === null || Array.isArray(rawConfig)) {
        throw new Error(formatTemplate(copy.serverConfigObjectRequired, { name }));
      }
      const config = { ...(rawConfig as Record<string, unknown>) };
      const transport = normalizeMcpTransport(config.transport, config);
      config.transport = transport;
      if (transport === "stdio") {
        if (typeof config.command !== "string" || !config.command.trim()) {
          throw new Error(formatTemplate(copy.commandRequired, { name }));
        }
        if (typeof config.args === "string") {
          config.args = config.args.trim() ? config.args.trim().split(/\s+/) : [];
        }
        if (config.args != null && !Array.isArray(config.args)) {
          throw new Error(formatTemplate(copy.argsArrayRequired, { name }));
        }
        if (Array.isArray(config.args) && !config.args.every((item) => typeof item === "string")) {
          throw new Error(formatTemplate(copy.argsArrayRequired, { name }));
        }
      } else if (typeof config.url !== "string" || !/^https?:\/\/.+/i.test(config.url)) {
        throw new Error(formatTemplate(copy.urlRequired, { name, transport }));
      }
      if (config.headers != null && (typeof config.headers !== "object" || Array.isArray(config.headers))) {
        throw new Error(formatTemplate(copy.headersObjectRequired, { name }));
      }
      if (config.env != null && (typeof config.env !== "object" || Array.isArray(config.env))) {
        throw new Error(formatTemplate(copy.envObjectRequired, { name }));
      }
      if (config.enabled != null && typeof config.enabled !== "boolean") {
        throw new Error(formatTemplate(copy.enabledBooleanRequired, { name }));
      }
      config.enabled = config.enabled !== false;
      normalized[name] = config;
    }
    return normalized;
  }

  function loadStatus() {
    setOauthError("");
    setIsLoadingStatus(true);
    getMcpStatus()
      .then((res) => setServerStatuses(res.servers))
      .catch(() => setServerStatuses([]))
      .finally(() => setIsLoadingStatus(false));
  }

  function reconnectServers() {
    setOauthError("");
    setIsLoadingStatus(true);
    reconnectMcpServers()
      .then((res) => setServerStatuses(res.servers))
      .catch(() => setServerStatuses([]))
      .finally(() => setIsLoadingStatus(false));
  }

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    const hasPendingServer = serverStatuses.some((status) => status.status === "connecting" || status.status === "auth_required");
    if (!hasPendingServer) return;
    const timer = window.setInterval(loadStatus, 3000);
    return () => window.clearInterval(timer);
  }, [serverStatuses]);

  function handleViewTools(serverName: string) {
    setShowToolsFor(serverName);
    setIsLoadingTools(true);
    setToolsData([]);
    getMcpTools(serverName)
      .then((res) => setToolsData(res.tools))
      .catch(() => setToolsData([]))
      .finally(() => setIsLoadingTools(false));
  }

  async function syncServersToDraft(updated: Record<string, Record<string, unknown>>) {
    setMcpServersText(JSON.stringify(updated, null, 2));
    await onServersChange?.(updated);
    window.setTimeout(loadStatus, 300);
  }

  function handleToggleServer(name: string, enabled: boolean) {
    const current = servers[name];
    if (!current) return;
    const updated = validateMcpServersConfig({
      ...servers,
      [name]: { ...current, enabled },
    });
    syncServersToDraft(updated);
    if (!enabled && showToolsFor === name) {
      setShowToolsFor(null);
    }
  }

  function handleDeleteServer(name: string) {
    const updated = { ...servers };
    delete updated[name];
    syncServersToDraft(updated);
    deleteMcpOAuth(name).catch(() => {});
  }

  function closeServerDrawer() {
    setShowAddForm(false);
    setEditingServerName(null);
    setAddError("");
  }

  function openAddServerDrawer() {
    setEditingServerName(null);
    setAddMode("form");
    setAddForm(emptyMcpAddForm);
    setAddJson("");
    setAddError("");
    setShowAddForm(true);
  }

  function stringifyStringMap(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    return Object.entries(value as Record<string, string>)
      .map(([key, mapValue]) => `${key}: ${mapValue}`)
      .join("\n");
  }

  function openEditServerDrawer(name: string, config: Record<string, unknown>) {
    const transport = normalizeMcpTransport(config.transport, config);
    const auth = config.auth && typeof config.auth === "object" ? config.auth as Record<string, unknown> : null;
    const env = config.env && typeof config.env === "object" ? config.env as Record<string, string> : {};
    setEditingServerName(name);
    setAddMode("form");
    setAddForm({
      name,
      transport,
      url: typeof config.url === "string" ? config.url : "",
      command: typeof config.command === "string" ? config.command : "",
      args: Array.isArray(config.args) ? config.args.filter((item) => typeof item === "string").join(" ") : "",
      headers: stringifyStringMap(config.headers),
      authToken: typeof auth?.token === "string" ? auth.token : env.MCP_AUTH_TOKEN ?? "",
      env: stringifyStringMap(config.env),
    });
    setAddJson("");
    setAddError("");
    setShowAddForm(true);
  }

  function handleAddFromForm() {
    setAddError("");
    const name = addForm.name.trim();
    if (!name) {
      setAddError(copy.nameRequired);
      return;
    }
    if (servers[name] && name !== editingServerName) {
      setAddError(copy.nameExists);
      return;
    }

    const existingConfig = editingServerName ? servers[editingServerName] : null;
    const config: Record<string, unknown> = {
      transport: addForm.transport,
      enabled: existingConfig?.enabled !== false,
    };
    if (addForm.transport === "streamable_http" || addForm.transport === "sse") {
      if (!addForm.url.trim()) {
        setAddError(copy.httpUrlRequired);
        return;
      }
      config.url = addForm.url.trim();
    } else {
      if (!addForm.command.trim()) {
        setAddError(copy.stdioCommandRequired);
        return;
      }
      config.command = addForm.command.trim();
      if (addForm.args.trim()) {
        config.args = addForm.args.trim().split(/\s+/);
      }
    }

    try {
      const headers = parseStringMap(addForm.headers, "Headers");
      if (Object.keys(headers).length > 0) {
        config.headers = headers;
      }
      const env = parseStringMap(addForm.env, "Env");
      if (Object.keys(env).length > 0) {
        config.env = env;
      }
    } catch (error) {
      setAddError(error instanceof Error ? error.message : copy.configFormatError);
      return;
    }

    if (addForm.authToken.trim()) {
      if (addForm.transport === "stdio") {
        config.env = {
          ...((config.env as Record<string, string> | undefined) ?? {}),
          MCP_AUTH_TOKEN: addForm.authToken.trim(),
        };
      } else {
        config.auth = { type: "bearer", token: addForm.authToken.trim() };
      }
    }

    let updated: Record<string, Record<string, unknown>>;
    const renamedFrom = editingServerName && editingServerName !== name ? editingServerName : null;
    try {
      const nextServers = { ...servers };
      if (renamedFrom) {
        delete nextServers[renamedFrom];
      }
      updated = validateMcpServersConfig({ ...nextServers, [name]: config });
    } catch (error) {
      setAddError(error instanceof Error ? error.message : copy.mcpConfigFormatError);
      return;
    }
    syncServersToDraft(updated);
    if (renamedFrom) deleteMcpOAuth(renamedFrom).catch(() => {});
    setAddForm(emptyMcpAddForm);
    closeServerDrawer();
  }

  function handleAddFromJson() {
    setAddError("");
    try {
      const parsed = parseJsonObject(addJson, "MCP JSON");
      const normalized = validateMcpServersConfig(parsed);
      const updated = validateMcpServersConfig({ ...servers, ...normalized });
      syncServersToDraft(updated);
      setAddJson("");
      closeServerDrawer();
    } catch (error) {
      setAddError(error instanceof Error ? error.message : copy.jsonSyntaxError);
    }
  }

  async function startOAuthLogin(serverName: string) {
    setOauthError("");
    const popup = window.open("about:blank", "_blank");
    if (popup) {
      popup.opener = null;
    }
    try {
      const response = await startMcpOAuthAuthorization(serverName);
      if (popup) {
        popup.location.href = response.authorization_url;
      } else {
        window.open(response.authorization_url, "_blank", "noopener,noreferrer");
      }
      loadStatus();
    } catch (error) {
      if (popup) popup.close();
      setOauthError(error instanceof Error ? error.message : copy.oauthStartFailed);
    }
  }

  function maskConfigValue(key: string, value: string) {
    if (!/(authorization|token|secret|password|api-?key|key)/i.test(key)) return value;
    if (value.length <= 8) return "*".repeat(value.length);
    return `${value.slice(0, 4)}********${value.slice(-4)}`;
  }

  const statusMap = new Map(serverStatuses.map((s) => [s.name, s]));

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{copy.servers}</p>
          <Badge variant="outline">{formatTemplate(copy.serverCount, { count: Object.keys(servers).length })}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={loadStatus} disabled={isLoadingStatus}>
            {isLoadingStatus ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {copy.refresh}
          </Button>
          <Button variant="outline" size="sm" onClick={reconnectServers} disabled={isLoadingStatus}>
            <Zap />
            {copy.reconnect}
          </Button>
          <Button size="sm" onClick={openAddServerDrawer} disabled={showAddForm}>
            <Plus />
            {copy.add}
          </Button>
        </div>
      </div>

      {oauthError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {oauthError}
        </div>
      ) : null}

      <SideDrawer
        open={showAddForm}
        title={editingServerName ? copy.editServer : copy.addServer}
        subtitle={copy.subtitle}
        onClose={closeServerDrawer}
        cancelText={copy.cancel}
        formId="mcp-server-form"
        saveText={copy.save}
      >
        <form
          id="mcp-server-form"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (addMode === "form") handleAddFromForm();
            else handleAddFromJson();
          }}
        >
          <div className="flex rounded-md border border-border/80 bg-muted/40 p-1">
            <button
              className={cn(
                "h-7 rounded-sm px-3 text-xs font-medium transition-all",
                addMode === "form" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setAddMode("form")}
              type="button"
            >
              {copy.formMode}
            </button>
            {!editingServerName ? (
              <button
                className={cn(
                  "h-7 rounded-sm px-3 text-xs font-medium transition-all",
                  addMode === "json" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setAddMode("json")}
                type="button"
              >
                {copy.jsonMode}
              </button>
            ) : null}
          </div>

          {addMode === "form" ? (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={copy.serverName}>
                  <Input
                    placeholder="my-server"
                    value={addForm.name}
                    onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  />
                </Field>
                <Field label={copy.transport}>
                  <div className="flex rounded-md border border-border/80 bg-muted/40 p-1">
                    <button
                      className={cn(
                        "h-7 flex-1 rounded-sm text-xs font-medium transition-all",
                        addForm.transport === "streamable_http" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                      )}
                      onClick={() => setAddForm((f) => ({ ...f, transport: "streamable_http" }))}
                      type="button"
                    >
                      HTTP
                    </button>
                    <button
                      className={cn(
                        "h-7 flex-1 rounded-sm text-xs font-medium transition-all",
                        addForm.transport === "sse" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                      )}
                      onClick={() => setAddForm((f) => ({ ...f, transport: "sse" }))}
                      type="button"
                    >
                      SSE
                    </button>
                    <button
                      className={cn(
                        "h-7 flex-1 rounded-sm text-xs font-medium transition-all",
                        addForm.transport === "stdio" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                      )}
                      onClick={() => setAddForm((f) => ({ ...f, transport: "stdio" }))}
                      type="button"
                    >
                      stdio
                    </button>
                  </div>
                </Field>
              </div>
              {addForm.transport === "streamable_http" || addForm.transport === "sse" ? (
                <>
                  <Field label="URL">
                    <Input
                      placeholder={addForm.transport === "streamable_http" ? "https://example.com/mcp" : "http://localhost:3001/sse"}
                      value={addForm.url}
                      onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value }))}
                    />
                  </Field>
                  <Field label={copy.bearerToken}>
                    <Input
                      type="password"
                      placeholder="OAuth access token"
                      value={addForm.authToken}
                      onChange={(e) => setAddForm((f) => ({ ...f, authToken: e.target.value }))}
                    />
                  </Field>
                  <Field label={copy.headers}>
                    <Textarea
                      className="min-h-[60px] font-mono text-xs"
                      spellCheck={false}
                      placeholder={"Authorization: Bearer token123\nX-Custom-Header: value"}
                      value={addForm.headers}
                      onChange={(e) => setAddForm((f) => ({ ...f, headers: e.target.value }))}
                    />
                  </Field>
                </>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Command">
                    <Input
                      placeholder="npx"
                      value={addForm.command}
                      onChange={(e) => setAddForm((f) => ({ ...f, command: e.target.value }))}
                    />
                  </Field>
                  <Field label={copy.args}>
                    <Input
                      placeholder="-y @modelcontextprotocol/server-memory"
                      value={addForm.args}
                      onChange={(e) => setAddForm((f) => ({ ...f, args: e.target.value }))}
                    />
                  </Field>
                  <Field label={copy.authToken}>
                    <Input
                      type="password"
                      placeholder="stdio server token"
                      value={addForm.authToken}
                      onChange={(e) => setAddForm((f) => ({ ...f, authToken: e.target.value }))}
                    />
                  </Field>
                  <Field label={copy.env}>
                    <Textarea
                      className="min-h-[60px] font-mono text-xs"
                      spellCheck={false}
                      placeholder={"API_KEY: token123\nBASE_URL: https://example.com"}
                      value={addForm.env}
                      onChange={(e) => setAddForm((f) => ({ ...f, env: e.target.value }))}
                    />
                  </Field>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{copy.jsonHint}</p>
              <Textarea
                className="min-h-[120px] font-mono text-xs"
                spellCheck={false}
                placeholder={'{\n  "longbridge": {\n    "transport": "streamable_http",\n    "url": "https://openapi.longbridge.com/mcp"\n  },\n  "remote": {\n    "transport": "streamable_http",\n    "url": "https://example.com/mcp",\n    "auth": { "type": "bearer", "token": "..." }\n  },\n  "oauth-client": {\n    "transport": "streamable_http",\n    "url": "https://example.com/mcp",\n    "auth": {\n      "type": "oauth_client_credentials",\n      "token_url": "https://example.com/oauth/token",\n      "client_id": "...",\n      "client_secret": "...",\n      "scope": "search"\n    }\n  },\n  "local": {\n    "transport": "stdio",\n    "command": "npx",\n    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]\n  }\n}'}
                value={addJson}
                onChange={(e) => setAddJson(e.target.value)}
              />
            </div>
          )}

          {addError ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {addError}
            </div>
          ) : null}
        </form>
      </SideDrawer>

      {/* Server list */}
      {Object.keys(servers).length > 0 ? (
        <div className="space-y-2">
          {Object.entries(servers).map(([name, config]) => {
            const status = statusMap.get(name);
            const enabled = status?.enabled ?? config.enabled !== false;
            const transport = String(config.transport || (config.command ? "stdio" : "streamable_http"));
            const statusColor =
              !enabled
                ? "text-muted-foreground"
                : !status
                ? "text-amber-500"
                : status.status === "connecting"
                  ? "text-blue-500"
                : status.status === "auth_required"
                  ? "text-amber-500"
                : status.status === "connected"
                ? "text-green-500"
                : status.status === "error"
                  ? "text-destructive"
                  : "text-muted-foreground";
            const statusLabel =
              !enabled
                ? copy.disabled
                : !status
                ? copy.unsaved
                : status.status === "connecting"
                  ? copy.connecting
                : status.status === "auth_required"
                  ? copy.authRequired
                : status.status === "connected"
                ? copy.connected
                : status.status === "error"
                  ? copy.error
                  : copy.disconnected;

            return (
              <div
                key={name}
                className="message-bubble rounded-lg border border-border/80 bg-card/80 p-3 transition-colors hover:border-primary/50"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <CircleDot className={cn("size-3", statusColor)} />
                      <span className="truncate text-sm font-semibold">{name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {transport}
                      </Badge>
                      <Badge variant={enabled ? "default" : "muted"} className="text-[10px]">
                        {enabled ? copy.enabledState : copy.disabledState}
                      </Badge>
                      <span className={cn("text-[11px]", statusColor)}>{statusLabel}</span>
                      {status?.tools_count ? (
                        <span className="text-[11px] text-muted-foreground">{status.tools_count} {copy.tools}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {transport === "streamable_http" || transport === "sse"
                        ? (config.url as string) || copy.unconfiguredUrl
                        : [config.command, ...(Array.isArray(config.args) ? (config.args as string[]) : [])].join(" ")}
                    </p>
                    {config.headers && typeof config.headers === "object" && Object.keys(config.headers).length > 0 ? (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                        headers: {Object.entries(config.headers as Record<string, string>).map(([k, v]) => `${k}: ${maskConfigValue(k, v)}`).join("; ")}
                      </p>
                    ) : null}
                    {config.auth ? (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">auth: configured</p>
                    ) : null}
                    {config.env && typeof config.env === "object" && Object.keys(config.env).length > 0 ? (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                        env: {Object.entries(config.env as Record<string, string>).map(([k, v]) => `${k}: ${maskConfigValue(k, v)}`).join("; ")}
                      </p>
                    ) : null}
                    {status?.error ? (
                      <p className="mt-1 truncate text-xs text-destructive">{status.error}</p>
                    ) : null}
                    {!status ? (
                      <p className="mt-1 truncate text-xs text-amber-700 dark:text-amber-300">{copy.draftOnly}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:shrink-0 sm:justify-end">
                    <div className="flex h-7 items-center px-1" title={enabled ? copy.disableServer : copy.enableServer}>
                      <Switch
                        aria-label={enabled ? copy.disableServer : copy.enableServer}
                        checked={enabled}
                        onCheckedChange={(checked) => handleToggleServer(name, checked)}
                      />
                    </div>
                    {enabled && status?.status === "auth_required" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        aria-label={copy.login}
                        title={copy.login}
                        onClick={() => startOAuthLogin(name)}
                      >
                        <ExternalLink className="size-3" />
                        {copy.login}
                      </Button>
                    ) : enabled && status?.oauth_enabled ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        aria-label={copy.relogin}
                        title={copy.relogin}
                        onClick={() => startOAuthLogin(name)}
                      >
                        <ExternalLink className="size-3" />
                        {copy.relogin}
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={!status || !enabled}
                      aria-label={copy.viewTools}
                      title={copy.viewTools}
                      onClick={() => handleViewTools(name)}
                    >
                      <Eye className="size-3" />
                      {copy.tools}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      aria-label={copy.editAction}
                      title={copy.editAction}
                      onClick={() => openEditServerDrawer(name, config)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      aria-label={copy.deleteAction}
                      title={copy.deleteAction}
                      onClick={() => handleDeleteServer(name)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid min-h-40 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center">
          <div>
            <Cpu className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-sm font-medium">{copy.noServers}</p>
            <p className="mt-1 text-xs text-muted-foreground">{copy.noServersHint}</p>
          </div>
        </div>
      )}

      {/* Tools dialog overlay */}
      {showToolsFor ? (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50" onClick={() => setShowToolsFor(null)}>
          <div
            className="mx-4 max-h-[70vh] w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border/80 p-4">
              <div>
                <p className="font-semibold">{formatTemplate(copy.toolsTitle, { server: showToolsFor })}</p>
                <p className="text-xs text-muted-foreground">{formatTemplate(copy.toolsAvailable, { count: toolsData.length })}</p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowToolsFor(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="max-h-[calc(70vh-60px)] overflow-y-auto p-4">
              {isLoadingTools ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : toolsData.length > 0 ? (
                <div className="space-y-3">
                  {toolsData.map((tool) => (
                    <div key={tool.name} className="rounded-md border border-border/80 bg-background/50 p-3">
                      <div className="flex items-center gap-2">
                        <TerminalSquare className="size-3.5 text-primary" />
                        <span className="text-sm font-semibold">{tool.name}</span>
                      </div>
                      {tool.description ? (
                        <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
                      ) : null}
                      {Object.keys(tool.parameters?.properties as Record<string, unknown> || {}).length > 0 ? (
                        <div className="mt-2 space-y-1">
                          <p className="text-[10px] uppercase text-muted-foreground">{copy.parameters}</p>
                          <div className="grid gap-1">
                            {Object.entries(
                              (tool.parameters?.properties as Record<string, Record<string, unknown>>) || {},
                            ).map(([pName, pSchema]) => (
                              <div key={pName} className="flex items-center gap-2 text-xs">
                                <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-primary">{pName}</code>
                                <span className="text-muted-foreground">{(pSchema.type as string) || "any"}</span>
                                {(tool.parameters?.required as string[])?.includes(pName) ? (
                                  <Badge variant="danger" className="text-[9px] h-4">
                                    {copy.required}
                                  </Badge>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {copy.noTools}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* Collapsible raw JSON */}
      <div className="rounded-lg border border-border/80">
        <button
          className="flex w-full items-center justify-between px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          onClick={() => setShowRawJson((v) => !v)}
          type="button"
        >
          <span className="font-medium">{copy.rawJson}</span>
          {showRawJson ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
        {showRawJson ? (
          <div className="border-t border-border/80 p-3">
            <Textarea
              className="min-h-[200px] font-mono text-xs"
              spellCheck={false}
              value={mcpServersText}
              onChange={(event) => setMcpServersText(event.target.value)}
              onBlur={() => {
                try {
                  const parsed = validateMcpServersConfig(parseJsonObject(mcpServersText || "{}", "MCP Servers JSON"));
                  onServersChange?.(parsed);
                } catch { /* invalid JSON, ignore */ }
              }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
