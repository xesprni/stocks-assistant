import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useErrorToast } from "@/components/common/Toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getMarketConfig, saveMarketConfig } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { IndexConfig, MarketDashboardConfig } from "@/types/app";

type AppLanguage = "zh" | "en";

const marketConfigCopy = {
  zh: {
    back: "返回",
    title: "行情配置",
    subtitle: "指数监控列表与自动刷新间隔",
    resetDefault: "重置默认",
    save: "保存",
    saving: "保存中",
    saved: "已保存",
    loadFailed: "配置加载失败",
    saveFailed: "保存失败",
    readOnly: "只读",
    readOnlyHint: "当前账号无权限修改行情配置",
    refreshInterval: "自动刷新间隔（秒）",
    intervalRange: "范围：1-3600 秒",
    indexList: "指数监控列表",
    enabledCount: "{enabled} / {total} 启用",
    searchIndex: "搜索指数名称或代码...",
    enabledLabel: "{name} 启用",
    delete: "删除",
    addIndex: "添加指数",
    addSearch: "输入名称、代码或关键词搜索指数，如 恒生、SPX、上证...",
    noMatchedIndex: "未找到匹配的指数",
    allKnownAdded: "所有已知指数已添加",
    manualSymbol: "或手动输入代码，如 HSI.HK",
    displayName: "显示名称（可选）",
    add: "添加",
    loading: "加载配置中...",
  },
  en: {
    back: "Back",
    title: "Market Config",
    subtitle: "Index monitor list and auto-refresh interval",
    resetDefault: "Reset default",
    save: "Save",
    saving: "Saving",
    saved: "Saved",
    loadFailed: "Failed to load config",
    saveFailed: "Save failed",
    readOnly: "Read only",
    readOnlyHint: "This account cannot edit market config",
    refreshInterval: "Auto-refresh interval (seconds)",
    intervalRange: "Range: 1-3600 seconds",
    indexList: "Index monitor list",
    enabledCount: "{enabled} / {total} enabled",
    searchIndex: "Search index name or symbol...",
    enabledLabel: "{name} enabled",
    delete: "Delete",
    addIndex: "Add index",
    addSearch: "Search by name, symbol, or keyword, e.g. HSI, SPX, Shanghai...",
    noMatchedIndex: "No matching indices",
    allKnownAdded: "All known indices have been added",
    manualSymbol: "Or enter a symbol manually, e.g. HSI.HK",
    displayName: "Display name (optional)",
    add: "Add",
    loading: "Loading config...",
  },
} as const;

function formatTemplate(text: string, values: Record<string, string | number>) {
  return text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ""));
}

const DEFAULT_INDICES: IndexConfig[] = [
  { symbol: "HSI.HK", name: "恒生指数", enabled: true },
  { symbol: "HSCEI.HK", name: "国企指数", enabled: true },
  { symbol: ".SPX.US", name: "S&P 500", enabled: true },
  { symbol: ".NDX.US", name: "纳斯达克100", enabled: true },
  { symbol: ".DJI.US", name: "道琼斯", enabled: true },
  { symbol: "000001.SH", name: "上证综指", enabled: true },
  { symbol: "000300.SH", name: "沪深300", enabled: true },
];

interface IndexCatalogEntry {
  symbol: string;
  name: string;
  aliases: string[];
  market: "HK" | "US" | "CN";
}

