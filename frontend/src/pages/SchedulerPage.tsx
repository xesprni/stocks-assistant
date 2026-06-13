import { useEffect, useState } from "react";
import { Clock, History, Loader2, Pencil, Play, Plus, RefreshCw, Save, Send, Trash2 } from "lucide-react";

import { Field } from "@/components/common/Field";
import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { SideDrawer } from "@/components/common/SideDrawer";
import { ToggleRow } from "@/components/common/ToggleRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createSchedulerTask, deleteSchedulerTask, listSchedulerTaskRuns, listSchedulerTasks, runSchedulerTaskNow, toggleSchedulerTask, updateSchedulerTask } from "@/lib/api";
import { formatTemplate, i18n } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { SchedulerTask, SchedulerTaskRun } from "@/types/app";

// ── Scheduler Page ──────────────────────────────────────────────────────────

const schedulerPageCopy = {
  zh: {
    cronTemplates: ["每分钟", "每5分钟", "每30分钟", "每小时", "每天 9:00", "工作日 9:00", "每天 18:00", "每天 22:00"],
    title: "定时任务",
    subtitle: "Cron / 间隔 / 一次性调度",
    taskCount: "{count} tasks",
    refresh: "Refresh",
    addTask: "Add Task",
    editTask: "编辑定时任务",
    createTask: "创建定时任务",
    name: "任务名称",
    namePlaceholder: "每日开盘简报",
    cron: "Cron 表达式",
    prompt: "执行提示词",
    promptPlaceholder: "总结今天美股开盘信号，关注 AAPL、MSFT、NVDA 的异动",
    enableTask: "启用任务",
    enableAfterCreate: "创建后启用",
    notifyTelegram: "执行后发送 Telegram",
    telegramHint: "需要先在配置页启用 Telegram 并保存 Bot Token / Chat ID。",
    cancel: "取消",
    save: "保存",
    create: "Create",
    on: "ON",
    off: "OFF",
    last: "Last: {time}",
    runs: "Runs: {count}",
    run: "Run",
    history: "History",
    disable: "Disable",
    enable: "Enable",
    records: "执行记录",
    manual: "manual",
    schedule: "schedule",
    noOutput: "无输出",
    noRecords: "暂无执行记录",
    emptyTitle: "暂无定时任务",
    emptyHint: "点击 Add Task 创建 Cron 或间隔调度。",
    loadFailed: "加载失败",
    updateFailed: "更新失败",
    createFailed: "创建失败",
    loadRunsFailed: "加载执行记录失败",
    runFailed: "手动执行失败",
    toggleFailed: "切换失败",
    deleteConfirm: "确定删除该任务？",
    deleteFailed: "删除失败",
  },
  en: {
    cronTemplates: ["Every minute", "Every 5 minutes", "Every 30 minutes", "Hourly", "Daily 9:00", "Weekdays 9:00", "Daily 18:00", "Daily 22:00"],
    title: "Scheduled Tasks",
    subtitle: "Cron / interval / one-time scheduling",
    taskCount: "{count} tasks",
    refresh: "Refresh",
    addTask: "Add Task",
    editTask: "Edit Scheduled Task",
    createTask: "Create Scheduled Task",
    name: "Task name",
    namePlaceholder: "Daily market brief",
    cron: "Cron expression",
    prompt: "Execution prompt",
    promptPlaceholder: "Summarize today's US market open signals, focusing on AAPL, MSFT, and NVDA moves",
    enableTask: "Enable task",
    enableAfterCreate: "Enable after creation",
    notifyTelegram: "Send Telegram after run",
    telegramHint: "Enable Telegram in Config and save Bot Token / Chat ID first.",
    cancel: "Cancel",
    save: "Save",
    create: "Create",
    on: "ON",
    off: "OFF",
    last: "Last: {time}",
    runs: "Runs: {count}",
    run: "Run",
    history: "History",
    disable: "Disable",
    enable: "Enable",
    records: "Run History",
    manual: "manual",
    schedule: "schedule",
    noOutput: "No output",
    noRecords: "No run history",
    emptyTitle: "No scheduled tasks",
    emptyHint: "Click Add Task to create a Cron or interval schedule.",
    loadFailed: "Failed to load",
    updateFailed: "Update failed",
    createFailed: "Create failed",
    loadRunsFailed: "Failed to load run history",
    runFailed: "Manual run failed",
    toggleFailed: "Toggle failed",
    deleteConfirm: "Delete this task?",
    deleteFailed: "Delete failed",
  },
} as const;

const cronTemplateValues = ["* * * * *", "*/5 * * * *", "*/30 * * * *", "0 * * * *", "0 9 * * *", "0 9 * * 1-5", "0 18 * * *", "0 22 * * *"];

function getCronTemplates(language: AppLanguage) {
  return cronTemplateValues.map((value, index) => ({ value, label: schedulerPageCopy[language].cronTemplates[index] }));
}

