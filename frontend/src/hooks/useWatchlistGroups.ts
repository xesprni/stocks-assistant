import { useEffect, useState, useSyncExternalStore } from "react";
import { deleteWatchlistGroup, listWatchlistGroups, saveWatchlistGroup, setWatchlistGroupMembers } from "@/lib/api";
import { WatchlistGroupsController } from "@/lib/watchlist-groups-controller";

export function useWatchlistGroups() {
  const [controller] = useState(() => new WatchlistGroupsController({
    list: listWatchlistGroups, save: saveWatchlistGroup, remove: deleteWatchlistGroup, members: setWatchlistGroupMembers,
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  useEffect(() => { controller.activate(); return () => controller.dispose(); }, [controller]);
  return { controller, ...state };
}
