import { ConfigSection } from "@/components/config/ConfigSection";
import type { ConfigPageState } from "@/components/config/useSettings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { getMessages } from "@/i18n";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw, ShieldCheck, WandSparkles } from "lucide-react";

type Props = Pick<ConfigPageState, "language" | "readinessLoading" | "copy" | "readiness" | "layoutCopy" | "testingComponent" | "handleConnectionTest" | "connectionMessage" | "demoDataLoading" | "handleSeedDemoData">;

export function SettingsOverview({ language, readinessLoading, copy, readiness, layoutCopy, testingComponent, handleConnectionTest, connectionMessage, demoDataLoading, handleSeedDemoData }: Props) {
  return (<TabsContent value="overview" className="mt-0 space-y-5">
    <ConfigSection
      description={getMessages(language).settings.readinessDescription}
      icon={<ShieldCheck className="size-4 text-primary" />}
      title={getMessages(language).settings.readinessTitle}
    >
      {readinessLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{copy.loading}</div>
      ) : readiness ? (
        <div className="divide-y divide-border/60">
          {readiness.checks.map((check) => {
            const testable = check.component === "llm" || check.component === "embedding" || check.component === "longbridge";
            return (
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0" key={check.component}>
                <div className="min-w-0 flex-1 basis-48">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", check.configured ? "bg-emerald-500" : check.status === "optional" ? "bg-muted-foreground/50" : "bg-amber-500")} />
                    <p className="text-sm font-medium">{{ llm: copy.modelSection, embedding: copy.embeddingSection, longbridge: "Longbridge", telegram: "Telegram", web_search: copy.webSearchSection }[check.component] ?? check.component}</p>
                    <Badge variant="outline" className="font-normal">{check.configured ? (layoutCopy.configured) : check.status === "optional" ? (layoutCopy.optional) : (layoutCopy.needsSetup)}</Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{check.detail}</p>
                </div>
                {testable ? (
                  <Button disabled={!check.configured || testingComponent !== null} onClick={() => handleConnectionTest(check.component as "llm" | "embedding" | "longbridge")} size="sm" type="button" variant="outline">
                    {testingComponent === check.component ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    {getMessages(language).settings.test}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{getMessages(language).settings.readinessUnavailable}</p>
      )}
      {connectionMessage ? <p role="status" className="mt-4 rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{connectionMessage}</p> : null}
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border/60 pt-5">
        <Button disabled={demoDataLoading} onClick={handleSeedDemoData} size="sm" type="button" variant="outline">
          {demoDataLoading ? <Loader2 className="animate-spin" /> : <WandSparkles />}
          {getMessages(language).settings.loadSampleData}
        </Button>
        <span className="text-xs text-muted-foreground">
          {getMessages(language).settings.sampleDataHint}
        </span>
      </div>
    </ConfigSection>
  </TabsContent>);
}
