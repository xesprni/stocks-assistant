import {
  type AppNavGroup,
  type AppNavItem
} from "@/components/shell/AppNavigation";
import type { AppLanguage } from "@/i18n";
import { getMessages, i18n } from "@/i18n";
import { PAGE_PATH } from "@/lib/routes";
import type { Page } from "@/types/ui";
import {
  BookOpen,
  Bot,
  BrainCircuit,
  BriefcaseBusiness,
  Clock,
  Cpu,
  Home,
  Plug,
  Settings2,
  ShieldCheck,
  Star,
  UserCog,
  Zap,
} from "lucide-react";
import type { ReactNode } from "react";

export function navItem(language: AppLanguage, id: Page, icon: ReactNode, labelOverride?: string, hintOverride?: string): AppNavItem {
  const [label, hint] = i18n[language].nav[id as keyof typeof i18n.zh.nav];
  return { id, label: labelOverride ?? label, icon, hint: hintOverride ?? hint, href: PAGE_PATH[id] };
}

export function getNavigationGroups(language: AppLanguage): AppNavGroup[] {
  const primary = getMessages(language).shell.primary;
  return [
    {
      id: "primary",
      label: primary.group,
      items: [
        navItem(language, "overview", <Home />, primary.today),
        navItem(language, "watchlist", <Star />, primary.companies),
        navItem(language, "portfolio", <BriefcaseBusiness />, primary.portfolio),
        navItem(language, "knowledge", <BookOpen />, primary.knowledge),
        navItem(language, "scheduler", <Clock />, primary.alerts),
      ],
    },
    {
      id: "developer",
      label: getMessages(language).shell.developerCenter,
      items: [
        navItem(language, "tracing", <Cpu />),
        navItem(language, "skills", <Zap />),
        navItem(language, "subagents", <Bot />),
        navItem(language, "mcp", <Plug />),
        navItem(language, "memory", <BrainCircuit />),
      ],
    },
    {
      id: "admin",
      label: getMessages(language).shell.administration,
      items: [
        navItem(language, "security", <ShieldCheck />),
        navItem(language, "users", <UserCog />),
        navItem(language, "config", <Settings2 />),
      ],
    },
  ];
}
