export { createI18n, formatTemplate, mergeMessages } from "./core";
export {
  catalogsFor,
  getMessages,
  localeFor,
  locales,
  localizedSymbolName,
  normalizeLanguage,
  runtime,
  supportedLanguages,
  translate,
} from "./registry";
export type { AppLanguage } from "./registry";
export type { LocaleDefinition, MessageKey, Messages, PartialMessages, TemplateValues } from "./types";

import { catalogsFor } from "./registry";
// Stable entry points for existing screens; resources and runtime no longer live in UI files.
export const i18n = catalogsFor("ui");
export const chipCopy = catalogsFor("chipCopy");
export const securityCopy = catalogsFor("securityCopy");
export const passwordCopy = catalogsFor("passwordCopy");
