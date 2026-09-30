import { SettingsAgent } from "@/components/config/sections/SettingsAgent";
import { SettingsChannels } from "@/components/config/sections/SettingsChannels";
import { SettingsFeatures } from "@/components/config/sections/SettingsFeatures";
import { SettingsLongbridge } from "@/components/config/sections/SettingsLongbridge";
import { SettingsMarket } from "@/components/config/sections/SettingsMarket";
import { SettingsModel } from "@/components/config/sections/SettingsModel";
import { SettingsOverview } from "@/components/config/sections/SettingsOverview";
import { SettingsSecurity } from "@/components/config/sections/SettingsSecurity";
import { type SettingsTab } from "@/components/config/settings-model";
import { useSettings, type ConfigPageProps } from "@/components/config/useSettings";
import { ChangePasswordDialog } from "@/components/security/ChangePasswordDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTemplate } from "@/i18n";
import { toDraft } from "@/lib/config";
import { cn } from "@/lib/utils";
import { ArrowRight, CircleCheck, Loader2, RefreshCw, Save, WandSparkles } from "lucide-react";
export type { ConfigTab } from "@/components/config/settings-model";
export function ConfigPage(props: ConfigPageProps) {
  const {
    canManageSystem, canReadMarket, canWriteMarket, config, configState,
    draft, enabledCount, handleSaveConfig, language, onConfigBlur,
    onConfigCompositionStart, onConfigCompositionEnd, onLongbridgeAuthChanged, marketSettings, patchDraft,
    setDraft, copy, layoutCopy, hasChanges, setActiveTab,
    wideNavigation, activeTab, navigationGroups, activeSection, readinessLoading,
    readiness, testingComponent, handleConnectionTest, connectionMessage, demoDataLoading,
    handleSeedDemoData, setIsPasswordDialogOpen, isCodexOAuth, selectLlmProvider, isEmbeddingCodexOAuth,
    selectEmbeddingProvider, reasoningEffortLabels, toolChoiceLabels, builtinTools, dangerousTools,
    expandedMcpServers, isLoadingTools, mcpToolGroups, selectAllBuiltinTools, setExpandedMcpServers,
    toggleAgentTool, selectedTools, telegramTestMessage, setTelegramTestMessage, setTelegramTestState,
    setTelegramTestResult, telegramTestPhotos, setTelegramTestPhotos, telegramTestState, handleTelegramTest,
    telegramTestResult, isPasswordDialogOpen,
  } = useSettings(props);

  return (
    <section
      id="config-form"
      className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl lg:h-full"
      onBlurCapture={(event) => {
        if (!(event.target instanceof Element) || !event.target.matches("input, textarea, select")) return;
        if (event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-config-reset]")) return;
        onConfigBlur();
      }}
      onCompositionStartCapture={onConfigCompositionStart}
      onCompositionEndCapture={onConfigCompositionEnd}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-border/65 px-4 py-5 sm:px-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
            <Badge variant="outline" className="font-normal text-muted-foreground">
              {canManageSystem ? (layoutCopy.systemScope) : (layoutCopy.personalScope)}
            </Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {layoutCopy.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span aria-live="polite" title={layoutCopy.autosaveHint} className={cn("mr-2 flex items-center gap-1.5 text-xs", configState === "error" ? "text-destructive" : "text-muted-foreground")}>
            {configState === "saving" ? (
              <><Loader2 className="size-3.5 animate-spin" />{copy.saving}</>
            ) : configState === "error" ? (
              layoutCopy.saveFailed
            ) : configState === "pending" || hasChanges ? (
              <><span className="size-1.5 rounded-full bg-amber-500" />{layoutCopy.unsaved}</>
            ) : config ? (
              <><CircleCheck className="size-3.5" />{configState === "saved" ? layoutCopy.autosaved : layoutCopy.autosaveEnabled}</>
            ) : null}
          </span>
          <Button
            aria-label={copy.reload}
            data-config-reset
            disabled={!config || configState === "saving"}
            variant="outline"
            size="sm"
            onClick={() => config && setDraft(toDraft(config))}
          >
            <RefreshCw />
            {copy.reload}
          </Button>
          <Button size="sm" disabled={configState === "saving" || !draft} onClick={handleSaveConfig}>
            {configState === "saving" ? <Loader2 className="animate-spin" /> : <Save />}
            {configState === "saving" ? copy.saving : configState === "error" ? layoutCopy.retrySave : layoutCopy.saveNow}
          </Button>
        </div>
      </header>

      {draft ? (
        <>
          <Tabs
            className="flex min-h-0 min-w-0 flex-1 flex-col lg:grid lg:grid-cols-[208px_minmax(0,1fr)] xl:grid-cols-[224px_minmax(0,1fr)]"
            onValueChange={(value) => setActiveTab(value as SettingsTab)}
            orientation={wideNavigation ? "vertical" : "horizontal"}
            value={activeTab}
          >
            <aside className="min-w-0 shrink-0 border-b border-border/65 bg-muted/10 p-3 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-4">
              <TabsList
                aria-label={layoutCopy.categories}
                className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-0 bg-transparent p-0 shadow-none lg:flex-col lg:items-stretch lg:gap-6"
              >
                {navigationGroups.map((group) => (
                  <div className="contents lg:block" key={group.label}>
                    <p className="mb-2 hidden px-3 text-[11px] font-medium text-muted-foreground/80 lg:block">{group.label}</p>
                    <div className="contents lg:flex lg:flex-col lg:gap-1">
                      {group.items.map((item) => (
                        <TabsTrigger
                          className="min-h-10 shrink-0 justify-start gap-2.5 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none [&_svg]:size-4 [&_svg]:shrink-0"
                          key={item.value}
                          value={item.value}
                        >
                          {item.icon}
                          {item.label}
                        </TabsTrigger>
                      ))}
                    </div>
                  </div>
                ))}
              </TabsList>
              <div className="mt-8 hidden rounded-lg border border-border/60 bg-background/60 p-3 lg:block">
                <div className="flex items-center gap-2 text-xs font-medium"><WandSparkles className="size-3.5 text-primary" />{copy.featureSection}</div>
                <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                  {formatTemplate(layoutCopy.featuresEnabled, { count: enabledCount })}
                </p>
                <button className="mt-2 flex items-center gap-1 text-xs font-medium text-primary hover:underline" onClick={() => setActiveTab("features")} type="button">
                  {layoutCopy.manageFeatures}<ArrowRight className="size-3" />
                </button>
              </div>
            </aside>
            <div className="min-h-0 min-w-0 px-4 py-6 sm:px-6 lg:overflow-y-auto lg:px-8">
              <div className="mx-auto w-full max-w-[1080px]">
                <div className="mb-6">
                  <h2 className="text-lg font-semibold tracking-tight">{activeSection?.label}</h2>
                  <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{activeSection?.description}</p>
                </div>
                <SettingsOverview language={language} readinessLoading={readinessLoading} copy={copy} readiness={readiness} layoutCopy={layoutCopy} testingComponent={testingComponent} handleConnectionTest={handleConnectionTest} connectionMessage={connectionMessage} demoDataLoading={demoDataLoading} handleSeedDemoData={handleSeedDemoData} />
                <SettingsSecurity copy={copy} setIsPasswordDialogOpen={setIsPasswordDialogOpen} canManageSystem={canManageSystem} draft={draft} patchDraft={patchDraft} />
                <SettingsModel copy={copy} isCodexOAuth={isCodexOAuth} selectLlmProvider={selectLlmProvider} patchDraft={patchDraft} draft={draft} isEmbeddingCodexOAuth={isEmbeddingCodexOAuth} selectEmbeddingProvider={selectEmbeddingProvider} />

                <SettingsAgent copy={copy} canManageSystem={canManageSystem} draft={draft} patchDraft={patchDraft} reasoningEffortLabels={reasoningEffortLabels} toolChoiceLabels={toolChoiceLabels} builtinTools={builtinTools} dangerousTools={dangerousTools} expandedMcpServers={expandedMcpServers} isLoadingTools={isLoadingTools} mcpToolGroups={mcpToolGroups} selectAllBuiltinTools={selectAllBuiltinTools} setExpandedMcpServers={setExpandedMcpServers} toggleAgentTool={toggleAgentTool} selectedTools={selectedTools} />

                <SettingsLongbridge copy={copy} draft={draft} language={language} onLongbridgeAuthChanged={onLongbridgeAuthChanged} patchDraft={patchDraft} layoutCopy={layoutCopy} />

                {canReadMarket ? (
                  <SettingsMarket language={language} marketSettings={marketSettings} canWriteMarket={canWriteMarket} />
                ) : null}

                <SettingsChannels copy={copy} draft={draft} patchDraft={patchDraft} telegramTestMessage={telegramTestMessage} setTelegramTestMessage={setTelegramTestMessage} setTelegramTestState={setTelegramTestState} setTelegramTestResult={setTelegramTestResult} language={language} telegramTestPhotos={telegramTestPhotos} setTelegramTestPhotos={setTelegramTestPhotos} telegramTestState={telegramTestState} handleTelegramTest={handleTelegramTest} telegramTestResult={telegramTestResult} />

                <SettingsFeatures copy={copy} draft={draft} patchDraft={patchDraft} language={language} />
              </div>
            </div>
          </Tabs>
          <ChangePasswordDialog
            language={language}
            onClose={() => setIsPasswordDialogOpen(false)}
            open={isPasswordDialogOpen}
          />

        </>
      ) : (
        <div className="flex flex-1 items-center justify-center gap-2 px-6 py-16 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" />
          {copy.loading}
        </div>
      )}
    </section>
  );
}
