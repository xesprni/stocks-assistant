import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listSkills, refreshSkills, toggleSkill } from "@/lib/api";
import { formatTemplate, i18n } from "@/lib/i18n";
import type { AppLanguage } from "@/lib/i18n";
import type { SkillInfo } from "@/types/app";

// ── Skills Management ──────────────────────────────────────────────────────────

export function SkillsPage({ language }: { language: AppLanguage }) {
  const copy = i18n[language].skillsPage;
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [toggling, setToggling] = useState<string | null>(null);

  function loadSkills() {
    setIsLoading(true);
    setError("");
    refreshSkills().catch(() => {})
      .then(() => listSkills())
      .then((res) => setSkills(res.skills))
      .catch((e) => setError(e instanceof Error ? e.message : copy.loadFailed))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    loadSkills();
  }, []);

  async function handleToggle(name: string, enabled: boolean) {
    setToggling(name);
    try {
      await toggleSkill(name, !enabled);
      setSkills((prev) => prev.map((s) => s.name === name ? { ...s, enabled: !enabled } : s));
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.toggleFailed);
    } finally {
      setToggling(null);
    }
  }

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

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : skills.length > 0 ? (
          <div className="space-y-2">
            {skills.map((skill) => (
              <div
                key={skill.name}
                className="message-bubble rounded-lg border border-border/80 bg-card/80 p-3 transition-colors hover:border-primary/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold">{skill.name}</span>
                      <Badge variant={skill.enabled ? "default" : "muted"}>
                        {skill.enabled ? "ON" : "OFF"}
                      </Badge>
                    </div>
                    {skill.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
                    ) : null}
                    {skill.file_path ? (
                      <p className="mt-1 truncate text-[10px] font-mono text-muted-foreground/60">
                        {skill.file_path}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant={skill.enabled ? "outline" : "default"}
                    size="sm"
                    className="h-7 text-xs shrink-0"
                    disabled={toggling === skill.name}
                    onClick={() => handleToggle(skill.name, skill.enabled)}
                  >
                    {toggling === skill.name ? (
                      <Loader2 className="animate-spin" />
                    ) : skill.enabled ? (
                      copy.disable
                    ) : (
                      copy.enable
                    )}
                  </Button>
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
    </section>
  );
}

