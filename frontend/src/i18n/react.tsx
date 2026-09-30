import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { getMessages, normalizeLanguage, runtime, type AppLanguage } from "./registry";
import type { MessageKey, Messages, TemplateValues } from "./types";

const LanguageContext = createContext<AppLanguage>(normalizeLanguage(undefined));

/** 语言由账号配置控制，避免 Provider 与配置自动保存维护两份持久化状态。 */
export function I18nProvider({ language, children }: { language: AppLanguage; children: ReactNode }) {
  useEffect(() => {
    const locale = runtime.definition(language);
    document.documentElement.lang = locale.intlLocale;
    document.documentElement.dir = locale.direction;
  }, [language]);
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const language = useContext(LanguageContext);
  return useMemo(() => ({
    language,
    messages: getMessages(language),
    locale: runtime.localeFor(language),
    t: (key: MessageKey<Messages>, values?: TemplateValues) => runtime.translate(language, key, values),
    number: (value: number, options?: Intl.NumberFormatOptions) => runtime.formatNumber(language, value, options),
    date: (value: Date | number, options?: Intl.DateTimeFormatOptions) => runtime.formatDate(language, value, options),
  }), [language]);
}
