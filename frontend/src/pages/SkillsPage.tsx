import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Download, ExternalLink, FileText, Loader2, RefreshCw, Search, ShieldCheck, Trash2, X, Zap } from "lucide-react";

import type { ConfirmFn } from "@/components/common/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  deleteSkill,
  getClawHubSkill,
  installClawHubSkill,
  listSkills,
  refreshSkills,
  searchClawHubSkills,
  toggleSkill,
} from "@/lib/api";
import { formatTemplate, i18n } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import type { ClawHubSearchResult, ClawHubSkillDetail, SkillInfo } from "@/types/app";

type SkillsPageProps = {
  confirmAction: ConfirmFn;
  language: AppLanguage;
};

function statusVariant(status?: string | null) {
  const normalized = status?.toLowerCase() ?? "";
  if (/(fail|suspicious|malicious|unsafe|high|blocked|rejected)/.test(normalized)) return "danger";
  if (/(safe|pass|passed|clean|ok|approved|verified|clear)/.test(normalized)) return "secondary";
  return "outline";
}

function sourceLabel(source?: string | null) {
  if (source === "clawhub") return "ClawHub";
  if (source === "builtin") return "Builtin";
  if (source === "custom") return "Custom";
  return source || "";
}

export function SkillsPage({ confirmAction, language }: SkillsPageProps) {
  const copy = i18n[language].skillsPage;
  const common = i18n[language].common;
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [marketResults, setMarketResults] = useState<ClawHubSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [marketError, setMarketError] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<ClawHubSkillDetail | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);
  const [installNotice, setInstallNotice] = useState("");

  const installedSlugs = useMemo(() => {
    const slugs = new Set<string>();
    for (const skill of skills) {
      if (skill.clawhub_slug) slugs.add(skill.clawhub_slug);
    }
    return slugs;
  }, [skills]);

  async function loadSkills() {
    setIsLoading(true);
    setError("");
    try {
      await refreshSkills().catch(() => undefined);
      const res = await listSkills();
      setSkills(res.skills);
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.loadFailed);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadSkills();
  }, []);

  async function handleToggle(name: string, enabled: boolean) {
    setToggling(name);
    try {
      await toggleSkill(name, enabled);
      setSkills((prev) => prev.map((skill) => skill.name === name ? { ...skill, enabled } : skill));
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.toggleFailed);
    } finally {
      setToggling(null);
    }
  }

  async function handleDeleteSkill(skill: SkillInfo) {
    const confirmed = await confirmAction({
      cancelText: common.cancel,
      confirmText: copy.delete,
      description: formatTemplate(copy.deleteConfirmBody, { name: skill.name }),
      destructive: true,
      title: copy.deleteConfirmTitle,
    });
    if (!confirmed) return;

    setDeleting(skill.name);
    setError("");
    try {
      await deleteSkill(skill.name);
      await loadSkills();
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.deleteFailed);
    } finally {
      setDeleting(null);
    }
  }

  async function openPreview(slug: string) {
    setIsPreviewOpen(true);
    setSelectedDetail(null);
    setDetailError("");
    setInstallNotice("");
    setIsDetailLoading(true);
    try {
      const detail = await getClawHubSkill(slug);
      setSelectedDetail(detail);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : copy.detailFailed);
    } finally {
      setIsDetailLoading(false);
    }
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = query.trim();
    setHasSearched(true);
    setMarketError("");
    setDetailError("");
    setInstallNotice("");
    setSelectedDetail(null);
    if (!trimmed) {
      setMarketResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await searchClawHubSkills(trimmed, 20);
      setMarketResults(response.results);
    } catch (e) {
      setMarketError(e instanceof Error ? e.message : copy.searchFailed);
      setMarketResults([]);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleInstall() {
    if (!selectedDetail) return;
    const confirmed = await confirmAction({
      cancelText: common.cancel,
      confirmText: copy.installConfirmButton,
      description: formatTemplate(copy.installConfirmBody, { name: selectedDetail.name || selectedDetail.slug }),
      title: copy.installConfirmTitle,
    });
    if (!confirmed) return;

    setInstallingSlug(selectedDetail.slug);
    setMarketError("");
    setInstallNotice("");
    try {
      await installClawHubSkill(selectedDetail.slug, { version: selectedDetail.version });
      await loadSkills();
      setInstallNotice(copy.installSuccess);
    } catch (e) {
      setMarketError(e instanceof Error ? e.message : copy.installFailed);
    } finally {
      setInstallingSlug(null);
    }
  }

  function isInstalled(result: ClawHubSearchResult | ClawHubSkillDetail) {
    return installedSlugs.has(result.slug);
  }

  const selectedLocalSkill = selectedDetail ? skills.find((skill) => skill.clawhub_slug === selectedDetail.slug) : undefined;
  const selectedInstalled = Boolean(selectedLocalSkill);

  return (
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Zap className="size-5 text-secondary" />
            <p className="font-semibold">{copy.title}</p>
          </div>
          <p className="text-xs text-muted-foreground">{copy.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{formatTemplate(copy.count, { count: skills.length })}</Badge>
          <Button variant="outline" size="sm" onClick={loadSkills} disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {copy.refresh}
          </Button>
        </div>
      </div>

      <div className="panel-body min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="space-y-5">
          <div className="min-w-0 space-y-3 rounded-md border border-border/80 bg-background/50 p-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{copy.marketplaceTitle}</p>
                  <Badge variant="secondary">{copy.marketplaceBadge}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{copy.marketplaceSubtitle}</p>
              </div>
            </div>

            <form className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={handleSearch}>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.searchPlaceholder}
                aria-label={copy.searchPlaceholder}
              />
              <Button type="submit" disabled={isSearching} className="shrink-0">
                {isSearching ? <Loader2 className="animate-spin" /> : <Search />}
                {common.search}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">{copy.searchHint}</p>

            {marketError ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {marketError}
              </div>
            ) : null}
            {installNotice ? (
              <div className="rounded-md border border-secondary/40 bg-secondary/10 px-3 py-2 text-sm text-secondary-foreground">
                {installNotice}
              </div>
            ) : null}

            {marketResults.length > 0 ? (
              <div className="grid max-h-[360px] gap-2 overflow-y-auto pr-1 md:grid-cols-2 xl:grid-cols-3">
                {marketResults.map((result) => (
                  <div
                    key={result.slug}
                    className="rounded-md border border-border/80 bg-card/70 p-3 transition-colors hover:border-primary/45"
                  >
                    <div className="flex min-w-0 items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{result.name || result.slug}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{result.slug}</p>
                      </div>
                      {isInstalled(result) ? <Badge variant="secondary">{copy.installed}</Badge> : null}
                    </div>
                    {result.summary || result.description ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {result.summary || result.description}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {result.owner ? <Badge variant="outline">{result.owner}</Badge> : null}
                      {result.version ? <Badge variant="muted">{result.version}</Badge> : null}
                      {result.scan_status ? <Badge variant={statusVariant(result.scan_status)}>{result.scan_status}</Badge> : null}
                    </div>
                    <Button className="mt-3 w-full" size="sm" variant="outline" onClick={() => openPreview(result.slug)}>
                      <FileText />
                      {copy.previewTitle}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            {hasSearched && !isSearching && marketResults.length === 0 && !marketError ? (
              <div className="rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center">
                <p className="text-sm font-medium">{copy.noResults}</p>
              </div>
            ) : null}

            {!hasSearched ? (
              <div className="rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center">
                <Search className="mx-auto mb-3 size-7 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{copy.selectResultHint}</p>
              </div>
            ) : null}
          </div>

          <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{copy.localTitle}</p>
                <p className="text-xs text-muted-foreground">{copy.localSubtitle}</p>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center rounded-md border border-border/80 bg-muted/20 py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : skills.length > 0 ? (
              <div className="grid gap-2 xl:grid-cols-2">
                {skills.map((skill) => (
                  <div
                    key={skill.name}
                    className="message-bubble rounded-md border border-border/80 bg-card/80 p-3 transition-colors hover:border-primary/50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold">{skill.name}</span>
                          <Badge variant={skill.enabled ? "default" : "muted"}>{skill.enabled ? "ON" : "OFF"}</Badge>
                          {skill.source ? <Badge variant="outline">{sourceLabel(skill.source)}</Badge> : null}
                          {skill.source === "clawhub" && !skill.enabled ? <Badge variant="secondary">{copy.installedDisabled}</Badge> : null}
                        </div>
                        {skill.description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{skill.description}</p> : null}
                        {skill.clawhub_owner || skill.clawhub_version ? (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {[skill.clawhub_owner, skill.clawhub_version].filter(Boolean).join(" · ")}
                          </p>
                        ) : null}
                        {skill.file_path ? (
                          <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/60">{skill.file_path}</p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {toggling === skill.name ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
                        <Switch
                          checked={skill.enabled}
                          disabled={toggling === skill.name}
                          onCheckedChange={(checked) => handleToggle(skill.name, checked)}
                        />
                        <Button
                          aria-label={`${copy.delete} ${skill.name}`}
                          disabled={skill.source === "builtin" || deleting === skill.name}
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDeleteSkill(skill)}
                        >
                          {deleting === skill.name ? <Loader2 className="animate-spin" /> : <Trash2 />}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid min-h-40 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center">
                <div>
                  <Zap className="mx-auto mb-3 size-8 text-muted-foreground" />
                  <p className="text-sm font-medium">{copy.emptyTitle}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{copy.emptyHint}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isPreviewOpen ? (
        <SkillPreviewDialog
          commonClose={common.close}
          copy={copy}
          detail={selectedDetail}
          detailError={detailError}
          installed={selectedInstalled}
          installedEnabled={Boolean(selectedLocalSkill?.enabled)}
          installing={installingSlug === selectedDetail?.slug}
          isLoading={isDetailLoading}
          onClose={() => setIsPreviewOpen(false)}
          onInstall={handleInstall}
        />
      ) : null}
    </section>
  );
}

function SkillPreviewDialog({
  commonClose,
  copy,
  detail,
  detailError,
  installed,
  installedEnabled,
  installing,
  isLoading,
  onClose,
  onInstall,
}: {
  commonClose: string;
  copy: typeof i18n.zh.skillsPage;
  detail: ClawHubSkillDetail | null;
  detailError: string;
  installed: boolean;
  installedEnabled: boolean;
  installing: boolean;
  isLoading: boolean;
  onClose: () => void;
  onInstall: () => void;
}) {
  const scanText = detail?.scan && Object.keys(detail.scan).length > 0 ? JSON.stringify(detail.scan, null, 2) : "";

  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center px-4 py-6">
      <button aria-label={commonClose} className="absolute inset-0 bg-background/65 backdrop-blur-[2px]" onClick={onClose} type="button" />
      <div className="relative flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/80 px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-primary" />
            <p className="text-sm font-semibold">{copy.previewTitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {detail?.canonical_url ? (
              <Button asChild variant="outline" size="sm">
                <a href={detail.canonical_url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  {copy.openInClawHub}
                </a>
              </Button>
            ) : null}
            {detail ? (
              <Button size="sm" disabled={installed || installing} onClick={onInstall}>
                {installing ? <Loader2 className="animate-spin" /> : <Download />}
                {installed ? copy.installed : installing ? copy.installing : copy.install}
              </Button>
            ) : null}
            <Button aria-label={commonClose} size="icon" variant="ghost" onClick={onClose}>
              <X />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="grid min-h-64 place-items-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : detail ? (
            <div className="space-y-3">
              {detailError ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{detailError}</div>
              ) : null}
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{detail.name || detail.slug}</p>
                  {installed ? <Badge variant="secondary">{installedEnabled ? copy.installed : copy.installedDisabled}</Badge> : null}
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail.summary || detail.description || detail.slug}</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Meta label={copy.owner} value={detail.owner || copy.unknown} />
                <Meta label={copy.version} value={detail.version || copy.unknown} />
                <Meta label={copy.updated} value={detail.updated_at || copy.unknown} />
                <Meta label={copy.source} value="ClawHub" />
              </div>

              <div className="rounded-md border border-border/80 bg-background/60 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <ShieldCheck className="size-4 text-secondary" />
                  <p className="text-xs font-semibold">{copy.scanTitle}</p>
                  {detail.scan_status ? <Badge variant={statusVariant(detail.scan_status)}>{copy.scan}: {detail.scan_status}</Badge> : null}
                  {detail.moderation_status ? <Badge variant={statusVariant(detail.moderation_status)}>{copy.moderation}: {detail.moderation_status}</Badge> : null}
                </div>
                {scanText ? (
                  <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-5 text-muted-foreground">{scanText}</pre>
                ) : (
                  <p className="text-xs text-muted-foreground">{detail.scan_error || copy.scanUnavailable}</p>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold">{copy.skillMdTitle}</p>
                {detail.skill_md ? (
                  <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/80 bg-background p-3 font-mono text-[11px] leading-5 text-foreground">{detail.skill_md}</pre>
                ) : (
                  <div className="rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center">
                    <p className="text-xs text-muted-foreground">{detail.preview_error || copy.previewUnavailable}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {detailError || copy.detailFailed}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/60 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xs text-foreground">{value}</p>
    </div>
  );
}
