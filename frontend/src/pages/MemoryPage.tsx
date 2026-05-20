import { useEffect, useState } from "react";
import { BrainCircuit, ChevronDown, ChevronRight, Cpu, Database, FileText, Loader2, Plus, RefreshCw, Save, Search, Trash2 } from "lucide-react";

import { Field } from "@/components/common/Field";
import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { SideDrawer } from "@/components/common/SideDrawer";
import { StatusTile } from "@/components/common/StatusTile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { addMemory, deleteMemoryFile, deleteMemoryIndex, getMemoryFile, getMemoryStatus, listMemoryFiles, searchMemory, syncMemory } from "@/lib/api";
import { formatTemplate, i18n } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { MemoryFile, MemorySearchResult, MemoryStatus } from "@/types/app";

// ── Memory Page ──────────────────────────────────────────────────────────────

const memoryPageCopy = {
  zh: {
    title: "长期记忆",
    subtitle: "混合搜索 · 向量 + FTS5 关键词",
    sync: "Sync",
    add: "Add",
    chunks: "Chunks",
    files: "Files",
    dirty: "Dirty",
    yes: "Yes",
    no: "No",
    provider: "Provider",
    addMemory: "添加记忆",
    content: "记忆内容",
    contentPlaceholder: "输入需要记住的内容...",
    cancel: "取消",
    save: "保存",
    searchPlaceholder: "搜索记忆...",
    search: "Search",
    results: "{count} results",
    score: "score: {score}",
    memoryFiles: "{count} memory files",
    indexed: "Indexed",
    deleteMemory: "删除记忆",
    loading: "Loading...",
    emptyTitle: "暂无记忆文件",
    emptyHint: "通过对话或手动添加积累记忆。",
    searchFailed: "搜索失败",
    syncFailed: "同步失败",
    loadFailed: "加载失败",
    addFailed: "添加失败",
    deleteIndexConfirm: "确定删除该索引记忆？这会从长期记忆搜索中移除。",
    deleteFileConfirm: "确定删除该记忆文件及其索引？",
    deleteFailed: "删除失败",
  },
  en: {
    title: "Long-term Memory",
    subtitle: "Hybrid search · vectors + FTS5 keywords",
    sync: "Sync",
    add: "Add",
    chunks: "Chunks",
    files: "Files",
    dirty: "Dirty",
    yes: "Yes",
    no: "No",
    provider: "Provider",
    addMemory: "Add Memory",
    content: "Memory content",
    contentPlaceholder: "Enter the content to remember...",
    cancel: "Cancel",
    save: "Save",
    searchPlaceholder: "Search memory...",
    search: "Search",
    results: "{count} results",
    score: "score: {score}",
    memoryFiles: "{count} memory files",
    indexed: "Indexed",
    deleteMemory: "Delete memory",
    loading: "Loading...",
    emptyTitle: "No memory files",
    emptyHint: "Build memory through conversations or manual additions.",
    searchFailed: "Search failed",
    syncFailed: "Sync failed",
    loadFailed: "Load failed",
    addFailed: "Add failed",
    deleteIndexConfirm: "Delete this indexed memory? This removes it from long-term memory search.",
    deleteFileConfirm: "Delete this memory file and its index?",
    deleteFailed: "Delete failed",
  },
} as const;

