import { useErrorToast } from "@/components/common/Toast";
import { emptyMcpAddForm, type MCPServersPanelProps, type MCPTransport } from "@/components/mcp/model";
import { formatTemplate } from "@/i18n";
import { deleteMcpOAuth, getMcpStatus, getMcpTools, reconnectMcpServers, startMcpOAuthAuthorization } from "@/lib/api";
import { parseJsonObject } from "@/lib/json";
import type { MCPServerStatus, MCPToolInfo } from "@/types/app";
import { useEffect, useState } from "react";

export function useMCPServers({ copy, mcpServersText, setMcpServersText, onServersChange }: MCPServersPanelProps) {

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

  useErrorToast(oauthError, copy.title);

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
    deleteMcpOAuth(name).catch(() => { });
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
    if (renamedFrom) deleteMcpOAuth(renamedFrom).catch(() => { });
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
  return {
    copy, mcpServersText, setMcpServersText, onServersChange, servers,
    loadStatus, isLoadingStatus, reconnectServers, openAddServerDrawer, showAddForm,
    editingServerName, closeServerDrawer, addMode, handleAddFromForm, handleAddFromJson,
    setAddMode, addForm, setAddForm, addJson, setAddJson,
    addError, statusMap, maskConfigValue, handleToggleServer, startOAuthLogin,
    handleViewTools, openEditServerDrawer, handleDeleteServer, showToolsFor, setShowToolsFor,
    toolsData, isLoadingTools, setShowRawJson, showRawJson, validateMcpServersConfig,
  };
}
export type MCPServersPanelState = ReturnType<typeof useMCPServers>;
