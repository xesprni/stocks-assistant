import { useToast } from "@/components/common/Toast";
import { MarketSnapshot } from "@/components/dashboard/MarketSnapshot";
import { DASHBOARD_ERROR_TOAST_INTERVAL_MS, DASHBOARD_MODULE_KEYS, dashboardHasModuleData, dashboardToastTitle, initialModuleStatuses, mergeDashboard, moduleStatusFromModule, readDashboardSnapshot, sectionSubtitle, writeDashboardSnapshot, type DashboardModuleKey, type DashboardPageProps, type ModuleStatus } from "@/components/dashboard/model";
import { PortfolioSummary } from "@/components/dashboard/PortfolioSummary";
import { PermissionHidden, SignalDeck } from "@/components/dashboard/shared";
import { WatchlistSymbolDetail } from "@/components/dashboard/SymbolDetail";
import { WatchlistMovers } from "@/components/dashboard/WatchlistMovers";
import { i18n } from "@/i18n";
import {
  getDashboard
} from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  DashboardResponse
} from "@/types/app";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

export function DashboardPage({
  canPermission,
  chatExpanded,
  chatPanel,
  isMobileViewport,
  language,
  onOpenChart,
  onOpenMarketConfig,
  onOpenPortfolio,
  onOpenWatchlist,
  refreshInterval,
  marketConfig,
}: DashboardPageProps) {
  const { showToast } = useToast();
  const copy = i18n[language].overview;
  const canMarket = canPermission("market:read");
  const canPortfolio = canPermission("portfolio:read");
  const canWatchlist = canPermission("watchlist:read");
  const canFundamentals = canPermission("fundamentals:read");
  const canChat = canPermission("chat:read");

  const initialSnapshotRef = useRef<DashboardResponse | null | undefined>(undefined);
  if (initialSnapshotRef.current === undefined) {
    initialSnapshotRef.current = readDashboardSnapshot();
  }
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(() => initialSnapshotRef.current ?? null);
  const [moduleStatus, setModuleStatus] = useState<Record<DashboardModuleKey, ModuleStatus>>(() =>
    initialModuleStatuses(initialSnapshotRef.current ?? null),
  );
  const [dashboardError, setDashboardError] = useState("");
  const [selectedWatchlistSymbol, setSelectedWatchlistSymbol] = useState("");
  const dashboardRef = useRef<DashboardResponse | null>(dashboard);
  const modulesAbortRef = useRef<AbortController | null>(null);
  const errorToastRef = useRef(new Map<string, { message: string; time: number }>());
  const snapshotSerializedRef = useRef("");
  const snapshotTimerRef = useRef(0);
  const [, startDashboardTransition] = useTransition();

  const notifyDashboardError = useCallback((key: string, scope: DashboardModuleKey | "dashboard" | "quote", message: string) => {
    const text = message.trim();
    if (!text) return;
    const now = Date.now();
    const previous = errorToastRef.current.get(key);
    if (previous?.message === text && now - previous.time < DASHBOARD_ERROR_TOAST_INTERVAL_MS) return;
    errorToastRef.current.set(key, { message: text, time: now });
    showToast({
      kind: "error",
      message: text,
      title: dashboardToastTitle(scope, language),
    });
  }, [language, showToast]);

  useEffect(() => {
    dashboardRef.current = dashboard;
    if (!dashboard) return;
    // 防抖写入：只在内容确实变化时序列化，避免轮询刷新时每次都全量 stringify。
    const serialized = JSON.stringify(dashboard);
    if (snapshotSerializedRef.current === serialized) return;
    snapshotSerializedRef.current = serialized;
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = window.setTimeout(() => {
      writeDashboardSnapshot(dashboard);
      snapshotTimerRef.current = 0;
    }, 1000);
  }, [dashboard]);

  const refreshModules = useCallback((quiet = true) => {
    modulesAbortRef.current?.abort();
    const controller = new AbortController();
    modulesAbortRef.current = controller;
    const signal = controller.signal;
    setModuleStatus((previous) => {
      const next = { ...previous };
      for (const key of DASHBOARD_MODULE_KEYS) {
        const hasData = dashboardHasModuleData(dashboardRef.current, key);
        next[key] = {
          ...next[key],
          loading: !quiet && !hasData,
          refreshing: quiet || hasData,
          error: quiet ? next[key].error : "",
        };
      }
      return next;
    });

    // 聚合接口在后端先合并并去重全部标的，只触发一轮 Longbridge 批量行情；
    // 分别请求三个模块会把同一次 Dashboard 刷新拆成多轮上游调用。
    return getDashboard("full", { signal })
      .then((response) => {
        if (signal.aborted) return;
        startDashboardTransition(() => {
          setDashboardError("");
          setDashboard((previous) => mergeDashboard(previous, response));
          setModuleStatus({
            market: moduleStatusFromModule(response.market),
            watchlist: moduleStatusFromModule(response.watchlist),
            portfolio: moduleStatusFromModule(response.portfolio),
          });
        });
      })
      .catch((caught) => {
        if (signal.aborted) return;
        const message = caught instanceof Error ? caught.message : copy.loadFailed;
        startDashboardTransition(() => {
          setDashboardError(message);
          setModuleStatus((previous) => {
            const next = { ...previous };
            for (const key of DASHBOARD_MODULE_KEYS) {
              next[key] = { ...next[key], loading: false, refreshing: false, error: message, stale: true };
            }
            return next;
          });
        });
      })
      .finally(() => {
        if (modulesAbortRef.current === controller) modulesAbortRef.current = null;
      });
  }, [copy.loadFailed, startDashboardTransition]);

  useEffect(() => {
    const controller = new AbortController();
    setDashboardError("");
    setModuleStatus((previous) => {
      const next = { ...previous };
      for (const key of DASHBOARD_MODULE_KEYS) {
        const hasData = dashboardHasModuleData(dashboardRef.current, key);
        next[key] = { ...next[key], loading: !hasData, refreshing: hasData, error: "" };
      }
      return next;
    });

    getDashboard("bootstrap", { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        startDashboardTransition(() => {
          setDashboardError("");
          setDashboard((previous) => mergeDashboard(previous, response));
          setModuleStatus({
            market: moduleStatusFromModule(response.market),
            watchlist: moduleStatusFromModule(response.watchlist),
            portfolio: moduleStatusFromModule(response.portfolio),
          });
        });
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        const message = caught instanceof Error ? caught.message : copy.loadFailed;
        startDashboardTransition(() => {
          setDashboardError(message);
          setModuleStatus((previous) => {
            const next = { ...previous };
            for (const key of DASHBOARD_MODULE_KEYS) {
              next[key] = {
                ...next[key],
                loading: false,
                refreshing: false,
                error: dashboardHasModuleData(dashboardRef.current, key) ? next[key].error : message,
              };
            }
            return next;
          });
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) void refreshModules(true);
      });

    return () => {
      controller.abort();
    };
  }, [copy.loadFailed, refreshModules, startDashboardTransition, marketConfig]);

  useEffect(() => () => modulesAbortRef.current?.abort(), []);

  useEffect(() => () => {
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
  }, []);

  const refreshMs = useMemo(() => Math.max(8, Number(refreshInterval) || 60) * 1000, [refreshInterval]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshModules(true);
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [refreshModules, refreshMs]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const handleVisibilityChange = () => {
      if (!document.hidden) void refreshModules(true);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [refreshModules]);

  const marketModule = dashboard?.market;
  const watchlistModule = dashboard?.watchlist;
  const portfolioModule = dashboard?.portfolio;
  const portfolioQuoteError = useMemo(
    () => (portfolioModule?.markets ?? []).map((market) => market.quote_error).filter(Boolean).join(" · "),
    [portfolioModule?.markets],
  );
  const watchlistRows = watchlistModule?.items ?? [];
  const selectedWatchlistRow = useMemo(
    () => watchlistRows.find((row) => row.symbol === selectedWatchlistSymbol) ?? null,
    [selectedWatchlistSymbol, watchlistRows],
  );

  useEffect(() => {
    notifyDashboardError("dashboard", "dashboard", dashboardError);
    notifyDashboardError("market:status", "market", moduleStatus.market.error);
    notifyDashboardError("market:module", "market", marketModule?.error ?? "");
    notifyDashboardError("watchlist:status", "watchlist", moduleStatus.watchlist.error);
    notifyDashboardError("watchlist:module", "watchlist", watchlistModule?.error ?? "");
    notifyDashboardError("watchlist:quote", "quote", watchlistModule?.quote_error ?? "");
    notifyDashboardError("portfolio:status", "portfolio", moduleStatus.portfolio.error);
    notifyDashboardError("portfolio:module", "portfolio", portfolioModule?.error ?? "");
    notifyDashboardError("portfolio:quote", "quote", portfolioQuoteError);
  }, [
    dashboardError,
    marketModule?.error,
    moduleStatus.market.error,
    moduleStatus.portfolio.error,
    moduleStatus.watchlist.error,
    notifyDashboardError,
    portfolioModule?.error,
    portfolioQuoteError,
    watchlistModule?.error,
    watchlistModule?.quote_error,
  ]);

  useEffect(() => {
    if (selectedWatchlistSymbol && !watchlistRows.some((row) => row.symbol === selectedWatchlistSymbol)) {
      setSelectedWatchlistSymbol("");
    }
  }, [selectedWatchlistSymbol, watchlistRows]);

  return (
    <div className="page-enter flex min-h-0 w-full flex-1 flex-col gap-3">
      <div
        className={cn(
          "dashboard-wide-grid grid min-h-0 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_minmax(360px,0.88fr)] xl:gap-5 2xl:grid-cols-[320px_minmax(420px,1fr)_minmax(390px,0.86fr)]",
          "xl:items-start",
          chatExpanded && "xl:grid-cols-[300px_minmax(0,1fr)_minmax(360px,0.88fr)] 2xl:grid-cols-[320px_minmax(420px,1fr)_minmax(390px,0.86fr)]",
        )}
      >
        <section className="dashboard-primary-column dashboard-scroll-column min-w-0 xl:col-start-1 xl:row-start-1 xl:self-stretch">
          {canWatchlist ? (
            <WatchlistMovers
              error=""
              language={language}
              loading={moduleStatus.watchlist.loading}
              module={watchlistModule}
              onOpenChart={canMarket ? onOpenChart : undefined}
              onOpenWatchlist={onOpenWatchlist}
              onSelectSymbol={setSelectedWatchlistSymbol}
              selectedSymbol={selectedWatchlistSymbol}
              subtitle={sectionSubtitle(copy.watchlistMoversSubtitle, moduleStatus.watchlist, language)}
            />
          ) : (
            <PermissionHidden>{copy.watchlistHidden}</PermissionHidden>
          )}
        </section>

        <section
          className={cn(
            "dashboard-secondary-column dashboard-scroll-column min-w-0 xl:col-start-2 xl:row-start-1 xl:flex xl:min-h-[calc(100dvh-5.25rem)] xl:flex-col",
            selectedWatchlistRow && "dashboard-secondary-detail-column",
            chatExpanded && "xl:hidden",
          )}
        >
          {selectedWatchlistRow ? (
            <WatchlistSymbolDetail
              canFundamentals={canFundamentals}
              language={language}
              onBack={() => setSelectedWatchlistSymbol("")}
              onOpenChart={canMarket ? onOpenChart : undefined}
              row={selectedWatchlistRow}
            />
          ) : (
            <>
              {canMarket ? (
                <MarketSnapshot
                  error=""
                  indices={marketModule?.indices ?? []}
                  language={language}
                  loading={moduleStatus.market.loading}
                  onOpenMarketConfig={onOpenMarketConfig}
                  subtitle={sectionSubtitle(copy.marketSnapshotSubtitle, moduleStatus.market, language)}
                />
              ) : (
                <PermissionHidden>{copy.marketHidden}</PermissionHidden>
              )}
              {canPortfolio ? (
                <PortfolioSummary
                  error=""
                  language={language}
                  loading={moduleStatus.portfolio.loading}
                  module={portfolioModule}
                  onOpenPortfolio={onOpenPortfolio}
                  subtitle={sectionSubtitle(copy.portfolioSubtitle, moduleStatus.portfolio, language)}
                />
              ) : (
                <PermissionHidden>{copy.portfolioHidden}</PermissionHidden>
              )}
              <SignalDeck className="xl:flex-1" language={language} />
            </>
          )}
        </section>

        {!isMobileViewport ? (
          <aside
            className={cn(
              "dashboard-chat-column dashboard-scroll-column finance-right-rail hidden min-h-[720px] min-w-0 flex-col overflow-hidden xl:col-start-3 xl:row-start-1 xl:flex xl:min-h-0",
              "xl:self-stretch",
              chatExpanded && "xl:col-start-2 xl:col-span-2",
            )}
          >
            {canChat ? chatPanel : <PermissionHidden>{copy.chatHidden}</PermissionHidden>}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
