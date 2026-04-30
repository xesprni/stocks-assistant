import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getMarketConfig, saveMarketConfig } from "@/lib/api";
import type { IndexConfig, MarketDashboardConfig } from "@/types/app";

const DEFAULT_INDICES: IndexConfig[] = [
  { symbol: ".HSI.HK", name: "恒生指数", enabled: true },
  { symbol: ".HSCEI.HK", name: "国企指数", enabled: true },
  { symbol: ".SPX.US", name: "S&P 500", enabled: true },
  { symbol: ".NDX.US", name: "纳斯达克100", enabled: true },
  { symbol: ".DJI.US", name: "道琼斯", enabled: true },
  { symbol: "000001.SH", name: "上证综指", enabled: true },
  { symbol: "000300.SH", name: "沪深300", enabled: true },
];

interface Props {
  onBack: () => void;
  onSaved: (config: MarketDashboardConfig) => void;
}

export function MarketConfigPage({ onBack, onSaved }: Props) {
  const [config, setConfig] = useState<MarketDashboardConfig | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [newSymbol, setNewSymbol] = useState("");
  const [newName, setNewName] = useState("");

  useEffect(() => {
    let mounted = true;
    getMarketConfig()
      .then((cfg) => {
        if (mounted) setConfig(cfg);
      })
      .catch((e) => {
        if (mounted) setError(e instanceof Error ? e.message : "配置加载失败");
      });
    return () => {
      mounted = false;
    };
  }, []);

  function patchConfig(patch: Partial<MarketDashboardConfig>) {
    setConfig((c) => (c ? { ...c, ...patch } : c));
  }

  function toggleIndex(symbol: string, enabled: boolean) {
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
    setConfig((c) =>
      c ? { ...c, indices: c.indices.filter((idx) => idx.symbol !== symbol) } : c,
    );
  }

  function addIndex() {
    const sym = newSymbol.trim().toUpperCase();
    const nm = newName.trim();
    if (!sym) return;
    setConfig((c) => {
      if (!c) return c;
      if (c.indices.some((idx) => idx.symbol === sym)) return c;
      return { ...c, indices: [...c.indices, { symbol: sym, name: nm || sym, enabled: true }] };
    });
    setNewSymbol("");
    setNewName("");
  }

  function resetToDefault() {
    setConfig((c) => (c ? { ...c, indices: DEFAULT_INDICES } : c));
  }

  async function handleSave() {
    if (!config) return;
    setSaveState("saving");
    setError("");
    try {
      const saved = await saveMarketConfig(config);
      setConfig(saved);
      onSaved(saved);
      setSaveState("saved");
      window.setTimeout(() => setSaveState("idle"), 1400);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
      setSaveState("error");
    }
  }

  return (
    <section className="panel motion-panel page-enter flex h-full min-h-0 min-w-0 flex-1 flex-col rounded-md">
      <div className="panel-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onBack} aria-label="返回">
            <ArrowLeft />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Settings2 className="size-5 text-secondary" />
              <p className="font-semibold">行情配置</p>
            </div>
            <p className="text-xs text-muted-foreground">指数监控列表与自动刷新间隔</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={resetToDefault}>
            <RotateCcw />
            重置默认
          </Button>
          <Button size="sm" disabled={saveState === "saving" || !config} onClick={handleSave}>
            {saveState === "saving" ? (
              <Loader2 className="animate-spin" />
            ) : saveState === "saved" ? (
              <Check />
            ) : (
              <Save />
            )}
            {saveState === "saving" ? "保存中" : saveState === "saved" ? "已保存" : "保存"}
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mx-4 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {config ? (
        <div className="panel-body min-h-0 flex-1 space-y-6 overflow-y-auto">
          {/* Refresh interval */}
          <div className="space-y-2">
            <Label>自动刷新间隔（秒）</Label>
            <div className="flex items-center gap-3">
              <Input
                className="w-32"
                min={10}
                max={3600}
                type="number"
                value={config.refresh_interval}
                onChange={(e) => patchConfig({ refresh_interval: Number(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">范围：10–3600 秒</p>
            </div>
          </div>

          {/* Index list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>指数监控列表</Label>
              <Badge variant="outline">{config.indices.filter((i) => i.enabled).length} / {config.indices.length} 启用</Badge>
            </div>

            <div className="space-y-2">
              {config.indices.map((idx) => (
                <div
                  key={idx.symbol}
                  className="flex items-center gap-3 rounded-md border border-border/80 bg-background/50 px-3 py-2.5"
                >
                  <Switch
                    checked={idx.enabled}
                    onCheckedChange={(checked) => toggleIndex(idx.symbol, checked)}
                    aria-label={`${idx.name} 启用`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{idx.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{idx.symbol}</p>
                  </div>
                  <Button
                    aria-label="删除"
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => removeIndex(idx.symbol)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>

            {/* Add new index */}
            <div className="rounded-lg border border-dashed border-border/70 bg-muted/10 p-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">添加指数</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  className="font-mono"
                  placeholder="代码，如 .HSI.HK"
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addIndex();
                  }}
                />
                <Input
                  placeholder="显示名称（可选）"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addIndex();
                  }}
                />
                <Button
                  className="shrink-0"
                  disabled={!newSymbol.trim()}
                  onClick={addIndex}
                  type="button"
                >
                  <Plus />
                  添加
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                示例：HK 指数 <span className="font-mono">.HSI.HK</span>，US 指数 <span className="font-mono">.SPX.US</span>，A 股 <span className="font-mono">000001.SH</span>
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="panel-body">
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            加载配置中...
          </div>
        </div>
      )}
    </section>
  );
}
