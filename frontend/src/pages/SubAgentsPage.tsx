import { useEffect, useMemo, useState } from "react";
import { Bot, Check, ChevronDown, Copy, Loader2, Plus, Plug, Save, Settings2, ShieldCheck, Trash2 } from "lucide-react";

import { Field } from "@/components/common/Field";
import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { ToggleRow } from "@/components/common/ToggleRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { listTools, saveConfig } from "@/lib/api";
import { formatTemplate, i18n } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AppConfig, SubAgentRoleConfig, ToolInfo } from "@/types/app";

function isMcpToolName(name: string): boolean {
  return name.startsWith("mcp_");
}

function mcpServerName(tool: ToolInfo): string {
  return tool.server_name || tool.name.replace(/^mcp_/, "").split("_")[0] || "mcp";
}

interface SubAgentRoleForm extends SubAgentRoleConfig {
  name: string;
}

const emptySubAgentRoleForm: SubAgentRoleForm = {
  name: "",
  description: "",
  system_prompt: "",
  tool_allowlist: ["web_fetch", "read_skill"],
  max_steps: 8,
  allow_dangerous_tools: false,
  allow_all_mcp_tools: false,
};

function normalizeSubAgentRole(raw: SubAgentRoleConfig | Record<string, unknown> | undefined): SubAgentRoleConfig {
  return {
    description: typeof raw?.description === "string" ? raw.description : "",
    system_prompt: typeof raw?.system_prompt === "string" ? raw.system_prompt : "",
    tool_allowlist: Array.isArray(raw?.tool_allowlist) ? raw.tool_allowlist.map(String).filter(Boolean) : [],
    max_steps: typeof raw?.max_steps === "number" ? raw.max_steps : Number(raw?.max_steps ?? 8) || 8,
    allow_dangerous_tools: Boolean(raw?.allow_dangerous_tools),
    allow_all_mcp_tools: Boolean(raw?.allow_all_mcp_tools),
  };
}

function roleToForm(name: string, role?: SubAgentRoleConfig): SubAgentRoleForm {
  return { name, ...normalizeSubAgentRole(role) };
}

function uniqueRoleName(base: string, roles: Record<string, SubAgentRoleConfig>) {
  let candidate = base;
  let idx = 2;
  while (roles[candidate]) {
    candidate = `${base}_${idx}`;
    idx += 1;
  }
  return candidate;
}

