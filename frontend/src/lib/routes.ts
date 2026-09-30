import type { CompanyTab } from "@/pages/CompanyWorkspacePage";
import type { ConfigTab } from "@/pages/ConfigPage";
import type { Page } from "@/types/ui";

export const DEFAULT_PAGE_PERMISSION: Partial<Record<Page, string>> = {
  overview: "config:read",
  company: "knowledge:read",
  tracing: "tracing:read",
  security: "config:read",
  watchlist: "watchlist:read",
  portfolio: "portfolio:read",
  news: "market:read",
  config: "config:read",
  fundamentals: "fundamentals:read",
  skills: "skills:read",
  subagents: "config:write",
  mcp: "mcp:read",
  memory: "memory:read",
  knowledge: "knowledge:read",
  scheduler: "scheduler:read",
  users: "users:manage",
};

export const PAGE_PATH: Record<Page, string> = {
  overview: "/dashboard",
  company: "/security",
  tracing: "/tracing",
  security: "/admin/security",
  watchlist: "/watchlist",
  portfolio: "/portfolio",
  news: "/news",
  config: "/settings",
  fundamentals: "/fundamentals",
  skills: "/skills",
  subagents: "/subagents",
  mcp: "/mcp",
  memory: "/memory",
  knowledge: "/knowledge",
  scheduler: "/alerts",
  users: "/users",
};

export const PATH_PAGE = new Map<string, Page>([
  ...Object.entries(PAGE_PATH).map(([page, path]) => [path, page as Page] as const),
  ["/", "overview"],
  ["/config", "config"],
  ["/chat", "overview"],
  ["/chart", "watchlist"],
  ["/market", "overview"],
  ["/market/config", "config"],
  ["/overview", "overview"],
  ["/scheduler", "scheduler"],
]);

export function normalizeRoutePath(pathname: string) {
  const clean = pathname.replace(/\/+$/, "");
  return clean || "/";
}

export function pageFromPath(pathname: string): Page {
  if (companyRouteFromPath(pathname)) return "company";
  return PATH_PAGE.get(normalizeRoutePath(pathname)) ?? "overview";
}

export function pathForPage(page: Page) {
  return PAGE_PATH[page] ?? PAGE_PATH.overview;
}

export const COMPANY_TABS = new Set<CompanyTab>(["chart", "financials", "news", "position"]);

export function companyRouteFromPath(pathname: string): { symbol: string; tab: CompanyTab } | null {
  const match = normalizeRoutePath(pathname).match(/^\/security\/([^/]+)(?:\/([^/]+))?$/);
  if (!match) return null;
  const symbol = decodeURIComponent(match[1]).trim().toUpperCase();
  const tabValue = decodeURIComponent(match[2] || "chart") as CompanyTab;
  if (!symbol || !COMPANY_TABS.has(tabValue)) return null;
  return { symbol, tab: tabValue };
}

export function pathForCompany(route: { symbol: string; tab: CompanyTab }) {
  return `/security/${encodeURIComponent(route.symbol)}/${route.tab}`;
}

export function configTabFromPath(pathname: string): ConfigTab | undefined {
  return normalizeRoutePath(pathname) === "/market/config" ? "market" : undefined;
}
