import {
  AppNavigationPopover,
  type AppNavGroup
} from "@/components/shell/AppNavigation";
import { UserAvatarMenu } from "@/components/shell/UserAvatarMenu";
import { Button } from "@/components/ui/button";
import type { AppLanguage } from "@/i18n";
import { getMessages, i18n } from "@/i18n";
import { cn } from "@/lib/utils";
import type {
  AuthUser
} from "@/types/app";
import type { EffectiveTheme, Page, Theme } from "@/types/ui";
import {
  ChevronUp,
  Monitor,
  Moon,
  Sparkles,
  Sun
} from "lucide-react";
import type { ReactNode } from "react";

export function Header({
  isMobileVisible,
  language,
  navigationGroups,
  onHideMobileChrome,
  onHome,
  onLogout,
  onUpdateProfile,
  page,
  setPage,
  onThemeChange,
  resolvedTheme,
  theme,
  user,
}: {
  isMobileVisible: boolean;
  language: AppLanguage;
  navigationGroups: AppNavGroup[];
  onHideMobileChrome: () => void;
  onHome?: () => void;
  onLogout: () => void;
  onUpdateProfile: (payload: { display_name?: string; avatar_base64?: string }) => Promise<AuthUser>;
  page: Page | null;
  setPage: (page: Page) => void;
  onThemeChange: (theme: Theme) => void;
  resolvedTheme: EffectiveTheme;
  theme: Theme;
  user: AuthUser | null;
}) {
  const themeLabels = getMessages(language).shell.themeLabels;
  const themeOptions: Array<{ value: Theme; label: string; icon: ReactNode }> = [
    { value: "system", label: themeLabels.system, icon: <Monitor /> },
    { value: "dark", label: themeLabels.dark, icon: <Moon /> },
    { value: "light", label: themeLabels.light, icon: <Sun /> },
  ];
  const hideMobileChromeLabel = getMessages(language).shell.hideMobileChromeLabel;
  const navigationLabel = getMessages(language).shell.navigationLabel;
  const closeNavigationLabel = getMessages(language).shell.closeNavigationLabel;
  const currentItem = navigationGroups.flatMap((group) => group.items).find((item) => item.id === page);
  const nextTheme: Theme = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
  const activeThemeIcon = theme === "system" ? <Monitor /> : theme === "dark" ? <Moon /> : <Sun />;
  const nextThemeLabel = themeOptions.find((option) => option.value === nextTheme)?.label ?? nextTheme;

  return (
    <header
      className={cn(
        "panel app-header flex min-h-14 shrink-0 items-center justify-between gap-3 rounded-none border-x-0 border-t-0 px-2.5 py-2 shadow-none sm:px-4 lg:px-5",
        !isMobileVisible && "mobile-header-hidden",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <AppNavigationPopover
          closeLabel={closeNavigationLabel}
          currentPage={page}
          groups={navigationGroups}
          label={navigationLabel}
          onNavigate={setPage}
        />
        <button
          aria-label={i18n[language].shell.goToStartPage}
          className="apple-pressable flex shrink-0 items-center gap-2 rounded-xl text-left"
          disabled={!onHome}
          onClick={onHome}
          type="button"
        >
          <span className="app-mark grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="size-4" />
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-sm font-semibold tracking-[-0.012em] text-foreground">Stocks Assistant</span>
          </span>
        </button>
        <span aria-hidden="true" className="hidden h-6 w-px bg-border/70 sm:block" />
        <div className="min-w-0" aria-live="polite">
          <p className="truncate text-sm font-semibold tracking-[-0.012em] text-foreground">{currentItem?.label}</p>
          <p className="hidden truncate text-[0.6875rem] leading-4 text-muted-foreground md:block">{currentItem?.hint}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          aria-label={hideMobileChromeLabel}
          className="rounded-full lg:hidden"
          onClick={onHideMobileChrome}
          size="icon"
          title={hideMobileChromeLabel}
          type="button"
          variant="outline"
        >
          <ChevronUp className="size-4" />
        </Button>
        <Button
          aria-label={`${themeLabels.switchTo} ${nextThemeLabel}`}
          className="rounded-full sm:hidden"
          onClick={() => onThemeChange(nextTheme)}
          size="icon"
          title={`${themeLabels.switchTo} ${nextThemeLabel}`}
          type="button"
          variant="outline"
        >
          {activeThemeIcon}
        </Button>
        <div
          aria-label={`${themeLabels.current}${theme === "system" ? `${themeLabels.system} (${resolvedTheme === "dark" ? themeLabels.darkNow : themeLabels.lightNow})` : theme === "dark" ? themeLabels.dark : themeLabels.light}`}
          className="theme-toggle hidden h-9 shrink-0 items-center rounded-full border border-input bg-[var(--control-bg)] p-0.5 sm:inline-flex"
          role="group"
        >
          {themeOptions.map((option) => {
            const active = theme === option.value;
            const title =
              option.value === "system"
                ? `${themeLabels.system} (${resolvedTheme === "dark" ? themeLabels.darkNow : themeLabels.lightNow})`
                : option.label;
            return (
              <button
                aria-label={`${themeLabels.switchTo} ${title}`}
                aria-pressed={active}
                className={cn(
                  "apple-pressable grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:text-foreground [&_svg]:size-3.5",
                  active && "bg-[var(--control-selected-bg)] text-foreground shadow-sm",
                )}
                key={option.value}
                onClick={() => onThemeChange(option.value)}
                title={title}
                type="button"
              >
                {option.icon}
              </button>
            );
          })}
        </div>
        <UserAvatarMenu
          language={language}
          onLogout={onLogout}
          onUpdateProfile={onUpdateProfile}
          user={user}
        />
      </div>
    </header>
  );
}