export function SubAgentsPage({
  config,
  confirmAction,
  language,
  onSaved,
  onOpenConfig,
}: {
  config: AppConfig | null;
  confirmAction: ConfirmFn;
  language: AppLanguage;
  onSaved: (config: AppConfig) => void;
  onOpenConfig: () => void;
}) {
  const common = i18n[language].common;
  const copy = i18n[language].subagents;
  const [roles, setRoles] = useState<Record<string, SubAgentRoleConfig>>({});
  const [form, setForm] = useState<SubAgentRoleForm>(emptySubAgentRoleForm);
  const [selectedName, setSelectedName] = useState("");
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [maxParallel, setMaxParallel] = useState(3);
  const [defaultMaxSteps, setDefaultMaxSteps] = useState(8);
  const [maxDepth, setMaxDepth] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingTools, setIsLoadingTools] = useState(false);
  const [expandedMcpServers, setExpandedMcpServers] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const dangerousTools = config?.multi_agent_dangerous_tools ?? ["bash", "write_file", "scheduler"];
  const roleNames = Object.keys(roles).sort();
  const selectedRole = selectedName ? roles[selectedName] : undefined;
  const hasUnsavedNameChange = selectedName && form.name.trim() !== selectedName;

  useEffect(() => {
    if (!config) return;
    const normalized: Record<string, SubAgentRoleConfig> = {};
    for (const [name, role] of Object.entries(config.multi_agent_roles ?? {})) {
      normalized[name] = normalizeSubAgentRole(role);
    }
    setRoles(normalized);
    const firstName = Object.keys(normalized).sort()[0] ?? "";
    setSelectedName(firstName);
    setForm(firstName ? roleToForm(firstName, normalized[firstName]) : emptySubAgentRoleForm);
    setEnabled(config.multi_agent_enabled);
    setMaxParallel(config.multi_agent_max_parallel_agents);
    setDefaultMaxSteps(config.multi_agent_default_max_steps);
    setMaxDepth(config.multi_agent_max_depth);
  }, [config]);

  useEffect(() => {
    setIsLoadingTools(true);
    listTools()
      .then((res) => setTools(res.tools))
      .catch(() => setTools([]))
      .finally(() => setIsLoadingTools(false));
  }, []);

  function selectRole(name: string) {
    setSelectedName(name);
    setForm(roleToForm(name, roles[name]));
    setMessage("");
    setError("");
  }

  function patchForm(patch: Partial<SubAgentRoleForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function handleNewRole() {
    const name = uniqueRoleName("custom_agent", roles);
    const nextForm = {
      ...emptySubAgentRoleForm,
      name,
      description: copy.customDescription,
      system_prompt: copy.customPrompt,
      max_steps: defaultMaxSteps,
    };
    setSelectedName("");
    setForm(nextForm);
    setMessage(copy.newMessage);
    setError("");
  }

  function handleDuplicateRole() {
    const name = uniqueRoleName(`${form.name || "agent"}_copy`, roles);
    setSelectedName("");
    setForm({ ...form, name });
    setMessage(copy.duplicateMessage);
  }

  function toggleTool(name: string) {
    const exists = form.tool_allowlist.includes(name);
    patchForm({
      tool_allowlist: exists
        ? form.tool_allowlist.filter((tool) => tool !== name)
        : [...form.tool_allowlist, name],
    });
  }

  function isToolSelectable(name: string) {
    if (name === "delegate_agent") return false;
    if (form.allow_all_mcp_tools && isMcpToolName(name)) return false;
    if (dangerousTools.includes(name) && !form.allow_dangerous_tools) return false;
    return true;
  }

  function handleSelectAllTools() {
    const selectable = visibleTools
      .map((tool) => tool.name)
      .filter(isToolSelectable);
    patchForm({
      tool_allowlist: Array.from(new Set([...form.tool_allowlist, ...selectable])),
    });
  }

  function validateForm() {
    const name = form.name.trim();
    if (!name) return copy.missingName;
    if (!/^[A-Za-z0-9_-]+$/.test(name)) return copy.badName;
    if (!form.description.trim()) return copy.missingDescription;
    if (!form.system_prompt.trim()) return copy.missingPrompt;
    if (form.tool_allowlist.includes("delegate_agent")) return copy.blockedDelegate;
    if (!form.allow_dangerous_tools && form.tool_allowlist.some((tool) => dangerousTools.includes(tool))) {
      return copy.dangerousBlocked;
    }
    return "";
  }

  async function handleSaveRole() {
    if (!config) return;
    const validation = validateForm();
    if (validation) {
      setError(validation);
      return;
    }

    setIsSaving(true);
    setError("");
    setMessage("");
    const name = form.name.trim();
    const nextRoles = { ...roles };
    if (selectedName && selectedName !== name) delete nextRoles[selectedName];
    nextRoles[name] = {
      description: form.description.trim(),
      system_prompt: form.system_prompt.trim(),
      tool_allowlist: Array.from(new Set(form.tool_allowlist)).filter(Boolean),
      max_steps: Math.max(1, Number(form.max_steps) || defaultMaxSteps),
      allow_dangerous_tools: form.allow_dangerous_tools,
      allow_all_mcp_tools: form.allow_all_mcp_tools,
    };

    try {
      const next = await saveConfig({
        multi_agent_enabled: enabled,
        multi_agent_max_parallel_agents: Math.max(1, Number(maxParallel) || 1),
        multi_agent_default_max_steps: Math.max(1, Number(defaultMaxSteps) || 1),
        multi_agent_max_depth: Math.max(1, Number(maxDepth) || 1),
        multi_agent_roles: nextRoles,
      });
      setRoles(next.multi_agent_roles);
      setSelectedName(name);
      setForm(roleToForm(name, next.multi_agent_roles[name]));
      onSaved(next);
      setMessage(copy.savedMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.saveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteRole(name: string) {
    if (!config) return;
    const confirmed = await confirmAction({
      cancelText: common.cancel,
      confirmText: common.delete,
      description: formatTemplate(copy.deleteConfirm, { name }),
      destructive: true,
      title: copy.delete,
    });
    if (!confirmed) return;
    const nextRoles = { ...roles };
    delete nextRoles[name];
    setIsSaving(true);
    setError("");
    try {
      const next = await saveConfig({ multi_agent_roles: nextRoles });
      setRoles(next.multi_agent_roles);
      const firstName = Object.keys(next.multi_agent_roles).sort()[0] ?? "";
      setSelectedName(firstName);
      setForm(firstName ? roleToForm(firstName, next.multi_agent_roles[firstName]) : emptySubAgentRoleForm);
      onSaved(next);
      setMessage(copy.deletedMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.deleteFailed);
    } finally {
      setIsSaving(false);
    }
  }

  const visibleTools = tools.length
    ? tools
    : Array.from(new Set([...form.tool_allowlist, ...dangerousTools, "web_fetch", "read_file", "read_skill", "memory_search", "memory_get", "get_financial_reports"]))
        .map((name) => ({ name, description: "", parameters: {} }));
  const builtinTools = visibleTools.filter((tool) => !isMcpToolName(tool.name));
  const mcpToolGroups = useMemo(() => {
    const groups: Record<string, ToolInfo[]> = {};
    for (const tool of visibleTools) {
      if (!isMcpToolName(tool.name)) continue;
      const server = mcpServerName(tool);
      groups[server] = [...(groups[server] ?? []), tool];
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [visibleTools]);
  const effectiveSelectedTools = new Set([
    ...form.tool_allowlist,
    ...(form.allow_all_mcp_tools ? visibleTools.filter((tool) => isMcpToolName(tool.name)).map((tool) => tool.name) : []),
  ]);

  return (
    <section className="panel flex min-h-0 flex-1 flex-col">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-primary/10 text-primary">
            <Bot className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold">{copy.title}</p>
            <p className="truncate text-xs text-muted-foreground sm:text-sm">{copy.subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={enabled ? "default" : "muted"}>{enabled ? copy.enabledState : copy.disabledState}</Badge>
          <Button size="sm" variant="outline" onClick={onOpenConfig}>
            <Settings2 />
            {copy.config}
          </Button>
        </div>
      </div>

      <div className="panel-body min-h-0 flex-1 lg:overflow-auto">
        {!config ? (
          <div className="rounded-md border border-dashed border-border/80 px-3 py-8 text-center text-sm text-muted-foreground">{copy.loading}</div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="grid gap-3 rounded-md border border-border/80 bg-muted/15 p-3">
                <ToggleRow checked={enabled} icon={<ShieldCheck className="size-4 text-primary" />} label={copy.enabled} onCheckedChange={setEnabled} />
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
                  <Field label={copy.parallelLimit}>
                    <Input min={1} type="number" value={maxParallel} onChange={(e) => setMaxParallel(Number(e.target.value))} />
                  </Field>
                  <Field label={copy.defaultSteps}>
                    <Input min={1} type="number" value={defaultMaxSteps} onChange={(e) => setDefaultMaxSteps(Number(e.target.value))} />
                  </Field>
                  <Field label={copy.maxDepth}>
                    <Input min={1} type="number" value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))} />
                  </Field>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{copy.roles}</p>
                  <p className="text-xs text-muted-foreground">{formatTemplate(copy.roleCount, { count: roleNames.length })}</p>
                </div>
                <Button size="sm" onClick={handleNewRole}>
                  <Plus />
                  {copy.add}
                </Button>
              </div>

              <div className="space-y-2">
                {roleNames.map((name) => {
                  const role = roles[name];
                  const active = selectedName === name;
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => selectRole(name)}
                      className={cn(
                        "w-full rounded-md border px-3 py-3 text-left transition-colors",
                        active ? "border-primary/60 bg-primary/10" : "border-border/80 bg-background/50 hover:border-primary/40",
                      )}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{name}</span>
                        <Badge variant={role.allow_dangerous_tools ? "danger" : "outline"}>{role.max_steps} steps</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{role.description || copy.noDescription}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {role.tool_allowlist.slice(0, 4).map((tool) => <Badge key={tool} variant="muted">{tool}</Badge>)}
                        {role.allow_all_mcp_tools ? <Badge variant="default">{copy.allMcpTools}</Badge> : null}
                        {role.tool_allowlist.length > 4 ? <Badge variant="outline">+{role.tool_allowlist.length - 4}</Badge> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-w-0 space-y-4">
              {message ? <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{message}</div> : null}
              {error ? <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}

              <div className="rounded-md border border-border/80 bg-background/50 p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{selectedName ? copy.editTitle : copy.addTitle}</p>
                    <p className="text-xs text-muted-foreground">{hasUnsavedNameChange ? formatTemplate(copy.renameHint, { name: selectedName }) : copy.formHint}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={handleDuplicateRole} disabled={!form.name}>
                      <Copy />
                      {copy.duplicate}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => selectedName && handleDeleteRole(selectedName)} disabled={!selectedName || isSaving}>
                      <Trash2 />
                      {copy.delete}
                    </Button>
                    <Button size="sm" onClick={handleSaveRole} disabled={isSaving}>
                      {isSaving ? <Loader2 className="animate-spin" /> : <Save />}
                      {copy.save}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_140px]">
                  <Field label={copy.agentId}>
                    <Input value={form.name} onChange={(e) => patchForm({ name: e.target.value.trim() })} placeholder="researcher" />
                  </Field>
                  <Field label={copy.description}>
                    <Input value={form.description} onChange={(e) => patchForm({ description: e.target.value })} placeholder={copy.descriptionPlaceholder} />
                  </Field>
                  <Field label={copy.maxSteps}>
                    <Input min={1} type="number" value={form.max_steps} onChange={(e) => patchForm({ max_steps: Number(e.target.value) })} />
                  </Field>
                </div>

                <div className="mt-3">
                  <ToggleRow
                    checked={form.allow_dangerous_tools}
                    icon={<ShieldCheck className="size-4 text-destructive" />}
                    label={copy.allowDangerous}
                    onCheckedChange={(checked) => patchForm({
                      allow_dangerous_tools: checked,
                      tool_allowlist: checked ? form.tool_allowlist : form.tool_allowlist.filter((tool) => !dangerousTools.includes(tool)),
                    })}
                  />
                </div>

                <Field className="mt-4" label={copy.systemPrompt}>
                  <Textarea
                    className="min-h-[180px]"
                    value={form.system_prompt}
                    onChange={(e) => patchForm({ system_prompt: e.target.value })}
                    placeholder={copy.promptPlaceholder}
                  />
                </Field>
              </div>

              <div className="rounded-md border border-border/80 bg-background/50 p-4">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">{copy.tools}</p>
                    <p className="text-xs text-muted-foreground">{isLoadingTools ? copy.loadingTools : formatTemplate(copy.toolsAvailable, { count: visibleTools.length })}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                    <Badge variant="outline">{effectiveSelectedTools.size} {copy.selected}</Badge>
                    <Button size="sm" variant="outline" onClick={handleSelectAllTools} disabled={!visibleTools.some((tool) => isToolSelectable(tool.name))}>
                      <Check />
                      {copy.selectAllTools}
                    </Button>
                  </div>
                </div>
                <div className="mb-3 space-y-2">
                  <ToggleRow
                    checked={form.allow_all_mcp_tools}
                    icon={<Plug className="size-4 text-primary" />}
                    label={copy.allowAllMcpTools}
                    onCheckedChange={(checked) => patchForm({ allow_all_mcp_tools: checked })}
                  />
                  <p className="px-1 text-xs text-muted-foreground">{copy.allowAllMcpToolsHint}</p>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">{copy.builtinTools}</p>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {builtinTools.map((tool) => (
                        <SubAgentToolTile
                          key={tool.name}
                          checked={effectiveSelectedTools.has(tool.name)}
                          copy={copy}
                          disabled={
                            tool.name === "delegate_agent"
                            || (dangerousTools.includes(tool.name) && !form.allow_dangerous_tools)
                          }
                          isDangerous={dangerousTools.includes(tool.name)}
                          isDelegate={tool.name === "delegate_agent"}
                          isMcpCovered={false}
                          tool={tool}
                          onToggle={() => toggleTool(tool.name)}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground">{copy.mcpTools}</p>
                    {mcpToolGroups.length > 0 ? (
                      <div className="space-y-2">
                        {mcpToolGroups.map(([server, serverTools]) => {
                          const expanded = Boolean(expandedMcpServers[server]);
                          const selectedCount = serverTools.filter((tool) => effectiveSelectedTools.has(tool.name)).length;
                          return (
                            <div key={server} className="rounded-md border border-border/80 bg-muted/10">
                              <button
                                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                                type="button"
                                onClick={() => setExpandedMcpServers((current) => ({ ...current, [server]: !current[server] }))}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold">{server}</span>
                                  <span className="block text-xs text-muted-foreground">{selectedCount}/{serverTools.length}</span>
                                </span>
                                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                              </button>
                              {expanded ? (
                                <div className="grid gap-2 border-t border-border/70 p-2 md:grid-cols-2 xl:grid-cols-3">
                                  {serverTools.map((tool) => (
                                    <SubAgentToolTile
                                      key={tool.name}
                                      checked={effectiveSelectedTools.has(tool.name)}
                                      copy={copy}
                                      disabled={form.allow_all_mcp_tools}
                                      isDangerous={false}
                                      isDelegate={false}
                                      isMcpCovered={form.allow_all_mcp_tools}
                                      tool={tool}
                                      onToggle={() => toggleTool(tool.name)}
                                    />
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
                        {copy.noMcpTools}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SubAgentToolTile({
  checked,
  copy,
  disabled,
  isDangerous,
  isDelegate,
  isMcpCovered,
  onToggle,
  tool,
}: {
  checked: boolean;
  copy: typeof i18n.zh.subagents;
  disabled: boolean;
  isDangerous: boolean;
  isDelegate: boolean;
  isMcpCovered: boolean;
  onToggle: () => void;
  tool: ToolInfo;
}) {
  return (
    <label
      className={cn(
        "flex min-h-[88px] cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors",
        checked ? "border-primary/60 bg-primary/10" : "border-border/75 bg-muted/10 hover:border-primary/40",
        disabled && "cursor-not-allowed opacity-55",
      )}
    >
      <input
        checked={checked}
        className="mt-1"
        disabled={disabled}
        type="checkbox"
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="truncate font-medium">{tool.name}</span>
          {isDangerous ? <Badge variant="danger">danger</Badge> : null}
          {isMcpCovered ? <Badge variant="default">{copy.allMcpTools}</Badge> : null}
          {isDelegate ? <Badge variant="muted">blocked</Badge> : null}
        </span>
        <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{tool.description || copy.noDescription}</span>
      </span>
    </label>
  );
}
