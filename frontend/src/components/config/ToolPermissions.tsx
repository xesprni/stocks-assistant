import { ToggleRow } from "@/components/common/ToggleRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTemplate, i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ConfigDraft, ToolInfo } from "@/types/app";
import { Check, ChevronDown, Plug } from "lucide-react";

export function MainAgentToolPermissions({
  builtinTools,
  copy,
  dangerousTools,
  draft,
  expandedMcpServers,
  isLoadingTools,
  mcpToolGroups,
  onSelectAllBuiltinTools,
  onToggleAllMcp,
  onToggleMcpServer,
  onToggleTool,
  selectedTools,
}: {
  builtinTools: ToolInfo[];
  copy: typeof i18n.zh.config;
  dangerousTools: string[];
  draft: ConfigDraft;
  expandedMcpServers: Record<string, boolean>;
  isLoadingTools: boolean;
  mcpToolGroups: [string, ToolInfo[]][];
  onSelectAllBuiltinTools: () => void;
  onToggleAllMcp: (checked: boolean) => void;
  onToggleMcpServer: (server: string) => void;
  onToggleTool: (name: string) => void;
  selectedTools: Set<string>;
}) {
  const mcpToolCount = mcpToolGroups.reduce((total, [, items]) => total + items.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{isLoadingTools ? copy.loadingTools : formatTemplate(copy.toolsAvailable, { count: builtinTools.length + mcpToolCount })}</Badge>
          <Badge variant="secondary">{formatTemplate(copy.selectedTools, { count: selectedTools.size })}</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={onSelectAllBuiltinTools} disabled={builtinTools.length === 0}>
          <Check />
          {copy.selectAllBuiltinTools}
        </Button>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">{copy.builtinTools}</p>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {builtinTools.map((tool) => (
            <ToolPermissionTile
              key={tool.name}
              copy={copy}
              dangerous={dangerousTools.includes(tool.name)}
              disabled={false}
              selected={selectedTools.has(tool.name)}
              tool={tool}
              onToggle={() => onToggleTool(tool.name)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <ToggleRow
          checked={draft.agent_allow_all_mcp_tools}
          icon={<Plug className="size-4 text-primary" />}
          label={copy.allowAllMcpTools}
          onCheckedChange={onToggleAllMcp}
        />
        <p className="px-1 text-xs text-muted-foreground">{copy.allowAllMcpToolsHint}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground">{copy.mcpTools}</p>
        {mcpToolGroups.length > 0 ? (
          <div className="space-y-2">
            {mcpToolGroups.map(([server, serverTools]) => {
              const expanded = Boolean(expandedMcpServers[server]);
              const enabledCount = serverTools.filter((tool) => selectedTools.has(tool.name)).length;
              return (
                <div key={server} className="rounded-md border border-border/80 bg-muted/10">
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                    onClick={() => onToggleMcpServer(server)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{server}</span>
                      <span className="block text-xs text-muted-foreground">{enabledCount}/{serverTools.length}</span>
                    </span>
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
                  </button>
                  {expanded ? (
                    <div className="grid gap-2 border-t border-border/70 p-2 md:grid-cols-2 xl:grid-cols-3">
                      {serverTools.map((tool) => (
                        <ToolPermissionTile
                          key={tool.name}
                          copy={copy}
                          dangerous={false}
                          disabled={draft.agent_allow_all_mcp_tools}
                          selected={selectedTools.has(tool.name)}
                          tool={tool}
                          onToggle={() => onToggleTool(tool.name)}
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
  );
}

export function ToolPermissionTile({
  copy,
  dangerous,
  disabled,
  onToggle,
  selected,
  tool,
}: {
  copy: typeof i18n.zh.config;
  dangerous: boolean;
  disabled: boolean;
  onToggle: () => void;
  selected: boolean;
  tool: ToolInfo;
}) {
  return (
    <label
      className={cn(
        "flex min-h-[96px] cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-primary/40",
        selected ? "border-primary/40 bg-primary/5" : "border-border/75 bg-background/40 hover:border-primary/40",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        checked={selected}
        className="mt-0.5 size-4 shrink-0 accent-primary"
        disabled={disabled}
        type="checkbox"
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="truncate font-medium">{tool.name}</span>
          {dangerous ? <Badge variant="danger">{copy.dangerousTool}</Badge> : null}
        </span>
        <span className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{tool.description || copy.noDescription}</span>
      </span>
    </label>
  );
}
