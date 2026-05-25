import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, FileText, Loader2, Plus, Save } from "lucide-react";

import { Field } from "@/components/common/Field";
import { SideDrawer } from "@/components/common/SideDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getKnowledgeFile, getKnowledgeGraph, getKnowledgeTree, saveKnowledgeUrl, uploadKnowledgeFile } from "@/lib/api";
import { formatTemplate } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { KnowledgeDir, KnowledgeGraph, KnowledgeTree } from "@/types/app";

// ── Knowledge Page ───────────────────────────────────────────────────────────

const knowledgePageCopy = {
  zh: {
    title: "知识库",
    subtitle: "Markdown 知识文件 · 目录浏览与搜索",
    pagesBadge: "{pages} pages · {size}KB",
    add: "Add",
    files: "文件",
    graph: "图谱 ({count})",
    addTitle: "添加知识文件",
    addSubtitle: "上传本地文本文件，或读取 URL 内容保存为 Markdown。",
    targetDir: "保存目录",
    targetDirPlaceholder: "可选，例如 research/2026",
    uploadFile: "上传文件",
    upload: "Upload",
    urlPlaceholder: "https://example.com/article.md 或网页 URL",
    saveUrl: "Save URL",
    cancel: "取消",
    save: "保存",
    nodes: "{count} nodes",
    links: "{count} links",
    emptyGraphTitle: "暂无知识图谱",
    emptyGraphHint: "在 knowledge/ 目录下添加含内部链接的 Markdown 文件。",
    searchFiles: "搜索文件...",
    emptyFiles: "暂无知识文件",
    selectFileTitle: "选择文件查看内容",
    selectFileHint: "点击左侧文件树中的文件。",
    loadFailed: "加载失败",
    libraryLoadFailed: "知识库加载失败",
    savedTo: "已保存到 {path}",
    uploadFailed: "上传失败",
    urlSaveFailed: "URL 保存失败",
  },
  en: {
    title: "Knowledge",
    subtitle: "Markdown knowledge files · directory browsing and search",
    pagesBadge: "{pages} pages · {size}KB",
    add: "Add",
    files: "Files",
    graph: "Graph ({count})",
    addTitle: "Add Knowledge File",
    addSubtitle: "Upload a local text file, or fetch a URL and save it as Markdown.",
    targetDir: "Save directory",
    targetDirPlaceholder: "Optional, e.g. research/2026",
    uploadFile: "Upload file",
    upload: "Upload",
    urlPlaceholder: "https://example.com/article.md or a web URL",
    saveUrl: "Save URL",
    cancel: "Cancel",
    save: "Save",
    nodes: "{count} nodes",
    links: "{count} links",
    emptyGraphTitle: "No knowledge graph",
    emptyGraphHint: "Add Markdown files with internal links under the knowledge/ directory.",
    searchFiles: "Search files...",
    emptyFiles: "No knowledge files",
    selectFileTitle: "Select a file to view content",
    selectFileHint: "Click a file in the tree on the left.",
    loadFailed: "Load failed",
    libraryLoadFailed: "Failed to load knowledge base",
    savedTo: "Saved to {path}",
    uploadFailed: "Upload failed",
    urlSaveFailed: "Failed to save URL",
  },
} as const;

