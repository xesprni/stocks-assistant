import { formatTemplate, i18n, type AppLanguage } from "@/lib/i18n";
import { subagentCountDetails, subagentTraceStatus, upsertSubagentTrace } from "@/lib/subagent-trace";
import { parseRenderedImage, parseRenderedImages } from "@/lib/rendered-images";
import type { ChatMessage, ChatStreamEvent, ChatTraceEvent } from "@/types/app";

function getStreamText(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "string" ? value : "";
}

function getStreamNumber(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return typeof value === "number" ? value : null;
}

function getStreamObject(data: Record<string, unknown> | undefined, key: string) {
  const value = data?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function compactStreamText(value: string, maxLength = 96) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact;
}

function formatDurationDetail(ms: number | null) {
  return ms == null ? undefined : `${(ms / 1000).toFixed(2)}s`;
}

function subagentTraceId(batchId: string, taskId: string) {
  // 任务名允许包含冒号；编码后再拼接，避免与另一任务的轮次前缀混淆。
  return `sub:${encodeURIComponent(batchId)}:${encodeURIComponent(taskId)}`;
}

function summarizeToolArguments(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 3);
  return entries
    .map(([key, item]) => {
      const raw = typeof item === "string" ? item : JSON.stringify(item) ?? String(item);
      const text = raw.length > 80 ? `${raw.slice(0, 80)}...` : raw;
      return `${key}: ${text}`;
    })
    .join(", ");
}


export interface ChatRunState {
  message: ChatMessage;
  streamedContent: string;
  currentStatus: string;
  trace: ChatTraceEvent[];
  renderedImages: NonNullable<ChatMessage["renderedImages"]>;
  sawAgentEnd: boolean;
  terminalEventReceived: boolean;
  sequence: number;
  error?: string;
}

export function initialChatRunState(message: ChatMessage): ChatRunState {
  return { message, streamedContent: "", currentStatus: message.status ?? "", trace: message.trace ?? [],
    renderedImages: message.renderedImages ?? [], sawAgentEnd: false, terminalEventReceived: false, sequence: 0 };
}

