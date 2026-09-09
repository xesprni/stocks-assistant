import { useEffect, useState, useSyncExternalStore } from "react";
import { addWatchlistItem, deleteWatchlistItem, getWatchlistOverview, listWatchlist, reorderWatchlist } from "@/lib/api";
import { WatchlistController } from "@/lib/watchlist-controller";
import type { WatchlistCategory } from "@/types/app";

export function useWatchlistController(category: WatchlistCategory, refreshSeconds: number) {
  const [controller] = useState(() => new WatchlistController(category, {
    list: listWatchlist, overview: getWatchlistOverview, add: addWatchlistItem, remove: deleteWatchlistItem, reorder: reorderWatchlist,
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => { controller.activate(category); }, [category, controller]);
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    if (!state.items.length) return;
    const refresh = () => { if (document.visibilityState !== "hidden") void controller.refresh(); };
    refresh();
    const timer = window.setInterval(refresh, refreshSeconds * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [category, controller, state.items.length, refreshSeconds]);
  return { controller, ...state, items: state.category === category ? state.items : [] };
}
