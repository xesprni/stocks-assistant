import { ToggleRow } from "@/components/common/ToggleRow";
import { ColorSchemeRow } from "@/components/config/ColorSchemeRow";
import { ConfigField as Field } from "@/components/config/ConfigForm";
import { ConfigSection } from "@/components/config/ConfigSection";
import { ThemeColorPicker } from "@/components/config/ThemeColorPicker";
import type { ConfigPageState } from "@/components/config/useSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { getMessages, supportedLanguages } from "@/i18n";
import { BrainCircuit, Cpu, Database, RefreshCw, SlidersHorizontal, TerminalSquare, TrendingUp, WandSparkles } from "lucide-react";

type Props = Pick<ConfigPageState, "copy" | "draft" | "patchDraft" | "language"> & { draft: NonNullable<ConfigPageState["draft"]> };

export function SettingsFeatures({ copy, draft, patchDraft, language }: Props) {
  return (<TabsContent value="features" className="mt-0 space-y-5">
    <ConfigSection
      description={copy.personalPreferencesHint}
      icon={<SlidersHorizontal className="size-4 text-primary" />}
      title={copy.personalPreferences}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-end">
        <Field label={copy.language}>
          <div className="grid gap-2 sm:grid-cols-2">
            {supportedLanguages.map((option) => (
              <Button key={option.id} size="sm"
                variant={draft.app_language === option.id ? "default" : "outline"}
                onClick={() => patchDraft({ app_language: option.id })}
                lang={option.intlLocale}
              >{option.nativeName}</Button>
            ))}
          </div>
        </Field>
        <ColorSchemeRow language={language} />
      </div>
      <div className="mt-5 border-t border-border/50 pt-5">
        <ThemeColorPicker language={language} themeColor={draft.app_theme_color} onChange={(color) => patchDraft({ app_theme_color: color })} />
      </div>
    </ConfigSection>
    <ConfigSection
      description={copy.featureSectionHint}
      icon={<WandSparkles className="size-4 text-primary" />}
      title={copy.featureSection}
    >
      <div className="grid gap-3 xl:grid-cols-2 [&_label_span.truncate]:whitespace-normal">
        <ToggleRow
          checked={draft.memory_enabled}
          icon={<BrainCircuit className="size-4 text-primary" />}
          label={copy.memory}
          onCheckedChange={(checked) => patchDraft({ memory_enabled: checked })}
        />
        <ToggleRow
          checked={draft.knowledge_enabled}
          icon={<Database className="size-4 text-accent" />}
          label={copy.knowledge}
          onCheckedChange={(checked) => patchDraft({ knowledge_enabled: checked })}
        />
        <ToggleRow
          checked={draft.scheduler_enabled}
          icon={<RefreshCw className="size-4 text-secondary" />}
          label={copy.scheduler}
          onCheckedChange={(checked) => patchDraft({ scheduler_enabled: checked })}
        />
        <ToggleRow
          checked={draft.tracing_enabled}
          icon={<Cpu className="size-4 text-primary" />}
          label={copy.tracing}
          onCheckedChange={(checked) => patchDraft({ tracing_enabled: checked })}
        />
        <ToggleRow
          checked={draft.product_analytics_enabled}
          icon={<TrendingUp className="size-4 text-secondary" />}
          label={getMessages(language).settings.analyticsLabel}
          onCheckedChange={(checked) => patchDraft({ product_analytics_enabled: checked })}
        />
        <ToggleRow
          checked={draft.memory_auto_curate_enabled}
          icon={<WandSparkles className="size-4 text-primary" />}
          label={copy.memoryAutoCurate}
          onCheckedChange={(checked) => patchDraft({ memory_auto_curate_enabled: checked })}
        />
        <ToggleRow
          checked={draft.debug}
          icon={<TerminalSquare className="size-4 text-destructive" />}
          label={copy.debug}
          onCheckedChange={(checked) => patchDraft({ debug: checked })}
        />
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label={copy.memoryImportanceThreshold}>
          <Input
            max={1}
            min={0}
            step={0.05}
            type="number"
            value={draft.memory_curator_min_importance}
            onChange={(event) => patchDraft({ memory_curator_min_importance: Number(event.target.value) })}
          />
        </Field>
        <Field label={copy.memoryConfidenceThreshold}>
          <Input
            max={1}
            min={0}
            step={0.05}
            type="number"
            value={draft.memory_curator_min_confidence}
            onChange={(event) => patchDraft({ memory_curator_min_confidence: Number(event.target.value) })}
          />
        </Field>
      </div>
    </ConfigSection>
  </TabsContent>);
}
