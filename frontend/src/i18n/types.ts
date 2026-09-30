import type { zh } from "./locales/zh/index";

/** Keep resource keys checked without constraining translations to Chinese literal values. */
export type MessageShape<T> = T extends string ? string
  : T extends readonly unknown[] ? { [K in keyof T]: MessageShape<T[K]> }
  : T extends object ? { [K in keyof T]: MessageShape<T[K]> } : T;
export type Messages = MessageShape<typeof zh>;
export type PartialMessages<T> = T extends readonly unknown[] ? T
  : T extends object ? { [K in keyof T]?: PartialMessages<T[K]> } : T;
export type MessageKey<T> = {
  [K in keyof T & string]: T[K] extends string ? K
  : T[K] extends readonly unknown[] ? never
  : T[K] extends object ? `${K}.${MessageKey<T[K]>}` : never
}[keyof T & string];
export type TemplateValues = Readonly<Record<string, string | number>>;
export interface LocaleDefinition<T> {
  nativeName: string;
  intlLocale: string;
  direction: "ltr" | "rtl";
  aliases?: readonly string[];
  messages: PartialMessages<T>;
}