export function KnowledgePage({ language }: { language: AppLanguage }) {
  const copy = knowledgePageCopy[language];
  const [tree, setTree] = useState<KnowledgeTree | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [viewMode, setViewMode] = useState<"tree" | "graph">("tree");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [showImportPanel, setShowImportPanel] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [urlToSave, setUrlToSave] = useState("");
  const [targetDir, setTargetDir] = useState("");
  const [isSavingKnowledge, setIsSavingKnowledge] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

  async function refreshKnowledge() {
    setIsLoading(true);
    setError("");
    const [treeRes, graphRes] = await Promise.allSettled([getKnowledgeTree(), getKnowledgeGraph()]);
    if (treeRes.status === "fulfilled") {
      setTree(treeRes.value);
      const dirs = new Set<string>();
      const collectDirs = (items: KnowledgeDir[], prefix = "") => {
        items.forEach((d) => {
          const key = `${prefix}${d.dir}`;
          dirs.add(key);
          collectDirs(d.children, `${key}/`);
        });
      };
      collectDirs(treeRes.value.tree);
      setExpandedDirs(dirs);
    } else {
      setError(treeRes.reason instanceof Error ? treeRes.reason.message : copy.libraryLoadFailed);
    }
    if (graphRes.status === "fulfilled") {
      setGraph(graphRes.value);
    }
    setIsLoading(false);
  }

  useEffect(() => {
    void refreshKnowledge();
  }, []);

  async function handleSelectFile(path: string) {
    setSelectedPath(path);
    setContent(null);
    setIsLoadingContent(true);
    try {
      const res = await getKnowledgeFile(path);
      setContent(res.content);
    } catch {
      setContent(copy.loadFailed);
    } finally {
      setIsLoadingContent(false);
    }
  }

  function toggleDir(dir: string) {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir); else next.add(dir);
      return next;
    });
  }

  async function handleUploadKnowledge() {
    if (!uploadFile) return;
    setIsSavingKnowledge(true);
    setError("");
    setNotice("");
    try {
      const res = await uploadKnowledgeFile(uploadFile, targetDir.trim() || undefined);
      setNotice(formatTemplate(copy.savedTo, { path: res.path }));
      setUploadFile(null);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
      setViewMode("tree");
      setShowImportPanel(false);
      await refreshKnowledge();
      await handleSelectFile(res.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.uploadFailed);
    } finally {
      setIsSavingKnowledge(false);
    }
  }

  async function handleSaveUrl() {
    if (!urlToSave.trim()) return;
    setIsSavingKnowledge(true);
    setError("");
    setNotice("");
    try {
      const res = await saveKnowledgeUrl({ url: urlToSave.trim(), directory: targetDir.trim() || undefined });
      setNotice(formatTemplate(copy.savedTo, { path: res.path }));
      setUrlToSave("");
      setViewMode("tree");
      setShowImportPanel(false);
      await refreshKnowledge();
      await handleSelectFile(res.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.urlSaveFailed);
    } finally {
      setIsSavingKnowledge(false);
    }
  }

  function matchesSearch(name: string, title: string): boolean {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return name.toLowerCase().includes(q) || title.toLowerCase().includes(q);
  }

  async function handleSaveKnowledgeImport() {
    if (uploadFile) {
      await handleUploadKnowledge();
      return;
    }
    if (urlToSave.trim()) {
      await handleSaveUrl();
    }
  }

  function renderDir(dir: KnowledgeDir, prefix = "") {
    const key = prefix + dir.dir;
    const isExpanded = expandedDirs.has(key);
    const hasMatchingFiles = dir.files.some((f) => matchesSearch(f.name, f.title)) || dir.children.length > 0;

    if (searchQuery.trim() && !hasMatchingFiles) return null;

    return (
      <div key={key}>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60"
          onClick={() => toggleDir(key)}
        >
          {isExpanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
          <span className="font-medium">{dir.dir}</span>
          <Badge variant="muted" className="text-[10px]">{dir.files.length}</Badge>
        </button>
        {isExpanded ? (
          <div className="ml-4">
            {dir.files.filter((f) => matchesSearch(f.name, f.title)).map((f) => {
              const filePath = `${key}/${f.name}`;
              return (
                <button
                  key={f.name}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60",
                    selectedPath === filePath && "bg-primary/10 text-primary",
                  )}
                  onClick={() => handleSelectFile(filePath)}
                >
                  <FileText className="size-3.5 shrink-0" />
                  <span className="flex-1 truncate">{f.title}</span>
                  <span className="text-[10px] text-muted-foreground">{(f.size / 1024).toFixed(1)}KB</span>
                </button>
              );
            })}
            {dir.children.map((c) => renderDir(c, key + "/"))}
          </div>
        ) : null}
      </div>
    );
  }

  const totalNodes = graph?.nodes.length ?? 0;
  const totalLinks = graph?.links.length ?? 0;

  return (
    <section className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            <p className="font-semibold">{copy.title}</p>
          </div>
          <p className="text-xs text-muted-foreground">{copy.subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tree ? <Badge variant="outline">{formatTemplate(copy.pagesBadge, { pages: tree.stats.pages, size: (tree.stats.size / 1024).toFixed(0) })}</Badge> : null}
          <Button size="sm" onClick={() => setShowImportPanel(true)} disabled={showImportPanel}>
            <Plus />
            {copy.add}
          </Button>
          <div className="flex rounded-md border border-border/80 bg-muted/40 p-1">
            <button
              className={cn("h-7 rounded-sm px-3 text-xs font-medium transition-all", viewMode === "tree" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
              onClick={() => setViewMode("tree")} type="button"
            >
              {copy.files}
            </button>
            <button
              className={cn("h-7 rounded-sm px-3 text-xs font-medium transition-all", viewMode === "graph" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
              onClick={() => setViewMode("graph")} type="button"
            >
              {formatTemplate(copy.graph, { count: totalNodes })}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mx-3 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      ) : null}

      {notice ? (
        <div className="mx-3 mt-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</div>
      ) : null}

      <SideDrawer
        open={showImportPanel}
        title={copy.addTitle}
        subtitle={copy.addSubtitle}
        onClose={() => setShowImportPanel(false)}
        cancelText={copy.cancel}
        formId="knowledge-import-form"
        isSaving={isSavingKnowledge}
        saveDisabled={!uploadFile && !urlToSave.trim()}
        saveText={copy.save}
      >
        <form
          id="knowledge-import-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSaveKnowledgeImport();
          }}
        >
          <Field label={copy.targetDir}>
            <Input
              placeholder={copy.targetDirPlaceholder}
              value={targetDir}
              onChange={(e) => setTargetDir(e.target.value)}
            />
          </Field>
          <Field label={copy.uploadFile}>
            <div className="flex gap-2">
              <Input
                ref={uploadInputRef}
                type="file"
                accept=".md,.markdown,.txt,.csv,.json,.log,.html,.htm,text/*"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </Field>
          <Field label={copy.saveUrl}>
            <Input
              placeholder={copy.urlPlaceholder}
              value={urlToSave}
              onChange={(e) => setUrlToSave(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSaveUrl();
                }
              }}
            />
          </Field>
        </form>
      </SideDrawer>

      <div className="panel-body min-h-0 flex-1 lg:overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : viewMode === "graph" ? (
          <div className="min-h-0 p-3 lg:h-full lg:overflow-y-auto">
            {graph && graph.nodes.length > 0 ? (
              <div className="space-y-4">
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>{formatTemplate(copy.nodes, { count: totalNodes })}</span>
                  <span>{formatTemplate(copy.links, { count: totalLinks })}</span>
                </div>
                <div className="space-y-1">
                  {graph.nodes.map((node) => {
                    const linkedCount = graph.links.filter((l) => l.source === node.id || l.target === node.id).length;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md border border-border/80 bg-card/80 px-3 py-2 text-left transition-colors hover:border-primary/50"
                        onClick={() => handleSelectFile(node.id)}
                      >
                        <FileText className="size-3.5 shrink-0 text-primary" />
                        <span className="flex-1 truncate text-sm font-medium">{node.label}</span>
                        <Badge variant="muted" className="text-[10px]">{node.category}</Badge>
                        {linkedCount > 0 ? <span className="text-[10px] text-muted-foreground">{linkedCount} links</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="grid h-full min-h-40 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center">
                <div>
                  <BookOpen className="mx-auto mb-3 size-8 text-muted-foreground" />
                  <p className="text-sm font-medium">{copy.emptyGraphTitle}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{copy.emptyGraphHint}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid min-h-0 gap-3 lg:h-full lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col rounded-lg border border-border/80 bg-background/45 p-2 lg:overflow-y-auto">
              <div className="mb-2">
                <Input placeholder={copy.searchFiles} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="h-7 text-xs" />
              </div>
              {tree && (tree.root_files.length > 0 || tree.tree.length > 0) ? (
                <div className="flex-1 space-y-0.5">
                  {tree.root_files.filter((f) => matchesSearch(f.name, f.title)).map((f) => (
                    <button
                      key={f.name}
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted/60",
                        selectedPath === f.name && "bg-primary/10 text-primary",
                      )}
                      onClick={() => handleSelectFile(f.name)}
                    >
                      <FileText className="size-3.5 shrink-0" />
                      <span className="flex-1 truncate">{f.title}</span>
                    </button>
                  ))}
                  {tree.tree.map((d) => renderDir(d))}
                </div>
              ) : (
                <div className="flex-1 grid place-items-center px-3 text-center">
                  <div>
                    <BookOpen className="mx-auto mb-2 size-6 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">{copy.emptyFiles}</p>
                  </div>
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 rounded-lg border border-border/80 bg-background/45 lg:overflow-y-auto">
              {selectedPath ? (
                <div className="p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <FileText className="size-4 text-primary" />
                    <span className="text-sm font-semibold">{selectedPath}</span>
                  </div>
                  {isLoadingContent ? (
                    <div className="flex items-center justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
                  ) : (
                    <pre className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{content ?? ""}</pre>
                  )}
                </div>
              ) : (
                <div className="grid h-full place-items-center px-4 text-center">
                  <div>
                    <BookOpen className="mx-auto mb-3 size-8 text-muted-foreground" />
                    <p className="text-sm font-medium">{copy.selectFileTitle}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{copy.selectFileHint}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