function humanizeSchedule(expr: string, language: AppLanguage): string {
  const cronTemplates = getCronTemplates(language);
  const m = cronTemplates.find((t) => t.value === expr);
  if (m) return m.label;
  return expr;
}

type SchedulerFormState = {
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  notifyTelegram: boolean;
};

function defaultSchedulerForm(telegramEnabled: boolean): SchedulerFormState {
  return { name: "", prompt: "", schedule: "0 9 * * *", enabled: true, notifyTelegram: telegramEnabled };
}

function schedulerTaskToForm(task: SchedulerTask): SchedulerFormState {
  return {
    name: task.name,
    prompt: task.prompt,
    schedule: task.schedule,
    enabled: task.enabled,
    notifyTelegram: Boolean(task.metadata?.notify_telegram),
  };
}

export function SchedulerPage({ confirmAction, language, telegramEnabled }: { confirmAction: ConfirmFn; language: AppLanguage; telegramEnabled: boolean }) {
  const common = i18n[language].common;
  const copy = schedulerPageCopy[language];
  const cronTemplates = getCronTemplates(language);
  const [tasks, setTasks] = useState<SchedulerTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SchedulerFormState>(() => defaultSchedulerForm(telegramEnabled));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runsTaskId, setRunsTaskId] = useState<string | null>(null);
  const [runs, setRuns] = useState<SchedulerTaskRun[]>([]);
  const [isLoadingRuns, setIsLoadingRuns] = useState(false);

  function loadTasks() {
    setIsLoading(true);
    setError("");
    listSchedulerTasks()
      .then((res) => setTasks(res.tasks))
      .catch((e) => setError(e instanceof Error ? e.message : copy.loadFailed))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { loadTasks(); }, []);

  function resetForm() {
    setEditingId(null);
    setForm(defaultSchedulerForm(telegramEnabled));
    setShowForm(false);
  }

  async function handleSaveTask() {
    if (!form.name.trim() || !form.prompt.trim() || !form.schedule.trim()) return;
    setIsSavingTask(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        prompt: form.prompt.trim(),
        schedule: form.schedule.trim(),
        enabled: form.enabled,
        notify_telegram: form.notifyTelegram,
      };
      if (editingId) {
        await updateSchedulerTask(editingId, payload);
      } else {
        await createSchedulerTask(payload);
      }
      resetForm();
      loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : (editingId ? copy.updateFailed : copy.createFailed));
    } finally {
      setIsSavingTask(false);
    }
  }

  function handleEdit(task: SchedulerTask) {
    setEditingId(task.id);
    setForm(schedulerTaskToForm(task));
    setShowForm(true);
    setError("");
  }

  async function loadRuns(taskId: string) {
    setRunsTaskId(taskId);
    setIsLoadingRuns(true);
    setError("");
    try {
      const res = await listSchedulerTaskRuns(taskId);
      setRuns(res.runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.loadRunsFailed);
      setRuns([]);
    } finally {
      setIsLoadingRuns(false);
    }
  }

  async function handleRunNow(task: SchedulerTask) {
    setRunningId(task.id);
    setError("");
    try {
      const run = await runSchedulerTaskNow(task.id);
      setTasks((prev) =>
        prev.map((item) =>
          item.id === task.id
            ? {
                ...item,
                last_run: run.started_at,
                run_count: item.run_count + 1,
                last_error: run.error ?? null,
              }
            : item,
        ),
      );
      if (runsTaskId === task.id) {
        setRuns((current) => [run, ...current.filter((item) => item.id !== run.id)]);
      }
      loadTasks();
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.runFailed);
    } finally {
      setRunningId(null);
    }
  }

  async function handleToggle(id: string) {
    setTogglingId(id);
    try {
      const res = await toggleSchedulerTask(id);
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: res.enabled } : t)));
      if (editingId === id) {
        setForm((current) => ({ ...current, enabled: res.enabled }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.toggleFailed);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDelete(id: string) {
    const confirmed = await confirmAction({
      cancelText: common.cancel,
      confirmText: common.delete,
      description: copy.deleteConfirm,
      destructive: true,
      title: common.delete,
    });
    if (!confirmed) return;
    try {
      await deleteSchedulerTask(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
      if (editingId === id) {
        resetForm();
      }
      if (runsTaskId === id) {
        setRunsTaskId(null);
        setRuns([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.deleteFailed);
    }
  }

  return (
    <section className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="page-toolbar flex flex-wrap items-center justify-end gap-2">
          <Badge variant="outline">{formatTemplate(copy.taskCount, { count: tasks.length })}</Badge>
          <Button variant="outline" size="sm" onClick={loadTasks} disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {copy.refresh}
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null);
              setForm(defaultSchedulerForm(telegramEnabled));
              setShowForm(true);
            }}
            disabled={showForm}
          >
            <Plus />
            {copy.addTask}
          </Button>
      </div>

      {error ? (
        <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      ) : null}

      <div className="panel-body min-h-0 flex-1 lg:overflow-y-auto">
        <SideDrawer
          open={showForm}
          title={editingId ? copy.editTask : copy.createTask}
          subtitle={copy.subtitle}
          onClose={resetForm}
          cancelText={copy.cancel}
          formId="scheduler-task-form"
          isSaving={isSavingTask}
          saveDisabled={!form.name.trim() || !form.prompt.trim()}
          saveText={copy.save}
        >
          <form
            id="scheduler-task-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveTask();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={copy.name}>
                <Input placeholder={copy.namePlaceholder} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </Field>
              <Field label={copy.cron}>
                <Input placeholder="0 9 * * 1-5" value={form.schedule} onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {cronTemplates.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] transition-colors",
                    form.schedule === t.value ? "border-primary bg-primary/10 text-primary" : "border-border/80 text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setForm((f) => ({ ...f, schedule: t.value }))}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <Field label={copy.prompt}>
              <Textarea
                className="min-h-[140px]"
                placeholder={copy.promptPlaceholder}
                value={form.prompt}
                onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
              />
            </Field>
            <div className="grid gap-2">
              <ToggleRow checked={form.enabled} icon={<Clock className="size-4 text-primary" />} label={editingId ? copy.enableTask : copy.enableAfterCreate} onCheckedChange={(c) => setForm((f) => ({ ...f, enabled: c }))} />
              <ToggleRow checked={form.notifyTelegram} icon={<Send className="size-4 text-primary" />} label={copy.notifyTelegram} onCheckedChange={(c) => setForm((f) => ({ ...f, notifyTelegram: c }))} />
              {!telegramEnabled && form.notifyTelegram ? (
                <p className="text-xs text-amber-600 dark:text-amber-300">{copy.telegramHint}</p>
              ) : null}
            </div>
          </form>
        </SideDrawer>

        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : tasks.length > 0 ? (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className={cn("message-bubble rounded-lg border bg-card/80 p-3 transition-colors hover:border-primary/50", task.enabled ? "border-border/80" : "border-border/40 opacity-70")}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("size-2 rounded-full", task.enabled ? "bg-green-500" : "bg-muted-foreground/40")} />
                      <span className="truncate text-sm font-semibold">{task.name}</span>
                      <Badge variant={task.enabled ? "default" : "muted"}>{task.enabled ? copy.on : copy.off}</Badge>
                      {task.metadata?.notify_telegram ? <Badge variant="outline">Telegram</Badge> : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{task.prompt}</p>
                    {task.last_error ? <p className="mt-1 line-clamp-2 text-xs text-destructive">{task.last_error}</p> : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="font-mono">{task.schedule}</span>
                      <span>{humanizeSchedule(task.schedule, language)}</span>
                      {task.last_run ? <span>{formatTemplate(copy.last, { time: task.last_run })}</span> : null}
                      {task.run_count > 0 ? <span>{formatTemplate(copy.runs, { count: task.run_count })}</span> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 sm:shrink-0 sm:justify-end">
                    <Button variant="outline" size="sm" className="h-7 flex-1 text-xs sm:flex-none" disabled={runningId === task.id} onClick={() => handleRunNow(task)}>
                      {runningId === task.id ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
                      {copy.run}
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 flex-1 text-xs sm:flex-none" onClick={() => (runsTaskId === task.id ? setRunsTaskId(null) : loadRuns(task.id))}>
                      <History className="size-3" />
                      {copy.history}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => handleEdit(task)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 flex-1 text-xs sm:flex-none" disabled={togglingId === task.id} onClick={() => handleToggle(task.id)}>
                      {togglingId === task.id ? <Loader2 className="size-3 animate-spin" /> : task.enabled ? copy.disable : copy.enable}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(task.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
                {runsTaskId === task.id ? (
                  <div className="mt-3 border-t border-border/70 pt-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground">{copy.records}</p>
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => loadRuns(task.id)} disabled={isLoadingRuns}>
                        {isLoadingRuns ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                        {copy.refresh}
                      </Button>
                    </div>
                    {isLoadingRuns ? (
                      <div className="flex items-center justify-center py-5">
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      </div>
                    ) : runs.length > 0 ? (
                      <div className="space-y-2">
                        {runs.map((run) => (
                          <div key={run.id} className="border-t border-border/60 py-2 first:border-t-0">
                            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                              <Badge variant={run.status === "success" ? "default" : "danger"}>{run.status}</Badge>
                              <span>{run.trigger === "manual" ? copy.manual : copy.schedule}</span>
                              <span>{run.started_at}</span>
                              <span>{run.duration_ms}ms</span>
                            </div>
                            {run.error ? (
                              <p className="mt-1 line-clamp-2 text-xs text-destructive">{run.error}</p>
                            ) : run.output_preview ? (
                              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">{run.output_preview}</p>
                            ) : (
                              <p className="mt-1 text-xs text-muted-foreground">{copy.noOutput}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-md border border-dashed border-border/70 bg-muted/15 px-3 py-5 text-center text-xs text-muted-foreground">
                        {copy.noRecords}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-h-40 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center">
            <div>
              <Clock className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium">{copy.emptyTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground">{copy.emptyHint}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
