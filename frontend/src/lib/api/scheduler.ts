import { request } from "@/lib/api/transport";
import type {
  SchedulerTask,
  SchedulerTaskList,
  SchedulerTaskRun,
  SchedulerTaskRunList
} from "@/types/app";

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function listSchedulerTasks() {
  return request<SchedulerTaskList>("/api/v1/scheduler/tasks");
}

export function createSchedulerTask(payload: {
  name: string;
  prompt: string;
  schedule: string;
  enabled?: boolean;
  notify_telegram?: boolean;
  telegram_photos?: string[];
}) {
  return request<SchedulerTask>("/api/v1/scheduler/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateSchedulerTask(
  id: string,
  payload: {
    name?: string;
    prompt?: string;
    schedule?: string;
    enabled?: boolean;
    notify_telegram?: boolean;
    telegram_photos?: string[];
  },
) {
  return request<SchedulerTask>(`/api/v1/scheduler/tasks/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function runSchedulerTaskNow(id: string) {
  return request<SchedulerTaskRun>(`/api/v1/scheduler/tasks/${encodeURIComponent(id)}/run`, {
    method: "POST",
  });
}

export function listSchedulerTaskRuns(id: string, limit = 30) {
  return request<SchedulerTaskRunList>(`/api/v1/scheduler/tasks/${encodeURIComponent(id)}/runs?limit=${limit}`);
}

export function deleteSchedulerTask(id: string) {
  return request<{ status: string }>(`/api/v1/scheduler/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function toggleSchedulerTask(id: string) {
  return request<{ status: string; enabled: boolean }>(`/api/v1/scheduler/tasks/${encodeURIComponent(id)}/toggle`, {
    method: "POST",
  });
}