export function MemoryPage({ confirmAction, language }: { confirmAction: ConfirmFn; language: AppLanguage }) {
  const common = i18n[language].common;
  const copy = memoryPageCopy[language];
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [results, setResults] = useState<MemorySearchResult[]>([]);
  const [query, setQuery] = useState("");
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addContent, setAddContent] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.allSettled([getMemoryStatus(), listMemoryFiles()])
      .then(([statusRes, filesRes]) => {
        if (statusRes.status === "fulfilled") setStatus(statusRes.value);
        if (filesRes.status === "fulfilled") setFiles(filesRes.value.files);
      })
      .finally(() => setIsLoading(false));
  }, []);

  function handleSearch() {
    const text = query.trim();
    if (!text || isSearching) return;
    setIsSearching(true);
    setError("");
    searchMemory(text, { limit: 20 })
      .then((res) => setResults(res))
      .catch((e) => setError(e instanceof Error ? e.message : copy.searchFailed))
      .finally(() => setIsSearching(false));
  }

  function handleSync() {
    setIsSyncing(true);
    syncMemory()
      .then(() => getMemoryStatus().then(setStatus))
      .catch((e) => setError(e instanceof Error ? e.message : copy.syncFailed))
      .finally(() => setIsSyncing(false));
  }

  async function handleExpand(path: string) {
    if (expandedPath === path) {
      setExpandedPath(null);
      setFileContent(null);
      return;
    }
    setExpandedPath(path);
    setFileContent(null);
    try {
      const res = await getMemoryFile(path);
      setFileContent(res.content);
    } catch {
      setFileContent(copy.loadFailed);
    }
  }

  async function handleAdd() {
    if (!addContent.trim() || isAdding) return;
    setIsAdding(true);
    try {
      await addMemory(addContent.trim());
      setAddContent("");
      setShowAddForm(false);
      listMemoryFiles().then((res) => setFiles(res.files));
      getMemoryStatus().then(setStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.addFailed);
    } finally {
      setIsAdding(false);
    }
  }

  async function refreshMemory() {
    const [filesRes, statusRes] = await Promise.all([listMemoryFiles(), getMemoryStatus()]);
    setFiles(filesRes.files);
    setStatus(statusRes);
  }

  async function handleDeleteMemoryFile(file: MemoryFile) {
    const message = file.indexed_only
      ? copy.deleteIndexConfirm
      : copy.deleteFileConfirm;
    const confirmed = await confirmAction({
      cancelText: common.cancel,
      confirmText: common.delete,
      description: message,
      destructive: true,
      title: copy.deleteMemory,
    });
    if (!confirmed) return;
    setDeletingPath(file.path);
    setError("");
    try {
      if (file.indexed_only) {
        await deleteMemoryIndex(file.path);
      } else {
        await deleteMemoryFile(file.path);
      }
      if (expandedPath === file.path) {
        setExpandedPath(null);
        setFileContent(null);
      }
      await refreshMemory();
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.deleteFailed);
    } finally {
      setDeletingPath(null);
    }
  }

  return (
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="size-5 text-primary" />
            <p className="font-semibold">{copy.title}</p>
          </div>
          <p className="text-xs text-muted-foreground">{copy.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSync} disabled={isSyncing}>
            {isSyncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {copy.sync}
          </Button>
          <Button size="sm" onClick={() => setShowAddForm(true)} disabled={showAddForm}>
            <Plus />
            {copy.add}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      ) : null}

      {status ? (
        <div className="mx-3 mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatusTile icon={<Database className="size-4 text-primary" />} label={copy.chunks} value={String(status.chunks)} />
          <StatusTile icon={<FileText className="size-4 text-accent" />} label={copy.files} value={String(status.files)} />
          <StatusTile icon={<RefreshCw className="size-4 text-secondary" />} label={copy.dirty} value={status.dirty ? copy.yes : copy.no} />
          <StatusTile icon={<Cpu className="size-4 text-primary" />} label={copy.provider} value={status.embedding_provider || "-"} />
        </div>
      ) : null}

      <div className="panel-body min-h-0 flex-1 overflow-y-auto">
        <SideDrawer
          open={showAddForm}
          title={copy.addMemory}
          subtitle={copy.subtitle}
          onClose={() => setShowAddForm(false)}
          cancelText={copy.cancel}
          formId="memory-add-form"
          isSaving={isAdding}
          saveDisabled={!addContent.trim()}
          saveText={copy.save}
        >
          <form
            id="memory-add-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleAdd();
            }}
          >
            <Field label={copy.content}>
              <Textarea className="min-h-[180px]" placeholder={copy.contentPlaceholder} value={addContent} onChange={(e) => setAddContent(e.target.value)} />
            </Field>
          </form>
        </SideDrawer>

        <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); handleSearch(); }}>
          <Input placeholder={copy.searchPlaceholder} value={query} onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" disabled={isSearching || !query.trim()} className="shrink-0">
            {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
            {copy.search}
          </Button>
        </form>

        {results.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{formatTemplate(copy.results, { count: results.length })}</p>
            {results.map((r, i) => (
              <div key={`${r.path}-${i}`} className="rounded-lg border border-border/80 bg-card/80 p-3">
                <div className="flex items-center gap-2">
                  <FileText className="size-3.5 text-primary" />
                  <span className="truncate text-xs font-medium">{r.path}</span>
                  <Badge variant="outline" className="text-[10px]">L{r.start_line}-{r.end_line}</Badge>
                  <span className="text-[11px] text-muted-foreground">{formatTemplate(copy.score, { score: r.score.toFixed(3) })}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground line-clamp-4">{r.snippet}</p>
              </div>
            ))}
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : files.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{formatTemplate(copy.memoryFiles, { count: files.length })}</p>
            {files.map((f) => (
              <div key={f.path}>
                <div className={cn("flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60", expandedPath === f.path && "bg-muted/60")}>
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => handleExpand(f.path)}
                  >
                    {expandedPath === f.path ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                    <FileText className="size-3.5 shrink-0 text-primary" />
                    <span className="flex-1 truncate font-medium">{f.path}</span>
                    {f.indexed_only ? <Badge variant="outline" className="text-[10px]">{copy.indexed}</Badge> : null}
                    <span className="text-[10px] text-muted-foreground">{(f.size / 1024).toFixed(1)}KB</span>
                  </button>
                  <Button
                    aria-label={copy.deleteMemory}
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    disabled={deletingPath === f.path}
                    onClick={() => handleDeleteMemoryFile(f)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    {deletingPath === f.path ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                  </Button>
                </div>
                {expandedPath === f.path ? (
                  <pre className="mx-3 mb-1 max-h-64 overflow-auto rounded-md border border-border/80 bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">{fileContent ?? copy.loading}</pre>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid min-h-40 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center">
            <div>
              <BrainCircuit className="mx-auto mb-3 size-8 text-muted-foreground" />
              <p className="text-sm font-medium">{copy.emptyTitle}</p>
              <p className="mt-1 text-xs text-muted-foreground">{copy.emptyHint}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
