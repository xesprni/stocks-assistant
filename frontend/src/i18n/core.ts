import type { LocaleDefinition, MessageKey, PartialMessages, TemplateValues } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 按默认资源的键递归回退；数组作为完整翻译替换，避免同一列表混用不同语言。 */
export function mergeMessages<T extends object>(fallback: T, translated: PartialMessages<T>): T {
  const result: Record<string, unknown> = {};
  const override = translated as Record<string, unknown>;
  for (const [key, value] of Object.entries(fallback)) {
    const replacement = Object.prototype.hasOwnProperty.call(override, key) ? override[key] : undefined;
    result[key] = isRecord(value)
      ? mergeMessages(value, isRecord(replacement) ? replacement : {})
      : Array.isArray(value) ? [...(Array.isArray(replacement) ? replacement : value)]
        : replacement ?? value;
  }
  return result as T;
}

export function formatTemplate(text: string, values: TemplateValues): string {
  // 缺参保留占位符便于排查；只读取调用方显式提供的值。
  return text.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder);
}

export function createI18n<T extends object, L extends string>(options: {
  defaultMessages: T;
  fallbackLocale: L;
  locales: Record<L, LocaleDefinition<T>>;
}) {
  const ids = Object.keys(options.locales) as L[];
  const aliases = new Map<string, L>();
  const catalogs = {} as Record<L, T>;
  for (const id of ids) {
    const definition = options.locales[id];
    for (const alias of [id, definition.intlLocale, ...(definition.aliases ?? [])]) {
      const normalized = alias.replaceAll("_", "-").toLowerCase();
      const existing = aliases.get(normalized);
      if (existing && existing !== id) throw new Error(`Duplicate locale alias: ${alias}`);
      aliases.set(normalized, id);
    }
    catalogs[id] = mergeMessages(options.defaultMessages, definition.messages);
  }
  function normalize(value: unknown): L {
    if (typeof value !== "string") return options.fallbackLocale;
    const tag = value.trim().replaceAll("_", "-").toLowerCase();
    return aliases.get(tag) ?? aliases.get(tag.split("-")[0]) ?? options.fallbackLocale;
  }
  function localeFor(value: unknown): string { return options.locales[normalize(value)].intlLocale; }
  function messages(value: unknown): T { return catalogs[normalize(value)]; }
  function translate(value: unknown, key: MessageKey<T>, params: TemplateValues = {}): string {
    let message: unknown = messages(value);
    for (const segment of key.split(".")) {
      message = isRecord(message) && Object.prototype.hasOwnProperty.call(message, segment) ? message[segment] : undefined;
    }
    return typeof message === "string" ? formatTemplate(message, params) : key;
  }
  return {
    ids, catalogs, normalize, localeFor, messages, translate,
    definition(value: unknown) { return options.locales[normalize(value)]; },
    formatNumber(value: unknown, number: number, format?: Intl.NumberFormatOptions) {
      return new Intl.NumberFormat(localeFor(value), format).format(number);
    },
    formatDate(value: unknown, date: Date | number, format?: Intl.DateTimeFormatOptions) {
      return new Intl.DateTimeFormat(localeFor(value), format).format(date);
    },
    plural(value: unknown, count: number, forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }) {
      const category = new Intl.PluralRules(localeFor(value)).select(count);
      return formatTemplate(forms[category] ?? forms.other, { count });
    },
  };
}