const INDEX_CATALOG: IndexCatalogEntry[] = [
  // ── HK ──
  { symbol: "HSI.HK", name: "恒生指数", aliases: ["HSI", "hang seng"], market: "HK" },
  { symbol: "HSCEI.HK", name: "恒生中国企业指数", aliases: ["HSCEI", "国企", "H股"], market: "HK" },
  { symbol: "HSTECH.HK", name: "恒生科技指数", aliases: ["HSTECH", "科技"], market: "HK" },
  { symbol: "HSCFI.HK", name: "恒生红筹指数", aliases: ["HSCFI", "红筹"], market: "HK" },
  { symbol: "HSHCI.HK", name: "恒生香港上市生物科技指数", aliases: ["HSHCI", "生物科技"], market: "HK" },
  // ── US ──
  { symbol: ".SPX.US", name: "S&P 500", aliases: ["SPX", "标普", "标普500"], market: "US" },
  { symbol: ".NDX.US", name: "纳斯达克100", aliases: ["NDX", "纳斯达克", "纳指"], market: "US" },
  { symbol: ".DJI.US", name: "道琼斯工业平均指数", aliases: ["DJI", "道琼斯", "道指"], market: "US" },
  { symbol: ".VIX.US", name: "VIX波动率指数", aliases: ["VIX", "恐慌", "波动率"], market: "US" },
  { symbol: ".IXIC.US", name: "纳斯达克综合指数", aliases: ["IXIC", "纳指综合"], market: "US" },
  { symbol: ".RUT.US", name: "罗素2000", aliases: ["RUT", "罗素", "小盘"], market: "US" },
  { symbol: ".SOX.US", name: "费城半导体指数", aliases: ["SOX", "半导体", "费半"], market: "US" },
  // ── CN ──
  { symbol: "000001.SH", name: "上证综指", aliases: ["上证", "综指"], market: "CN" },
  { symbol: "000300.SH", name: "沪深300", aliases: ["沪深300", "HS300"], market: "CN" },
  { symbol: "000016.SH", name: "上证50", aliases: ["上证50"], market: "CN" },
  { symbol: "000905.SH", name: "中证500", aliases: ["中证500", "ZZ500"], market: "CN" },
  { symbol: "000852.SH", name: "中证1000", aliases: ["中证1000"], market: "CN" },
  { symbol: "399001.SZ", name: "深证成指", aliases: ["深证", "成指"], market: "CN" },
  { symbol: "399006.SZ", name: "创业板指", aliases: ["创业板", "CYB"], market: "CN" },
  { symbol: "399673.SZ", name: "创业板50", aliases: ["创业板50", "CYB50"], market: "CN" },
  { symbol: "399005.SZ", name: "中小板指", aliases: ["中小板"], market: "CN" },
  { symbol: "399303.SZ", name: "国证2000", aliases: ["国证2000"], market: "CN" },
];

interface Props {
  embedded?: boolean;
  language: AppLanguage;
  onBack?: () => void;
  onSaved: (config: MarketDashboardConfig) => void;
  readOnly?: boolean;
}