/** Pure protocol projection. IDs and timestamps are derived from the supplied event/context. */
export function chatRunReducer(previous: ChatRunState, action: {
  event: ChatStreamEvent; language: AppLanguage; stopping: boolean; createdAt: string;
}): ChatRunState {
  const { event: streamEvent, language, stopping, createdAt } = action;
  const ui = i18n[language];
  const data = streamEvent.data;
  let { message, streamedContent, currentStatus, trace, renderedImages, sawAgentEnd, terminalEventReceived, error } = previous;
  let index = 0;
  const nextId = () => `event:${streamEvent.run_id ?? "local"}:${streamEvent.event_id ?? previous.sequence + 1}:${++index}`;
  const makeTrace = (label: string, status: ChatTraceEvent["status"], detail?: string, id = nextId()): ChatTraceEvent => ({ id, label, status, detail, createdAt });
  const updateAssistant = (patch: Partial<ChatMessage>) => { message = { ...message, ...patch }; };
  const commitStreamState = (patch: Partial<ChatMessage> = {}) => {
    const displayStatus = stopping && patch.pending !== false ? ui.chat.stopping : currentStatus;
    updateAssistant({ content: streamedContent || displayStatus, status: displayStatus, trace, renderedImages, ...patch });
  };
  const addTrace = (item: ChatTraceEvent) => {
    trace = [...trace, item].slice(-30);
    currentStatus = item.label;
    commitStreamState();
  };
  const updateTrace = (id: string, patch: Partial<ChatTraceEvent>) => {
    trace = trace.map((item) => item.id === id ? { ...item, ...patch } : item);
    commitStreamState();
  };
  const projectTurn = (type: string, turnData: Record<string, unknown> | undefined, owner?: { label: string; prefix: string }) => {
    const turn = getStreamNumber(turnData, "turn");
    const prefix = `${owner?.prefix ?? `main:${streamEvent.run_id ?? "local"}:`}turn:`;
    const label = `${owner ? `${owner.label} ` : ""}${turn == null ? ui.chat.startAnalysis : formatTemplate(ui.chat.turn, { turn })}`;
    if (type === "turn_start") {
      // 同一 Agent 的轮次串行；即使遗漏结束帧，新轮也只结算本任务，保留并发状态。
      trace = trace.map((item) => item.id.startsWith(prefix) && item.status === "running"
        ? { ...item, status: "done" } : item);
      addTrace(makeTrace(label, "running", undefined, `${prefix}${turn ?? nextId()}`));
      return;
    }
    const id = turn == null
      ? [...trace].reverse().find((item) => item.id.startsWith(prefix) && item.status === "running")?.id
      : `${prefix}${turn}`;
    if (id) updateTrace(id, { status: "done" });
    currentStatus = owner ? `${owner.label} ${ui.chat.subRunning}`
      : turnData?.has_tool_calls === true ? ui.chat.toolResultsReturned : ui.chat.finishing;
    commitStreamState();
  };
  const projectTool = (type: string, toolData: Record<string, unknown> | undefined, owner?: { label: string; prefix: string }) => {
    const toolName = getStreamText(toolData, "tool_name") || "tool";
    const rawId = getStreamText(toolData, "tool_call_id");
    const titlePrefix = owner ? `${owner.label} ` : "";
    if (type === "tool_execution_start") {
      addTrace(makeTrace(`${titlePrefix}${ui.chat.callTool} ${toolName}`, "running", summarizeToolArguments(toolData?.arguments), `${owner?.prefix ?? ""}${rawId || nextId()}`));
      return;
    }
    const status = getStreamText(toolData, "status") === "success" ? "done" : "error";
    const seconds = getStreamNumber(toolData, "execution_time");
    const detail = seconds == null ? undefined : `${seconds.toFixed(2)}s`;
    if (toolName === "render_image" && status === "done") {
      const artifact = parseRenderedImage(toolData?.result);
      if (artifact) renderedImages = parseRenderedImages([...renderedImages, artifact]);
    }
    const label = `${titlePrefix}${formatTemplate(ui.chat.toolDone, { tool: toolName })}`;
    if (rawId) updateTrace(`${owner?.prefix ?? ""}${rawId}`, { label, status, detail });
    else if (!owner) addTrace(makeTrace(label, status, detail));
    currentStatus = owner ? `${owner.label} ${ui.chat.subToolReturned}`
      : status === "done" ? ui.chat.toolDoneContinue : ui.chat.toolFailedContinue;
    commitStreamState();
  };
  const project = () => {
    if (streamEvent.type === "connection_interrupted") {
      currentStatus = ui.chat.streamRecovering;
      commitStreamState();
      return;
    }

    if (streamEvent.type === "connection_restored") {
      currentStatus = stopping ? ui.chat.stopping : ui.chat.streamRecovered;
      commitStreamState();
      return;
    }

    if (streamEvent.type === "agent_stopped") {
      sawAgentEnd = true;
      streamedContent = streamedContent ? `${streamedContent.trimEnd()}\n\n_${ui.chat.stopped}_` : ui.chat.stopped;
      currentStatus = ui.chat.stopped;
      trace = trace.map((item) => item.status === "running" ? { ...item, status: "done" } : item);
      commitStreamState({ pending: false });
      return;
    }

    if (streamEvent.type === "message_reset") {
      const discarded = getStreamText(data, "discarded_content");
      if (discarded && streamedContent.endsWith(discarded)) {
        streamedContent = streamedContent.slice(0, -discarded.length);
        commitStreamState();
      }
      return;
    }

    if (streamEvent.type === "error") {
      terminalEventReceived = true;
      error = getStreamText(data, "error") || (language === "en" ? "Chat request failed" : "对话请求失败");
      trace = trace.map((item) => item.status === "running" ? { ...item, status: "error" } : item);
      currentStatus = formatTemplate(ui.chat.requestFailed, { message: error });
      commitStreamState({ pending: false });
      return;
    }

    if (streamEvent.type === "agent_start") {
      updateTrace(trace[0]?.id ?? "", { status: "done", label: ui.chat.streamReady });
      currentStatus = ui.chat.analyzing;
      commitStreamState();
      return;
    }

    if (streamEvent.type === "status_update") {
      currentStatus = getStreamText(data, "message") || ui.chat.modelAnalyzing;
      commitStreamState();
      return;
    }

    if (streamEvent.type === "subagent_batch_start") {
      const batchId = getStreamText(data, "batch_id") || nextId();
      const taskCount = getStreamNumber(data, "task_count");
      const roles = Array.isArray(data?.roles) ? data.roles.map(String).join(", ") : "";
      addTrace(makeTrace(ui.chat.subBatchStart, "running", `${formatTemplate(ui.chat.subTasks, { count: taskCount ?? 0 })}${roles ? ` · ${roles}` : ""}`, batchId));
      return;
    }

    if (streamEvent.type === "subagent_batch_end") {
      const batchId = getStreamText(data, "batch_id") || nextId();
      const outcome = getStreamText(data, "status");
      const status = subagentTraceStatus(outcome);
      const counts = subagentCountDetails(data?.counts, {
        success: ui.chat.subStatusSuccess,
        error: ui.chat.subStatusError,
        timeout: ui.chat.subStatusTimeout,
        cancelled: ui.chat.subStatusCancelled,
        skipped: ui.chat.subStatusSkipped,
      });
      const detail = [counts, formatDurationDetail(getStreamNumber(data, "duration_ms"))].filter(Boolean).join(" · ");
      const label = outcome === "cancelled" ? ui.chat.subBatchCancelled : ui.chat.subBatchDone;
      trace = upsertSubagentTrace(trace, makeTrace(label, status, detail, batchId));
      currentStatus = outcome === "cancelled" ? ui.chat.subBatchCancelled
        : status === "done" ? ui.chat.subBatchResult : ui.chat.subBatchPartial;
      commitStreamState();
      return;
    }

    if (streamEvent.type === "subagent_queued" || streamEvent.type === "subagent_start") {
      const batchId = getStreamText(data, "batch_id") || "batch";
      const taskId = getStreamText(data, "task_id") || nextId();
      const role = getStreamText(data, "role") || "subagent";
      const agentLabel = `${role} [${taskId}]`;
      const task = getStreamText(data, "task");
      const queued = streamEvent.type === "subagent_queued";
      const waitingFor = queued && Array.isArray(data?.waiting_for)
        ? data.waiting_for.map(String).join(", ") : "";
      const detail = [compactStreamText(task), waitingFor ? formatTemplate(ui.chat.subWaitingFor, { tasks: waitingFor }) : ""].filter(Boolean).join(" · ");
      const label = `${agentLabel} ${queued ? ui.chat.subQueued : ui.chat.subStart}`;
      trace = upsertSubagentTrace(trace, makeTrace(label, queued ? "info" : "running", detail, subagentTraceId(batchId, taskId)));
      currentStatus = label;
      commitStreamState();
      return;
    }

    if (streamEvent.type === "subagent_end") {
      const batchId = getStreamText(data, "batch_id") || "batch";
      const taskId = getStreamText(data, "task_id") || "";
      const role = getStreamText(data, "role") || "subagent";
      const agentLabel = taskId ? `${role} [${taskId}]` : role;
      const outcome = getStreamText(data, "status");
      const status = subagentTraceStatus(outcome);
      const labels: Record<string, string> = {
        success: ui.chat.subStatusSuccess,
        error: ui.chat.subStatusError,
        timeout: ui.chat.subStatusTimeout,
        cancelled: ui.chat.subStatusCancelled,
        skipped: ui.chat.subStatusSkipped,
      };
      const label = `${agentLabel} ${labels[outcome] || ui.chat.subStatusError}`;
      const errorText = getStreamText(data, "error");
      const detail = errorText || formatDurationDetail(getStreamNumber(data, "duration_ms"));
      trace = upsertSubagentTrace(trace, makeTrace(label, status, detail, subagentTraceId(batchId, taskId)), true);
      currentStatus = status === "done" ? `${agentLabel} ${ui.chat.subBatchResult}` : label;
      commitStreamState();
      return;
    }

    if (streamEvent.type === "subagent_event") {
      const batchId = getStreamText(data, "batch_id") || "batch";
      const taskId = getStreamText(data, "task_id") || "task";
      const role = getStreamText(data, "role") || "subagent";
      const agentLabel = `${role} [${taskId}]`;
      const childType = getStreamText(data, "child_event_type");
      const childData = getStreamObject(data, "child_data");

      if (childType === "turn_start" || childType === "turn_end") {
        projectTurn(childType, childData, { label: agentLabel, prefix: `${subagentTraceId(batchId, taskId)}:` });
        return;
      }

      if (childType === "tool_execution_start" || childType === "tool_execution_end") {
        projectTool(childType, childData, { label: agentLabel, prefix: `${subagentTraceId(batchId, taskId)}:tool:` });
        return;
      }

      if (childType === "message_update") {
        currentStatus = `${agentLabel} ${ui.chat.subGenerating}`;
        commitStreamState();
        return;
      }

      if (childType === "message_end") {
        currentStatus = `${agentLabel} ${ui.chat.subGenerated}`;
        commitStreamState();
        return;
      }
    }

    if (streamEvent.type === "turn_start" || streamEvent.type === "turn_end") {
      projectTurn(streamEvent.type, data);
      return;
    }

    if (streamEvent.type === "message_start") {
      currentStatus = ui.chat.messageStart;
      commitStreamState();
      return;
    }

    if (streamEvent.type === "message_update") {
      streamedContent += getStreamText(data, "delta");
      currentStatus = ui.chat.generating;
      commitStreamState();
      return;
    }

    if (streamEvent.type === "tool_execution_start" || streamEvent.type === "tool_execution_end") {
      projectTool(streamEvent.type, data);
      return;
    }

    if (streamEvent.type === "agent_end") {
      sawAgentEnd = true;
      const finalResponse = getStreamText(data, "final_response");
      const messageId = getStreamText(data, "message_id");
      renderedImages = parseRenderedImages([...renderedImages, ...parseRenderedImages(data?.rendered_images)]);
      const sources = Array.isArray(data?.sources)
        ? data.sources.filter((item): item is NonNullable<ChatMessage["sources"]>[number] => Boolean(item && typeof item === "object" && "id" in item))
        : [];
      streamedContent = finalResponse || streamedContent || ui.chat.empty;
      currentStatus = ui.chat.complete;
      trace = trace.map((item) => (item.status === "running" ? { ...item, status: "done" } : item));
      updateAssistant({
        id: messageId || message.id,
        content: streamedContent,
        pending: false,
        status: currentStatus,
        trace,
        renderedImages,
        sources,
        createdAt: createdAt,
      });
    }
  };
  project();
  return { message, streamedContent, currentStatus, trace, renderedImages, sawAgentEnd, terminalEventReceived,
    error, sequence: previous.sequence + 1 };
}
