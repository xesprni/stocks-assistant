import { createI18n } from "./core";
import { en } from "./locales/en/index";
import { zh } from "./locales/zh/index";
import type { LocaleDefinition, Messages } from "./types";

type SymbolName = { name?: string; name_en?: string; name_cn?: string; name_hk?: string; symbol: string };
type RegisteredLocale = LocaleDefinition<Messages> & { symbolNameFields: readonly (keyof SymbolName)[] };

/** 语言清单是唯一注册入口；设置页选项与 AppLanguage 均由此生成。 */
export const locales = {
  zh: {
    nativeName: "简体中文", intlLocale: "zh-CN", direction: "ltr",
    aliases: ["zh-Hans", "zh-Hans-CN"], messages: zh,
    symbolNameFields: ["name_cn", "name", "symbol"],
  },
  en: {
    nativeName: "English", intlLocale: "en-US", direction: "ltr",
    aliases: ["en-GB"], messages: en,
    symbolNameFields: ["name_en", "name_cn", "name", "symbol"],
  },
} satisfies Record<string, RegisteredLocale>;

export type AppLanguage = keyof typeof locales;
export const runtime = createI18n<Messages, AppLanguage>({ defaultMessages: zh, fallbackLocale: "zh", locales });
export const supportedLanguages = runtime.ids.map((id) => {
  const { nativeName, intlLocale, direction } = locales[id];
  return { id, nativeName, intlLocale, direction };
});
export const normalizeLanguage = runtime.normalize;
export const localeFor = runtime.localeFor;
export const getMessages = runtime.messages;
export const translate = runtime.translate;

export function catalogsFor<K extends keyof Messages>(namespace: K): Record<AppLanguage, Messages[K]> {
  return Object.fromEntries(runtime.ids.map((id) => [id, runtime.catalogs[id][namespace]])) as Record<AppLanguage, Messages[K]>;
}

export function localizedSymbolName(item: SymbolName, language: AppLanguage) {
  const fields = locales[language].symbolNameFields;
  return fields.map((field) => item[field]).find(Boolean) ?? item.symbol;
}