export function MarketConfigPage({ embedded = false, language, onBack, onSaved, readOnly = false }: Props) {
  const copy = marketConfigCopy[language];
  const [config, setConfig] = useState<MarketDashboardConfig | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [newSymbol, setNewSymbol] = useState("");
  const [newName, setNewName] = useState("");
  const [addSearch, setAddSearch] = useState("");
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const addDropdownRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState("");
  useErrorToast(error, copy.title);

  const filteredIndices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return config?.indices ?? [];
    return (config?.indices ?? []).filter(
      (idx) => idx.name.toLowerCase().includes(q) || idx.symbol.toLowerCase().includes(q),
    );
  }, [config?.indices, searchQuery]);

  const existingSymbols = useMemo(
    () => new Set((config?.indices ?? []).map((i) => i.symbol.toUpperCase())),
    [config?.indices],
  );

  const addSearchResults = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return INDEX_CATALOG.filter((e) => !existingSymbols.has(e.symbol.toUpperCase()));
    return INDEX_CATALOG.filter((e) => {
      if (existingSymbols.has(e.symbol.toUpperCase())) return false;
      return (
        e.name.toLowerCase().includes(q) ||
        e.symbol.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q))
      );
    });
  }, [addSearch, existingSymbols]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (addDropdownRef.current && !addDropdownRef.current.contains(e.target as Node)) {
        setShowAddDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    let mounted = true;
    getMarketConfig()
      .then((cfg) => {
        if (mounted) setConfig(cfg);
      })
      .catch((e) => {
        if (mounted) setError(e instanceof Error ? e.message : copy.loadFailed);
      });
    return () => {
      mounted = false;
    };
  }, []);

  function patchConfig(patch: Partial<MarketDashboardConfig>) {
    setConfig((c) => (c ? { ...c, ...patch } : c));
  }

  function toggleIndex(symbol: string, enabled: boolean) {
    if (readOnly) return;
    setConfig((c) =>
      c
        ? {
            ...c,
            indices: c.indices.map((idx) =>
              idx.symbol === symbol ? { ...idx, enabled } : idx,
            ),
          }
        : c,
    );
  }

  function removeIndex(symbol: string) {
    if (readOnly) return;
    setConfig((c) =>
      c ? { ...c, indices: c.indices.filter((idx) => idx.symbol !== symbol) } : c,
    );
  }

  function addIndex(sym?: string, nm?: string) {
    if (readOnly) return;
    const symbol = (sym ?? newSymbol).trim().toUpperCase();
    const name = (nm ?? newName).trim();
    if (!symbol) return;
    setConfig((c) => {
      if (!c) return c;
      if (c.indices.some((idx) => idx.symbol === symbol)) return c;
      return { ...c, indices: [...c.indices, { symbol, name: name || symbol, enabled: true }] };
    });
    setNewSymbol("");
    setNewName("");
    setAddSearch("");
    setShowAddDropdown(false);
  }

  function resetToDefault() {
    if (readOnly) return;
    setConfig((c) => (c ? { ...c, indices: DEFAULT_INDICES } : c));
  }

  async function handleSave() {
    if (!config || readOnly) return;
    setSaveState("saving");
    setError("");
    try {
      const saved = await saveMarketConfig(config);
      setConfig(saved);
      onSaved(saved);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.saveFailed);
      setSaveState("error");
    }
  }

  return (
    <section
      className={cn(
        embedded
          ? "rounded-md border border-border/80 bg-background/50"
          : "panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full",
      )}
    >
      <div
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
          embedded ? "border-b border-border/80 p-4" : "panel-header",
        )}
      >
        <div className="flex items-center gap-3">
          {!embedded && onBack ? (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onBack} aria-label={copy.back}>
              <ArrowLeft />
            </Button>
          ) : null}
          <div>
            <div className="flex items-center gap-2">
              <Settings2 className="size-5 text-secondary" />
              <p className="font-semibold">{copy.title}</p>
              {readOnly ? <Badge variant="outline">{copy.readOnly}</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">{readOnly ? copy.readOnlyHint : copy.subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={readOnly || !config} onClick={resetToDefault}>
            <RotateCcw />
            {copy.resetDefault}
          </Button>
          <Button size="sm" disabled={readOnly || saveState === "saving" || !config} onClick={handleSave}>
            {saveState === "saving" ? (
              <Loader2 className="animate-spin" />
            ) : saveState === "saved" ? (
              <Check />
            ) : (
              <Save />
            )}
            {saveState === "saving" ? copy.saving : saveState === "saved" ? copy.saved : copy.save}
          </Button>
        </div>
      </div>

      {config ? (
        <div className={cn("min-h-0 flex-1 space-y-6", embedded ? "p-4" : "panel-body lg:overflow-y-auto")}>
          {/* Refresh interval */}
          <div className="space-y-2">
            <Label>{copy.refreshInterval}</Label>
            <div className="flex items-center gap-3">
              <Input
                className="w-32"
                min={1}
                max={3600}
                type="number"
                disabled={readOnly}
                value={config.refresh_interval}
                onChange={(e) => patchConfig({ refresh_interval: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">{copy.intervalRange}</p>
            </div>
          </div>

          {/* Index list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{copy.indexList}</Label>
              <Badge variant="outline">{formatTemplate(copy.enabledCount, { enabled: config.indices.filter((i) => i.enabled).length, total: config.indices.length })}</Badge>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={copy.searchIndex}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              {filteredIndices.map((idx) => (
                <div
                  key={idx.symbol}
                  className="flex items-center gap-3 rounded-md border border-border/80 bg-background/50 px-3 py-2.5"
                >
                  <Switch
                    checked={idx.enabled}
                    disabled={readOnly}
                    onCheckedChange={(checked) => toggleIndex(idx.symbol, checked)}
                    aria-label={formatTemplate(copy.enabledLabel, { name: idx.name })}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{idx.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{idx.symbol}</p>
                  </div>
                  <Button
                    aria-label={copy.delete}
                    size="icon"
                    variant="ghost"
                    disabled={readOnly}
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeIndex(idx.symbol)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>

            {/* Add new index — search catalog */}
            {!readOnly ? (
              <div ref={addDropdownRef} className="rounded-lg border border-dashed border-border/70 bg-muted/10 p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">{copy.addIndex}</p>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder={copy.addSearch}
                    value={addSearch}
                    onChange={(e) => {
                      setAddSearch(e.target.value);
                      setShowAddDropdown(true);
                    }}
                    onFocus={() => setShowAddDropdown(true)}
                  />
                  {showAddDropdown && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-background shadow-lg">
                      {addSearchResults.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          {addSearch.trim() ? copy.noMatchedIndex : copy.allKnownAdded}
                        </div>
                      ) : (
                        addSearchResults.map((entry) => (
                          <button
                            key={entry.symbol}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/60 transition-colors"
                            type="button"
                            onClick={() => addIndex(entry.symbol, entry.name)}
                          >
                            <Badge variant="outline" className="shrink-0 text-[10px]">
                              {entry.market}
                            </Badge>
                            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {entry.symbol}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {/* Manual fallback */}
                <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                  <Input
                    className="font-mono"
                    placeholder={copy.manualSymbol}
                    value={newSymbol}
                    onChange={(e) => setNewSymbol(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addIndex();
                    }}
                  />
                  <Input
                    placeholder={copy.displayName}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addIndex();
                    }}
                  />
                  <Button
                    className="shrink-0"
                    disabled={!newSymbol.trim()}
                    onClick={() => addIndex()}
                    type="button"
                  >
                    <Plus />
                    {copy.add}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={cn(embedded ? "p-4" : "panel-body")}>
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {copy.loading}
          </div>
        </div>
      )}
    </section>
  );
}
