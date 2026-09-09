import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Save, Upload } from "lucide-react";

import { useResearchDocuments } from "@/hooks/useResearchDocuments";
import { Field } from "@/components/common/Field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AppLanguage } from "@/lib/i18n";
import type { ResearchDocument } from "@/types/app";

export function ResearchDocumentsTab({ language, onChanged, symbol }: {
  language: AppLanguage; onChanged: () => Promise<void>; symbol: string;
}) {
  const { documents, detail, saving, loading, opening, error, file, form, setFile, setForm, save, open } = useResearchDocuments(symbol, onChanged);
  const en = language === "en";
  return (
    <div>
      {error ? <p role="alert" className="mb-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      {loading ? <p role="status" className="mb-3 text-sm text-muted-foreground">{en ? "Loading documents…" : "正在加载材料…"}</p> : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.4fr)]">
        <div className="space-y-3">
          <div className="rounded-md border border-border/80 bg-background/60 p-3">
            <h3 className="text-sm font-semibold">{en ? "Ingest research material" : "摄取研究材料"}</h3>
            <div className="mt-3 space-y-2">
              <Field label={en ? "Add version to" : "追加版本到"}>
                <Select value={form.document_id || "new"} onValueChange={(value) => setForm({ ...form, document_id: value === "new" ? "" : value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">New document</SelectItem>
                    {documents.map((item) => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={en ? "Title" : "标题"}>
                <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
              </Field>
              <Field label={en ? "Type" : "类型"}>
                <Select value={form.document_type} onValueChange={(value) => setForm({ ...form, document_type: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["filing", "transcript", "slides", "pdf", "article", "note"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Source URL"><Input value={form.source_url} onChange={(event) => setForm({ ...form, source_url: event.target.value })} /></Field>
              <Field label={en ? "Published at" : "发布时间"}><Input type="datetime-local" value={form.published_at} onChange={(event) => setForm({ ...form, published_at: event.target.value })} /></Field>
              <Field label={en ? "PDF / text file" : "PDF / 文本文件"}><Input accept=".pdf,.txt,.md" onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" /></Field>
              <Field label={en ? "Or paste text" : "或粘贴正文"}><Textarea className="min-h-36" value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} /></Field>
              <Button disabled={saving} onClick={() => void save()}>
                {saving ? <Loader2 className="animate-spin" /> : file ? <Upload /> : <Save />}
                {en ? "Ingest" : "保存材料"}
              </Button>
            </div>
          </div>
          {documents.map((document) => (
            <button className="w-full rounded-md border border-border/80 bg-background/60 p-3 text-left hover:border-primary/40" key={document.id} onClick={() => void open(document)}>
              <div className="flex items-center justify-between">
                <strong className="truncate text-sm">{document.title}</strong>
                <Badge variant="outline">v{document.latest_version}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{document.document_type} · {new Date(document.updated_at).toLocaleString()}</p>
            </button>
          ))}
        </div>
        <div>
          {opening ? <Loader2 aria-label={en ? "Loading document" : "正在加载材料"} className="animate-spin" />
            : detail ? <DocumentDetail detail={detail} language={language} />
              : <div className="grid min-h-72 place-items-center rounded-md border border-dashed border-border/80 text-sm text-muted-foreground">{en ? "Select a document to inspect versions and changes." : "选择材料查看版本、页码定位与变化。"}</div>}
        </div>
      </div>
    </div>
  );
}

function DocumentDetail({ detail, language }: { detail: ResearchDocument; language: AppLanguage }) {
  const [selected, setSelected] = useState(detail.versions[0]?.id);
  useEffect(() => setSelected(detail.versions[0]?.id), [detail.id]);
  const version = detail.versions.find((item) => item.id === selected) ?? detail.versions[0];
  const en = language === "en";
  return (
    <div className="rounded-md border border-border/80 bg-background/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h3 className="font-semibold">{detail.title}</h3><p className="text-xs text-muted-foreground">{detail.document_type}</p></div>
        {detail.source_url ? <Button asChild size="sm" variant="outline"><a href={detail.source_url} rel="noreferrer" target="_blank"><ExternalLink />Source</a></Button> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {detail.versions.map((item) => <Button key={item.id} onClick={() => setSelected(item.id)} size="sm" variant={item.id === version?.id ? "secondary" : "outline"}>v{item.version}</Button>)}
      </div>
      {version ? <>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Stat label={en ? "Added lines" : "新增行"} value={version.change_summary.added_lines ?? 0} />
          <Stat label={en ? "Removed lines" : "删除行"} value={version.change_summary.removed_lines ?? 0} />
          <Stat label={en ? "Pages" : "页数"} value={version.locator.pages?.length ?? 0} />
        </div>
        {version.change_summary.diff?.length ? <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-xs">{version.change_summary.diff.join("\n")}</pre> : null}
        <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-md border border-border/70 p-3 text-xs leading-5">{version.content}</pre>
      </> : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-md border border-border/70 bg-muted/15 p-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}
