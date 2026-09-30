import { type PortfolioSortKey } from "@/components/portfolio/page-model";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronUp
} from "lucide-react";

export function SortablePortfolioHeader({
  align = "left",
  label,
  onSort,
  sortKey,
  sortState,
}: {
  align?: "left" | "right";
  label: string;
  onSort: (key: PortfolioSortKey) => void;
  sortKey: PortfolioSortKey;
  sortState: { key: PortfolioSortKey; direction: "asc" | "desc" };
}) {
  const active = sortState.key === sortKey;
  return (
    <th aria-sort={active ? sortState.direction === "asc" ? "ascending" : "descending" : "none"} className={cn("px-3 py-3 font-medium", align === "right" && "text-right")}>
      <button
        className={cn(
          "inline-flex items-center gap-1 rounded-sm text-xs transition-colors hover:text-foreground",
          align === "right" && "justify-end",
          active && "text-foreground",
        )}
        onClick={() => onSort(sortKey)}
        type="button"
      >
        {label}
        {active ? (
          sortState.direction === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />
        ) : (
          <ChevronDown className="size-3 opacity-30" />
        )}
      </button>
    </th>
  );
}
