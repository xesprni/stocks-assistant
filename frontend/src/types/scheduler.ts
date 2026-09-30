// ── Scheduler ─────────────────────────────────────────────────────────────────

export interface SchedulerTask {
  id: string;
  name: string;
  prompt: string;
  schedule: string;
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
  run_count: number;
  last_error?: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SchedulerTaskList {
  tasks: SchedulerTask[];
  total: number;
}

export interface SchedulerTaskRun {
  id: string;
  task_id: string;
  task_name: string;
  trigger: "schedule" | "manual" | string;
  status: "success" | "error" | string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  output_preview: string;
  error?: string | null;
}

export interface SchedulerTaskRunList {
  runs: SchedulerTaskRun[];
  total: number;
}
