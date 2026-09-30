import { useId, useRef } from "react";
import { createPortal } from "react-dom";

import { Field } from "@/components/common/Field";
import { SideDrawer } from "@/components/common/SideDrawer";
import { type MCPServersPanelProps } from "@/components/mcp/model";
import { useMCPServers, } from "@/components/mcp/useMCPServers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useDialogFocus } from "@/hooks/useDialogFocus";
import { formatTemplate } from "@/i18n";
import { useI18n } from "@/i18n/react";
import { parseJsonObject } from "@/lib/json";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp,
  CircleDot,
  Cpu,
  ExternalLink,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  TerminalSquare,
  Trash2,
  X,
  Zap,
} from "lucide-react";

export function MCPServersPanel(props: MCPServersPanelProps) {
  const {
    copy, mcpServersText, setMcpServersText, onServersChange, servers,
    loadStatus, isLoadingStatus, reconnectServers, openAddServerDrawer, showAddForm,
    editingServerName, closeServerDrawer, addMode, handleAddFromForm, handleAddFromJson,
    setAddMode, addForm, setAddForm, addJson, setAddJson,
    addError, statusMap, maskConfigValue, handleToggleServer, startOAuthLogin,
    handleViewTools, openEditServerDrawer, handleDeleteServer, showToolsFor, setShowToolsFor,
    toolsData, isLoadingTools, setShowRawJson, showRawJson, validateMcpServersConfig,
  } = useMCPServers(props);
  const { messages } = useI18n();
  const toolsDialogRef = useRef<HTMLDivElement | null>(null);
  const toolsCloseRef = useRef<HTMLButtonElement | null>(null);
  const toolsTitleId = useId();
  useDialogFocus(Boolean(showToolsFor), toolsDialogRef, () => setShowToolsFor(null), toolsCloseRef);

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

      {/* 脱离页面动画的定位上下文；列表高度由弹窗剩余空间决定，不假定标题只有一行。 */}
      {showToolsFor ? createPortal(
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/50 p-4" onClick={() => setShowToolsFor(null)}>
          <div
            ref={toolsDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={toolsTitleId}
            tabIndex={-1}
            className="flex max-h-[min(80dvh,calc(100dvh-2rem))] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/80 p-4">
              <div className="min-w-0">
                <p id={toolsTitleId} className="break-words font-semibold">{formatTemplate(copy.toolsTitle, { server: showToolsFor })}</p>
                <p className="text-xs text-muted-foreground">{formatTemplate(copy.toolsAvailable, { count: toolsData.length })}</p>
              </div>
              <Button ref={toolsCloseRef} aria-label={messages.ui.common.close} variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setShowToolsFor(null)}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
              {isLoadingTools ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              ) : toolsData.length > 0 ? (
                <div className="space-y-3">
                  {toolsData.map((tool) => (
                    <div key={tool.name} className="rounded-md border border-border/80 bg-background/50 p-3">
                      <div className="flex items-center gap-2">
                        <TerminalSquare className="size-3.5 shrink-0 text-primary" />
                        <span className="min-w-0 break-words text-sm font-semibold">{tool.name}</span>
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
        </div>,
        document.body,
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
