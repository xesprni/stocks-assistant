import assert from "node:assert/strict";
import { test } from "node:test";
import { createI18n, formatTemplate, mergeMessages } from "../src/i18n/core";
import { en } from "../src/i18n/locales/en/index";
import { zh } from "../src/i18n/locales/zh/index";
import { catalogsFor, localeFor, localizedSymbolName, normalizeLanguage, supportedLanguages, translate } from "../src/i18n/registry";

test("language tags, regional aliases and unknown settings resolve consistently", () => {
  for (const value of ["en", " EN_us ", "en-GB", "en-AU"]) {
    assert.equal(normalizeLanguage(value), "en");
    assert.equal(localeFor(value), "en-US");
  }
  for (const value of ["zh-Hans-CN", "zh_CN", undefined, null, "unsupported", 123]) {
    assert.equal(normalizeLanguage(value), "zh");
  }
  assert.deepEqual(supportedLanguages.map(({ id }) => id), ["zh", "en"]);
  assert.equal(translate("en", "ui.common.newChat"), en.ui.common.newChat);
  assert.equal(catalogsFor("dashboard").zh.toastTitle.quote, zh.dashboard.toastTitle.quote);
});

test("partial catalogs fall back by key without mutating resources or merging array positions", () => {
  const defaults = { title: "默认", section: { label: "名称", hint: "提示" }, choices: ["一", "二"] };
  const translated = { section: { label: "Name" }, choices: ["One"] };
  const result = mergeMessages(defaults, translated);
  assert.deepEqual(result, { title: "默认", section: { label: "Name", hint: "提示" }, choices: ["One"] });
  result.section.hint = "Changed";
  result.choices.push("Two");
  assert.equal(defaults.section.hint, "提示");
  assert.deepEqual(translated.choices, ["One"]);
  assert.equal(mergeMessages(defaults, { title: "" }).title, "");
  assert.equal(mergeMessages(defaults, Object.create({ title: "Inherited" })).title, "默认");
});

test("a third locale registers independently and supplies regional formatting and direction", () => {
  const defaults = { greeting: "你好 {name}", nested: { hint: "默认提示" } };
  const runtime = createI18n({
    defaultMessages: defaults, fallbackLocale: "zh",
    locales: {
      zh: { nativeName: "简体中文", intlLocale: "zh-CN", direction: "ltr", messages: defaults },
      en: { nativeName: "English", intlLocale: "en-US", direction: "ltr", messages: { greeting: "Hello {name}" } },
      ar: { nativeName: "العربية", intlLocale: "ar-EG", direction: "rtl", messages: { greeting: "مرحبا {name}" } },
    },
  });
  assert.deepEqual(runtime.ids, ["zh", "en", "ar"]);
  assert.equal(runtime.definition("ar-EG").direction, "rtl");
  assert.equal(runtime.translate("ar", "greeting", { name: "Ada" }), "مرحبا Ada");
  assert.equal(runtime.translate("ar", "nested.hint"), defaults.nested.hint);
  assert.equal(runtime.formatNumber("ar", 12345.67), new Intl.NumberFormat("ar-EG").format(12345.67));
  const date = new Date("2026-09-30T00:00:00Z");
  const options = { timeZone: "UTC", dateStyle: "long" } as const;
  assert.equal(runtime.formatDate("ar", date, options), new Intl.DateTimeFormat("ar-EG", options).format(date));
  assert.equal(runtime.plural("en", 1, { one: "{count} item", other: "{count} items" }), "1 item");
  assert.equal(runtime.plural("en", 2, { one: "{count} item", other: "{count} items" }), "2 items");
  assert.equal(runtime.plural("ar", 0, { zero: "Empty", other: "{count} items" }), "Empty");
});

test("ambiguous locale aliases fail at registration", () => {
  assert.throws(() => createI18n({
    defaultMessages: { title: "Title" }, fallbackLocale: "en",
    locales: {
      en: { nativeName: "English", intlLocale: "en-US", direction: "ltr", messages: {} },
      ja: { nativeName: "日本語", intlLocale: "ja-JP", aliases: ["EN_us"], direction: "ltr", messages: {} },
    },
  }), /Duplicate locale alias/);
});

test("templates retain missing parameters, accept zero and never read inherited values", () => {
  assert.equal(formatTemplate("{count} / {count} {missing}", { count: 0 }), "0 / 0 {missing}");
  assert.equal(formatTemplate("{constructor}", {}), "{constructor}");
  assert.equal(formatTemplate("{text}", { text: "<script>raw text</script>" }), "<script>raw text</script>");
});

test("all shipped catalogs have matching keys, value shapes and interpolation parameters", () => {
  const parameters = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
  function compare(reference: unknown, translated: unknown, path: string) {
    assert.equal(typeof translated, typeof reference, path);
    if (typeof reference === "string") {
      assert.equal(typeof translated, "string");
      assert.deepEqual(parameters(translated as string), parameters(reference), `${path} parameters`);
    } else if (reference && typeof reference === "object") {
      assert.ok(translated && typeof translated === "object", path);
      assert.equal(Array.isArray(translated), Array.isArray(reference), path);
      assert.deepEqual(Object.keys(translated).sort(), Object.keys(reference).sort(), `${path} keys`);
      for (const [key, value] of Object.entries(reference)) {
        compare(value, (translated as Record<string, unknown>)[key], `${path}.${key}`);
      }
    }
  }
  compare(zh, en, "messages");
});

test("symbol display names use the registered language preference and fallbacks", () => {
  const item = { symbol: "AAPL.US", name_cn: "苹果", name_en: "Apple" };
  assert.equal(localizedSymbolName(item, "en"), "Apple");
  assert.equal(localizedSymbolName(item, "zh"), "苹果");
  assert.equal(localizedSymbolName({ symbol: "AAPL.US" }, "en"), "AAPL.US");
});
