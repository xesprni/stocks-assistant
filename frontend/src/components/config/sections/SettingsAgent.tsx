import { ToggleRow } from "@/components/common/ToggleRow";
import { ConfigSegmentedControl, ConfigField as Field } from "@/components/config/ConfigForm";
import { ConfigSection } from "@/components/config/ConfigSection";
import { REASONING_EFFORT_OPTIONS, TOOL_CHOICE_OPTIONS } from "@/components/config/settings-model";
import { MainAgentToolPermissions } from "@/components/config/ToolPermissions";
import type { ConfigPageState } from "@/components/config/useSettings";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Bot, Plug, TerminalSquare, Wrench } from "lucide-react";

type Props = Pick<ConfigPageState, "copy" | "canManageSystem" | "draft" | "patchDraft" | "reasoningEffortLabels" | "toolChoiceLabels" | "builtinTools" | "dangerousTools" | "expandedMcpServers" | "isLoadingTools" | "mcpToolGroups" | "selectAllBuiltinTools" | "setExpandedMcpServers" | "toggleAgentTool" | "selectedTools"> & { draft: NonNullable<ConfigPageState["draft"]> };

export function SettingsAgent({
    copy, canManageSystem, draft, patchDraft, reasoningEffortLabels,
    toolChoiceLabels, builtinTools, dangerousTools, expandedMcpServers, isLoadingTools,
    mcpToolGroups, selectAllBuiltinTools, setExpandedMcpServers, toggleAgentTool, selectedTools,
  }: Props) {
  return (<TabsContent value="agent" className="mt-0 space-y-5">
    <ConfigSection
      description={copy.agentRuntimeHint}
      icon={<Bot className="size-4 text-primary" />}
      title={copy.agentRuntimeSection}
    >
      {canManageSystem ? (
        <div className="grid gap-4">
          <Field label={copy.workspace}>
            <Input value={draft.workspace_dir} onChange={(event) => patchDraft({ workspace_dir: event.target.value })} />
          </Field>
        </div>
      ) : null}
      <div className={cn("grid items-start gap-x-5 gap-y-5 md:grid-cols-2", canManageSystem && "mt-5")}>
        <Field label={copy.maxSteps}>
          <Input
            min={1}
            type="number"
            value={draft.agent_max_steps}
            onChange={(event) => patchDraft({ agent_max_steps: Number(event.target.value) })}
          />
        </Field>
        <Field label={copy.contextTokens}>
          <Input
            min={1000}
            step={1000}
            type="number"
            value={draft.agent_max_context_tokens}
            onChange={(event) => patchDraft({ agent_max_context_tokens: Number(event.target.value) })}
          />
        </Field>
        <Field label={copy.contextTurns}>
          <Input
            min={1}
            type="number"
            value={draft.agent_max_context_turns}
            onChange={(event) => patchDraft({ agent_max_context_turns: Number(event.target.value) })}
          />
        </Field>
      </div>
      <div className="mt-6 grid items-start gap-x-5 gap-y-5 border-t border-border/60 pt-6 md:grid-cols-2">
        <Field label={copy.temperature}>
          <Input
            max={2}
            min={0}
            step={0.1}
            type="number"
            value={draft.llm_temperature}
            onChange={(event) => patchDraft({ llm_temperature: Number(event.target.value) })}
          />
        </Field>
        <Field description={copy.maxOutputTokensHint} label={copy.maxOutputTokens}>
          <Input
            min={0}
            step={1024}
            type="number"
            value={draft.llm_max_output_tokens}
            onChange={(event) => patchDraft({ llm_max_output_tokens: Number(event.target.value) })}
          />
        </Field>
        <Field label={copy.reasoningEffort}>
          <ConfigSegmentedControl
            options={REASONING_EFFORT_OPTIONS.map((value) => ({ value, label: reasoningEffortLabels[value] }))}
            value={draft.llm_reasoning_effort}
            onValueChange={(llm_reasoning_effort) => patchDraft({ llm_reasoning_effort })}
          />
        </Field>
        <Field label={copy.toolChoice}>
          <ConfigSegmentedControl
            options={TOOL_CHOICE_OPTIONS.map((value) => ({ value, label: toolChoiceLabels[value] }))}
            value={draft.llm_tool_choice}
            onValueChange={(llm_tool_choice) => patchDraft({ llm_tool_choice })}
          />
        </Field>
      </div>
    </ConfigSection>

    {canManageSystem ? (
      <ConfigSection
        description={copy.mainToolHint}
        icon={<Wrench className="size-4 text-secondary" />}
        title={copy.mainToolSection}
      >
        <MainAgentToolPermissions
          builtinTools={builtinTools}
          copy={copy}
          dangerousTools={dangerousTools}
          draft={draft}
          expandedMcpServers={expandedMcpServers}
          isLoadingTools={isLoadingTools}
          mcpToolGroups={mcpToolGroups}
          onSelectAllBuiltinTools={selectAllBuiltinTools}
          onToggleAllMcp={(checked) => patchDraft({ agent_allow_all_mcp_tools: checked })}
          onToggleMcpServer={(server) => setExpandedMcpServers((current) => ({ ...current, [server]: !current[server] }))}
          onToggleTool={toggleAgentTool}
          selectedTools={selectedTools}
        />
      </ConfigSection>
    ) : null}

    <ConfigSection
      description={copy.multiAgentHint}
      icon={<Plug className="size-4 text-primary" />}
      title={copy.multiAgentSection}
    >
      <div className="mb-5">
        <ToggleRow
          checked={draft.multi_agent_enabled}
          icon={<Bot className="size-4 text-primary" />}
          label={copy.multiAgent}
          onCheckedChange={(checked) => patchDraft({ multi_agent_enabled: checked })}
        />
      </div>
      <div className="grid items-start gap-x-5 gap-y-5 md:grid-cols-3">
        <Field label={copy.parallelLimit} description={copy.parallelLimitHint}>
          <Input
            min={1}
            max={8}
            type="number"
            value={draft.multi_agent_max_parallel_agents}
            onChange={(event) => patchDraft({ multi_agent_max_parallel_agents: Number(event.target.value) })}
          />
        </Field>
        <Field label={copy.batchTaskLimit} description={copy.batchTaskLimitHint}>
          <Input
            min={1}
            max={32}
            type="number"
            value={draft.multi_agent_max_tasks_per_batch ?? 12}
            onChange={(event) => patchDraft({ multi_agent_max_tasks_per_batch: Number(event.target.value) })}
          />
        </Field>
        <Field label={copy.taskTimeout} description={copy.taskTimeoutHint}>
          <Input
            min={10}
            max={1800}
            type="number"
            value={draft.multi_agent_task_timeout_seconds ?? 180}
            onChange={(event) => patchDraft({ multi_agent_task_timeout_seconds: Number(event.target.value) })}
          />
        </Field>
        <Field label={copy.subAgentSteps}>
          <Input
            min={1}
            max={100}
            type="number"
            value={draft.multi_agent_default_max_steps}
            onChange={(event) => patchDraft({ multi_agent_default_max_steps: Number(event.target.value) })}
          />
        </Field>
        <Field label={copy.maxDepth} description={copy.maxDepthHint}>
          <Input
            min={0}
            max={1}
            type="number"
            value={draft.multi_agent_max_depth}
            onChange={(event) => patchDraft({ multi_agent_max_depth: Number(event.target.value) })}
          />
        </Field>
      </div>
    </ConfigSection>

    {canManageSystem ? (
      <ConfigSection
        description={copy.promptSectionHint}
        icon={<TerminalSquare className="size-4 text-primary" />}
        title={copy.promptSection}
      >
        <Field label={copy.systemPrompt}>
          <Textarea
            className="min-h-[220px]"
            value={draft.system_prompt}
            onChange={(event) => patchDraft({ system_prompt: event.target.value })}
          />
        </Field>
      </ConfigSection>
    ) : null}
  </TabsContent>);
}
