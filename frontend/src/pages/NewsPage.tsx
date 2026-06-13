import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ExternalLink, FileText, Globe2, Languages, Loader2, MessageCircle, Newspaper, Rss, Search, Share2, Star, ThumbsUp } from "lucide-react";

import { SideDrawer } from "@/components/common/SideDrawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getGuardianArticle, getGuardianFeed, getSecurityNews, listWatchlist, translateGuardianArticle } from "@/lib/api";
import { i18n, localeFor, type AppLanguage } from "@/lib/i18n";
import { readStoredText, readStoredValue, writeStoredValue } from "@/lib/local-storage";
import { cn } from "@/lib/utils";
import type { GuardianArticleResponse, GuardianFeedItem, SecurityNewsItem, WatchlistCategory, WatchlistItem } from "@/types/app";

type NewsMode = "security" | "guardian";
type SourceMode = "watchlist" | "symbol";
type ArticleFontSize = "small" | "medium" | "large";

const DEFAULT_GUARDIAN_URL = "https://www.theguardian.com";
const GUARDIAN_ARTICLE_FONT_SIZE_KEY = "stocks_assistant_guardian_article_font_size";
const NEWS_MODE_STORAGE_KEY = "stocks-assistant.news.mode";
const NEWS_SOURCE_MODE_STORAGE_KEY = "stocks-assistant.news.source-mode";
const NEWS_CATEGORY_STORAGE_KEY = "stocks-assistant.news.category";
const NEWS_SYMBOL_STORAGE_KEY = "stocks-assistant.news.symbol";
const NEWS_GUARDIAN_URL_STORAGE_KEY = "stocks-assistant.news.guardian-url";
const NEWS_GUARDIAN_PRESET_STORAGE_KEY = "stocks-assistant.news.guardian-preset-url";
const NEWS_GUARDIAN_ACTIVE_ARTICLE_STORAGE_KEY = "stocks-assistant.news.guardian-active-article";
const NEWS_GUARDIAN_TRANSLATIONS_STORAGE_KEY = "stocks-assistant.news.guardian-translations.v1";
const GUARDIAN_TRANSLATION_TARGET = "zh-CN";
const GUARDIAN_TRANSLATION_CACHE_MAX_ENTRIES = 16;
const ARTICLE_FONT_SIZES: ArticleFontSize[] = ["small", "medium", "large"];
const ARTICLE_FONT_CLASS: Record<ArticleFontSize, string> = {
  small: "text-sm leading-7",
  medium: "text-base leading-8",
  large: "text-lg leading-9",
};

type GuardianTranslationCacheEntry = {
  savedAt: number;
  translation: string;
};

type GuardianTranslationStatus = "pending" | "error";

const guardianTranslationTasks = new Map<string, Promise<string>>();

function getWatchlistCategories(language: AppLanguage): Array<{ id: WatchlistCategory; label: string; hint: string }> {
  const markets = i18n[language].markets;
  return [
    { id: "US", label: markets.us, hint: markets.usHint },
    { id: "A", label: markets.a, hint: markets.aHint },
    { id: "H", label: markets.h, hint: markets.hHint },
  ];
}

function hashText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function guardianTranslationCacheKey(url: string, body: string, targetLanguage = GUARDIAN_TRANSLATION_TARGET) {
  return `${targetLanguage}:${url || "article"}:${body.length}:${hashText(body)}`;
}

function readGuardianTranslationCache(): Record<string, GuardianTranslationCacheEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(NEWS_GUARDIAN_TRANSLATIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<GuardianTranslationCacheEntry>>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, entry]) => typeof entry?.translation === "string" && entry.translation)
        .map(([key, entry]) => [
          key,
          {
            savedAt: typeof entry.savedAt === "number" ? entry.savedAt : 0,
            translation: entry.translation as string,
          },
        ]),
    );
  } catch {
    return {};
  }
}

function readStoredGuardianItem(): GuardianFeedItem | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(NEWS_GUARDIAN_ACTIVE_ARTICLE_STORAGE_KEY);
    if (!raw) return null;
    const item = JSON.parse(raw) as Partial<GuardianFeedItem>;
    return typeof item.url === "string" && item.url
      ? {
        id: String(item.id || item.url),
        title: String(item.title || ""),
        description: String(item.description || ""),
        url: item.url,
        published_at: item.published_at ?? null,
        published_at_ts: item.published_at_ts ?? null,
        author: String(item.author || ""),
        categories: Array.isArray(item.categories) ? item.categories.map(String) : [],
      }
      : null;
  } catch {
    return null;
  }
}

function writeGuardianTranslationCache(cache: Record<string, GuardianTranslationCacheEntry>) {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.entries(cache)
      .sort(([, a], [, b]) => (b.savedAt || 0) - (a.savedAt || 0))
      .slice(0, GUARDIAN_TRANSLATION_CACHE_MAX_ENTRIES);
    window.localStorage.setItem(NEWS_GUARDIAN_TRANSLATIONS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // 翻译文本可能较长，缓存失败不影响当前页面展示。
  }
}

function saveGuardianTranslationToCache(key: string, translation: string) {
  const cache = readGuardianTranslationCache();
  cache[key] = { savedAt: Date.now(), translation };
  writeGuardianTranslationCache(cache);
  return cache[key];
}

function startGuardianTranslation(key: string, body: string) {
  const current = guardianTranslationTasks.get(key);
  if (current) return current;
  const task = translateGuardianArticle({ text: body, target_language: GUARDIAN_TRANSLATION_TARGET })
    .then((response) => {
      saveGuardianTranslationToCache(key, response.translation);
      return response.translation;
    })
    .finally(() => {
      guardianTranslationTasks.delete(key);
    });
  guardianTranslationTasks.set(key, task);
  return task;
}

function getGuardianSources(language: AppLanguage) {
  const copy = i18n[language].newsPage;
  return [
    { label: copy.guardianTopStories, url: DEFAULT_GUARDIAN_URL },
    { label: copy.guardianWorld, url: "https://www.theguardian.com/world" },
    { label: copy.guardianBusiness, url: "https://www.theguardian.com/business" },
    { label: copy.guardianUs, url: "https://www.theguardian.com/us-news" },
    { label: copy.guardianTechnology, url: "https://www.theguardian.com/technology" },
    { label: copy.guardianMoney, url: "https://www.theguardian.com/money" },
  ];
}

function readArticleFontSize(): ArticleFontSize {
  if (typeof window === "undefined") return "medium";
  try {
    const value = window.localStorage.getItem(GUARDIAN_ARTICLE_FONT_SIZE_KEY);
    return ARTICLE_FONT_SIZES.includes(value as ArticleFontSize) ? value as ArticleFontSize : "medium";
  } catch {
    return "medium";
  }
}

export function NewsPage({ initialSymbol, language }: { initialSymbol?: string; language: AppLanguage }) {
  const copy = i18n[language].newsPage;
  const common = i18n[language].common;
  const categories = getWatchlistCategories(language);
  const guardianSources = getGuardianSources(language);
  const [newsMode, setNewsMode] = useState<NewsMode>(() =>
    initialSymbol ? "security" : readStoredValue(NEWS_MODE_STORAGE_KEY, ["security", "guardian"], "security"),
  );
  const [sourceMode, setSourceMode] = useState<SourceMode>(() =>
    initialSymbol ? "symbol" : readStoredValue(NEWS_SOURCE_MODE_STORAGE_KEY, ["watchlist", "symbol"], "watchlist"),
  );
  const [category, setCategory] = useState<WatchlistCategory>(() =>
    readStoredValue(NEWS_CATEGORY_STORAGE_KEY, ["US", "A", "H"], "US"),
  );
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState(() => (initialSymbol ?? readStoredText(NEWS_SYMBOL_STORAGE_KEY)).trim().toUpperCase());
  const [manualSymbol, setManualSymbol] = useState(() => (initialSymbol ?? readStoredText(NEWS_SYMBOL_STORAGE_KEY)).trim().toUpperCase());
  const [news, setNews] = useState<SecurityNewsItem[]>([]);
  const [responseSymbol, setResponseSymbol] = useState("");
  const [isLoadingWatchlist, setIsLoadingWatchlist] = useState(false);
  const [isLoadingNews, setIsLoadingNews] = useState(false);
  const [message, setMessage] = useState("");

  const [guardianPresetUrl, setGuardianPresetUrl] = useState(() => readStoredValue(NEWS_GUARDIAN_PRESET_STORAGE_KEY, guardianSources.map((source) => source.url), DEFAULT_GUARDIAN_URL));
  const [guardianCustomUrl, setGuardianCustomUrl] = useState("");
  const [activeGuardianUrl, setActiveGuardianUrl] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_GUARDIAN_URL;
    try {
      return window.localStorage.getItem(NEWS_GUARDIAN_URL_STORAGE_KEY) || DEFAULT_GUARDIAN_URL;
    } catch {
      return DEFAULT_GUARDIAN_URL;
    }
  });
  const [guardianFeedUrl, setGuardianFeedUrl] = useState("");
  const [guardianFeedTitle, setGuardianFeedTitle] = useState("");
  const [guardianItems, setGuardianItems] = useState<GuardianFeedItem[]>([]);
  const [guardianMessage, setGuardianMessage] = useState("");
  const [isLoadingGuardianFeed, setIsLoadingGuardianFeed] = useState(false);
  const [selectedGuardianItem, setSelectedGuardianItem] = useState<GuardianFeedItem | null>(() => initialSymbol ? null : readStoredGuardianItem());
  const [guardianArticle, setGuardianArticle] = useState<GuardianArticleResponse | null>(null);
  const [articleMessage, setArticleMessage] = useState("");
  const [isLoadingArticle, setIsLoadingArticle] = useState(false);
  const [translations, setTranslations] = useState<Record<string, GuardianTranslationCacheEntry>>(() => readGuardianTranslationCache());
  const [translationStatuses, setTranslationStatuses] = useState<Record<string, GuardianTranslationStatus>>({});
  const [translationErrors, setTranslationErrors] = useState<Record<string, string>>({});
  const [translationMessage, setTranslationMessage] = useState("");
  const [articleFontSize, setArticleFontSize] = useState<ArticleFontSize>(() => readArticleFontSize());

  useEffect(() => {
    const next = (initialSymbol ?? "").trim().toUpperCase();
    if (!next) return;
    setNewsMode("security");
    setSourceMode("symbol");
    setManualSymbol(next);
    setSelectedSymbol(next);
    setSelectedGuardianItem(null);
  }, [initialSymbol]);

  useEffect(() => {
    writeStoredValue(NEWS_MODE_STORAGE_KEY, newsMode);
  }, [newsMode]);

  useEffect(() => {
    writeStoredValue(NEWS_SOURCE_MODE_STORAGE_KEY, sourceMode);
  }, [sourceMode]);

  useEffect(() => {
    writeStoredValue(NEWS_CATEGORY_STORAGE_KEY, category);
  }, [category]);

  useEffect(() => {
    if (selectedSymbol) writeStoredValue(NEWS_SYMBOL_STORAGE_KEY, selectedSymbol);
  }, [selectedSymbol]);

  useEffect(() => {
    writeStoredValue(NEWS_GUARDIAN_URL_STORAGE_KEY, activeGuardianUrl);
  }, [activeGuardianUrl]);

  useEffect(() => {
    writeStoredValue(NEWS_GUARDIAN_PRESET_STORAGE_KEY, guardianPresetUrl);
  }, [guardianPresetUrl]);

  useEffect(() => {
    let mounted = true;
    if (newsMode !== "security" || sourceMode !== "watchlist") return undefined;

    async function loadWatchlist() {
      setIsLoadingWatchlist(true);
      setMessage("");
      try {
        const response = await listWatchlist(category);
        if (!mounted) return;
        setWatchlist(response.items);
        if (response.items.length === 0) {
          setSelectedSymbol("");
          setNews([]);
          setResponseSymbol("");
        } else if (!response.items.some((item) => item.symbol === selectedSymbol)) {
          setSelectedSymbol(response.items[0].symbol);
        }
      } catch (caught) {
        if (mounted) {
          setWatchlist([]);
          setMessage(caught instanceof Error ? caught.message : copy.loadFailed);
        }
      } finally {
        if (mounted) {
          setIsLoadingWatchlist(false);
        }
      }
    }

    loadWatchlist();
    return () => {
      mounted = false;
    };
  }, [category, copy.loadFailed, newsMode, selectedSymbol, sourceMode]);

  useEffect(() => {
    let mounted = true;
    if (newsMode !== "security") return undefined;
    const symbol = selectedSymbol.trim();
    if (!symbol) {
      setNews([]);
      setResponseSymbol("");
      return undefined;
    }

    async function loadNews() {
      setIsLoadingNews(true);
      setMessage("");
      try {
        const response = await getSecurityNews(symbol);
        if (!mounted) return;
        setResponseSymbol(response.symbol);
        setNews(response.news);
        if (response.total === 0) {
          setMessage(copy.emptyNews);
        }
      } catch (caught) {
        if (mounted) {
          setNews([]);
          setResponseSymbol("");
          setMessage(caught instanceof Error ? caught.message : copy.loadFailed);
        }
      } finally {
        if (mounted) {
          setIsLoadingNews(false);
        }
      }
    }

    loadNews();
    return () => {
      mounted = false;
    };
  }, [copy.emptyNews, copy.loadFailed, newsMode, selectedSymbol]);

  useEffect(() => {
    let mounted = true;
    if (newsMode !== "guardian") return undefined;
    const url = activeGuardianUrl.trim();
    if (!url) {
      setGuardianItems([]);
      setGuardianFeedUrl("");
      setGuardianFeedTitle("");
      return undefined;
    }

    async function loadGuardianFeed() {
      setIsLoadingGuardianFeed(true);
      setGuardianMessage("");
      try {
        const response = await getGuardianFeed(url);
        if (!mounted) return;
        setGuardianFeedUrl(response.feed_url);
        setGuardianFeedTitle(response.title);
        setGuardianItems(response.items);
        if (response.total === 0) {
          setGuardianMessage(copy.emptyNews);
        }
      } catch (caught) {
        if (mounted) {
          setGuardianItems([]);
          setGuardianFeedUrl("");
          setGuardianFeedTitle("");
          setGuardianMessage(caught instanceof Error ? caught.message : copy.loadFailed);
        }
      } finally {
        if (mounted) {
          setIsLoadingGuardianFeed(false);
        }
      }
    }

    loadGuardianFeed();
    return () => {
      mounted = false;
    };
  }, [activeGuardianUrl, copy.emptyNews, copy.loadFailed, newsMode]);

  useEffect(() => {
    if (!selectedGuardianItem) {
      try {
        window.localStorage.removeItem(NEWS_GUARDIAN_ACTIVE_ARTICLE_STORAGE_KEY);
      } catch {
        // 本地缓存失败不影响抽屉关闭。
      }
      return undefined;
    }

    let mounted = true;
    try {
      window.localStorage.setItem(NEWS_GUARDIAN_ACTIVE_ARTICLE_STORAGE_KEY, JSON.stringify(selectedGuardianItem));
    } catch {
      // 本地缓存失败不影响当前文章阅读。
    }

    setGuardianArticle(null);
    setArticleMessage("");
    setTranslationMessage("");
    setIsLoadingArticle(true);
    getGuardianArticle(selectedGuardianItem.url)
      .then((article) => {
        if (mounted) setGuardianArticle(article);
      })
      .catch((caught) => {
        if (mounted) setArticleMessage(caught instanceof Error ? caught.message : copy.guardianArticleFailed);
      })
      .finally(() => {
        if (mounted) setIsLoadingArticle(false);
      });

    return () => {
      mounted = false;
    };
  }, [copy.guardianArticleFailed, selectedGuardianItem]);

  function handleManualSubmit(event?: FormEvent) {
    event?.preventDefault();
    const next = manualSymbol.trim().toUpperCase();
    if (!next) {
      setMessage(copy.selectSymbol);
      return;
    }
    setSelectedSymbol(next);
  }

  function selectGuardianSource(url: string) {
    setGuardianPresetUrl(url);
    setGuardianCustomUrl("");
    setActiveGuardianUrl(url);
  }

  function handleGuardianCustomSubmit(event: FormEvent) {
    event.preventDefault();
    const next = guardianCustomUrl.trim();
    if (!next) {
      setGuardianMessage(copy.guardianUrlRequired);
      return;
    }
    setGuardianPresetUrl("");
    setActiveGuardianUrl(next);
  }

  function openGuardianArticle(item: GuardianFeedItem) {
    setGuardianArticle(null);
    setArticleMessage("");
    setTranslationMessage("");
    setSelectedGuardianItem(item);
  }

  async function handleTranslateArticle() {
    const body = guardianArticle?.body_text.trim() || "";
    const articleUrl = guardianArticle?.url || selectedGuardianItem?.url || "";
    const translationKey = body ? guardianTranslationCacheKey(articleUrl, body) : "";
    if (!translationKey || !body || translations[translationKey]?.translation) return;
    const task = startGuardianTranslation(translationKey, body);
    setTranslationStatuses((current) => ({ ...current, [translationKey]: "pending" }));
    setTranslationErrors((current) => {
      const next = { ...current };
      delete next[translationKey];
      return next;
    });
    setTranslationMessage("");
    try {
      const translation = await task;
      setTranslations((current) => ({
        ...current,
        [translationKey]: { savedAt: Date.now(), translation },
      }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : copy.guardianTranslateFailed;
      setTranslationErrors((current) => ({ ...current, [translationKey]: message }));
      setTranslationMessage(message);
    } finally {
      setTranslationStatuses((current) => {
        const next = { ...current };
        delete next[translationKey];
        return next;
      });
    }
  }

  function updateArticleFontSize(next: ArticleFontSize) {
    setArticleFontSize(next);
    try {
      window.localStorage.setItem(GUARDIAN_ARTICLE_FONT_SIZE_KEY, next);
    } catch {
      // 本地缓存失败不影响阅读体验。
    }
  }

  const selectedWatchlistItem = useMemo(
    () => watchlist.find((item) => item.symbol === selectedSymbol),
    [selectedSymbol, watchlist],
  );
  const selectedArticleBody = guardianArticle?.body_text.trim() || "";
  const selectedTranslationKey = selectedArticleBody
    ? guardianTranslationCacheKey(guardianArticle?.url || selectedGuardianItem?.url || "", selectedArticleBody)
    : "";
  const selectedTranslation = selectedTranslationKey ? translations[selectedTranslationKey]?.translation || "" : "";
  const isSelectedTranslationPending = Boolean(
    selectedTranslationKey && (translationStatuses[selectedTranslationKey] === "pending" || guardianTranslationTasks.has(selectedTranslationKey)),
  );
  const selectedTranslationError = selectedTranslationKey ? translationErrors[selectedTranslationKey] || "" : "";

  useEffect(() => {
    if (!selectedTranslationKey || selectedTranslation) return undefined;
    const task = guardianTranslationTasks.get(selectedTranslationKey);
    if (!task) return undefined;
    let mounted = true;
    setTranslationStatuses((current) => ({ ...current, [selectedTranslationKey]: "pending" }));
    task
      .then((translation) => {
        if (!mounted) return;
        setTranslations((current) => ({
          ...current,
          [selectedTranslationKey]: { savedAt: Date.now(), translation },
        }));
      })
      .catch((caught) => {
        if (!mounted) return;
        const message = caught instanceof Error ? caught.message : copy.guardianTranslateFailed;
        setTranslationErrors((current) => ({ ...current, [selectedTranslationKey]: message }));
        setTranslationMessage(message);
      })
      .finally(() => {
        if (!mounted) return;
        setTranslationStatuses((current) => {
          const next = { ...current };
          delete next[selectedTranslationKey];
          return next;
        });
      });
    return () => {
      mounted = false;
    };
  }, [copy.guardianTranslateFailed, selectedTranslation, selectedTranslationKey]);

  return (
    <section className="panel motion-panel page-enter finance-flat-page flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="page-toolbar flex flex-wrap items-center justify-end gap-2">
          <div className="inline-flex h-8 items-center rounded-md border border-border bg-muted/45 p-0.5">
            <Button size="sm" variant={newsMode === "security" ? "default" : "ghost"} onClick={() => setNewsMode("security")}>
              <Newspaper />
              {copy.securityNewsTab}
            </Button>
            <Button size="sm" variant={newsMode === "guardian" ? "default" : "ghost"} onClick={() => setNewsMode("guardian")}>
              <Globe2 />
              Guardian
            </Button>
          </div>
          {newsMode === "security" && responseSymbol ? <Badge variant="outline">{responseSymbol}</Badge> : null}
          {newsMode === "guardian" && guardianFeedUrl ? <Badge variant="outline">RSS</Badge> : null}
          {(newsMode === "security" && isLoadingNews) || (newsMode === "guardian" && isLoadingGuardianFeed) ? (
            <Badge variant="muted" className="gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              {common.loading}
            </Badge>
          ) : null}
      </div>

      <div className="grid min-h-0 flex-1 gap-6 py-3 lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-hidden lg:py-4">
        <aside className="finance-module flex min-h-0 flex-col rounded-lg border border-border/80 bg-background/45">
          {newsMode === "security" ? (
            <SecuritySidebar
              category={category}
              categories={categories}
              common={common}
              copy={copy}
              isLoadingWatchlist={isLoadingWatchlist}
              manualSymbol={manualSymbol}
              onCategoryChange={setCategory}
              onManualSubmit={handleManualSubmit}
              onManualSymbolChange={setManualSymbol}
              onSelectSymbol={setSelectedSymbol}
              onSourceModeChange={setSourceMode}
              selectedSymbol={selectedSymbol}
              sourceMode={sourceMode}
              watchlist={watchlist}
            />
          ) : (
            <GuardianSidebar
              activeUrl={activeGuardianUrl}
              copy={copy}
              customUrl={guardianCustomUrl}
              feedUrl={guardianFeedUrl}
              onCustomSubmit={handleGuardianCustomSubmit}
              onCustomUrlChange={setGuardianCustomUrl}
              onSelectSource={selectGuardianSource}
              presetUrl={guardianPresetUrl}
              sources={guardianSources}
            />
          )}
        </aside>

        {newsMode === "security" ? (
          <SecurityNewsList
            copy={copy}
            isLoadingNews={isLoadingNews}
            language={language}
            message={message}
            news={news}
            responseSymbol={responseSymbol}
            selectedSymbol={selectedSymbol}
            selectedWatchlistItem={selectedWatchlistItem}
          />
        ) : (
          <GuardianNewsList
            copy={copy}
            feedTitle={guardianFeedTitle}
            feedUrl={guardianFeedUrl}
            isLoading={isLoadingGuardianFeed}
            items={guardianItems}
            language={language}
            message={guardianMessage}
            onOpenArticle={openGuardianArticle}
          />
        )}
      </div>

      <SideDrawer
        closeLabel={copy.closeArticle}
        open={Boolean(selectedGuardianItem)}
        panelClassName="lg:max-w-[680px]"
        onClose={() => {
          setSelectedGuardianItem(null);
          setGuardianArticle(null);
          setArticleMessage("");
          setTranslationMessage("");
        }}
        title={guardianArticle?.title || selectedGuardianItem?.title || copy.guardianArticle}
        subtitle={guardianArticle?.author || selectedGuardianItem?.author || "Guardian"}
      >
        <div className="space-y-4">
          {isLoadingArticle ? (
            <div className="finance-soft-state rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto mb-3 size-7 animate-spin" />
              {common.loading}
            </div>
          ) : null}

          {articleMessage ? (
            <div className="finance-soft-state rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              {articleMessage}
            </div>
          ) : null}

          {guardianArticle ? (
            <>
              {guardianArticle.thumbnail ? (
                <img
                  alt=""
                  className="aspect-video w-full rounded-md border border-border/80 object-cover"
                  src={guardianArticle.thumbnail}
                />
              ) : null}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {guardianArticle.published_at ? <Badge variant="outline">{formatNewsTime(guardianArticle.published_at, language)}</Badge> : null}
                {guardianArticle.author ? <Badge variant="muted">{guardianArticle.author}</Badge> : null}
              </div>
              {guardianArticle.description ? <p className="text-sm leading-6 text-muted-foreground">{guardianArticle.description}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 rounded-md border border-border/70 bg-muted/30 p-1">
                  {ARTICLE_FONT_SIZES.map((size) => (
                    <Button
                      key={size}
                      size="sm"
                      type="button"
                      variant={articleFontSize === size ? "default" : "ghost"}
                      onClick={() => updateArticleFontSize(size)}
                    >
                      {fontSizeLabel(size, copy)}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {guardianArticle.url ? (
                    <SourceLink href={guardianArticle.url} label={copy.openSource} />
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isSelectedTranslationPending || Boolean(selectedTranslation) || !guardianArticle.body_text.trim()}
                    onClick={handleTranslateArticle}
                  >
                    {isSelectedTranslationPending ? <Loader2 className="animate-spin" /> : <Languages />}
                    {isSelectedTranslationPending ? common.loading : selectedTranslation ? copy.guardianTranslated : copy.guardianTranslate}
                  </Button>
                </div>
              </div>
              <article className={cn("whitespace-pre-line rounded-md border border-border/80 bg-background/50 p-3", ARTICLE_FONT_CLASS[articleFontSize])}>
                {guardianArticle.body_text || copy.guardianNoBody}
              </article>
              {isSelectedTranslationPending ? (
                <div className="finance-soft-state rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="mr-1 inline size-3.5 animate-spin" />
                  {common.loading}
                </div>
              ) : null}
              {selectedTranslationError || translationMessage ? (
                <div className="finance-soft-state rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  {selectedTranslationError || translationMessage}
                </div>
              ) : null}
              {selectedTranslation ? (
                <div className="rounded-md border border-primary/25 bg-primary/5 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-primary">
                    <Languages className="size-3.5" />
                    {copy.guardianTranslation}
                  </div>
                  <p className={cn("whitespace-pre-line", ARTICLE_FONT_CLASS[articleFontSize])}>{selectedTranslation}</p>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </SideDrawer>
    </section>
  );
}

function SecuritySidebar({
  category,
  categories,
  common,
  copy,
  isLoadingWatchlist,
  manualSymbol,
  onCategoryChange,
  onManualSubmit,
  onManualSymbolChange,
  onSelectSymbol,
  onSourceModeChange,
  selectedSymbol,
  sourceMode,
  watchlist,
}: {
  category: WatchlistCategory;
  categories: Array<{ id: WatchlistCategory; label: string; hint: string }>;
  common: typeof i18n.zh.common;
  copy: typeof i18n.zh.newsPage;
  isLoadingWatchlist: boolean;
  manualSymbol: string;
  onCategoryChange: (category: WatchlistCategory) => void;
  onManualSubmit: (event: FormEvent) => void;
  onManualSymbolChange: (value: string) => void;
  onSelectSymbol: (symbol: string) => void;
  onSourceModeChange: (mode: SourceMode) => void;
  selectedSymbol: string;
  sourceMode: SourceMode;
  watchlist: WatchlistItem[];
}) {
  return (
    <>
      <div className="finance-module-header space-y-3 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant={sourceMode === "watchlist" ? "default" : "outline"} onClick={() => onSourceModeChange("watchlist")}>
            <Star />
            {copy.sourceWatchlist}
          </Button>
          <Button size="sm" variant={sourceMode === "symbol" ? "default" : "outline"} onClick={() => onSourceModeChange("symbol")}>
            <Search />
            {copy.sourceSymbol}
          </Button>
        </div>

        {sourceMode === "watchlist" ? (
          <div className="space-y-3">
            <div className="inline-flex h-7 max-w-full items-center overflow-x-auto rounded-full border border-border bg-muted/45 p-0.5">
              {categories.map((item) => (
                <button
                  aria-pressed={category === item.id}
                  className={cn(
                    "h-6 min-w-[4rem] rounded-full px-2.5 text-xs font-medium transition-colors",
                    category === item.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                  key={item.id}
                  onClick={() => onCategoryChange(item.id)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="text-xs font-medium">{copy.selectFromWatchlist}</p>
          </div>
        ) : (
          <form className="space-y-2" onSubmit={onManualSubmit}>
            <p className="text-xs font-medium">{copy.manualSymbol}</p>
            <div className="flex gap-2">
              <Input placeholder={copy.symbolPlaceholder} value={manualSymbol} onChange={(event) => onManualSymbolChange(event.target.value)} />
              <Button className="shrink-0" disabled={!manualSymbol.trim()} type="submit">
                <Search />
                {copy.loadNews}
              </Button>
            </div>
          </form>
        )}
      </div>

      <div className="min-h-0 flex-1 p-3 lg:overflow-y-auto">
        {sourceMode === "watchlist" ? (
          <div className="space-y-2">
            {isLoadingWatchlist ? (
              <div className="finance-soft-state rounded-md border border-border/80 bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
                <Loader2 className="mx-auto mb-2 size-5 animate-spin" />
                {common.loading}
              </div>
            ) : null}
            {!isLoadingWatchlist && watchlist.length === 0 ? (
              <div className="finance-soft-state rounded-md border border-dashed border-border/80 bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                {copy.emptyWatchlist}
              </div>
            ) : null}
            {watchlist.map((item) => (
              <button
                className={cn(
                  "finance-row-card w-full rounded-md border p-3 text-left transition-colors",
                  selectedSymbol === item.symbol ? "border-primary/60 bg-primary/10" : "border-border/80 bg-card/70 hover:border-primary/45",
                )}
                key={item.id}
                onClick={() => onSelectSymbol(item.symbol)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{item.symbol}</p>
                    <p className="truncate text-xs text-muted-foreground">{stockName(item)}</p>
                  </div>
                  {selectedSymbol === item.symbol ? <Badge variant="outline">{copy.selected}</Badge> : null}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="finance-soft-state rounded-md border border-border/80 bg-muted/20 px-3 py-3 text-sm">
            <p className="font-semibold">{selectedSymbol || "-"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{copy.latestNews}</p>
          </div>
        )}
      </div>
    </>
  );
}

function GuardianSidebar({
  activeUrl,
  copy,
  customUrl,
  feedUrl,
  onCustomSubmit,
  onCustomUrlChange,
  onSelectSource,
  presetUrl,
  sources,
}: {
  activeUrl: string;
  copy: typeof i18n.zh.newsPage;
  customUrl: string;
  feedUrl: string;
  onCustomSubmit: (event: FormEvent) => void;
  onCustomUrlChange: (value: string) => void;
  onSelectSource: (url: string) => void;
  presetUrl: string;
  sources: Array<{ label: string; url: string }>;
}) {
  return (
    <>
      <div className="finance-module-header space-y-3 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Rss className="size-4 text-secondary" />
          {copy.guardianSources}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {sources.map((source) => (
            <Button
              className="min-w-0 justify-start"
              key={source.url}
              size="sm"
              variant={presetUrl === source.url ? "default" : "outline"}
              onClick={() => onSelectSource(source.url)}
            >
              <span className="truncate">{source.label}</span>
            </Button>
          ))}
        </div>
        <form className="space-y-2" onSubmit={onCustomSubmit}>
          <p className="text-xs font-medium">{copy.guardianCustomUrl}</p>
          <div className="flex gap-2">
            <Input placeholder="https://www.theguardian.com/world" value={customUrl} onChange={(event) => onCustomUrlChange(event.target.value)} />
            <Button className="shrink-0" disabled={!customUrl.trim()} type="submit">
              <Search />
              {copy.loadNews}
            </Button>
          </div>
        </form>
      </div>
      <div className="min-h-0 flex-1 p-3 lg:overflow-y-auto">
        <div className="finance-soft-state rounded-md border border-border/80 bg-muted/20 px-3 py-3 text-sm">
          <p className="truncate font-semibold">{copy.guardianActiveSource}</p>
          <p className="mt-1 break-all text-xs text-muted-foreground">{feedUrl || activeUrl}</p>
        </div>
      </div>
    </>
  );
}

function SecurityNewsList({
  copy,
  isLoadingNews,
  language,
  message,
  news,
  responseSymbol,
  selectedSymbol,
  selectedWatchlistItem,
}: {
  copy: typeof i18n.zh.newsPage;
  isLoadingNews: boolean;
  language: AppLanguage;
  message: string;
  news: SecurityNewsItem[];
  responseSymbol: string;
  selectedSymbol: string;
  selectedWatchlistItem?: WatchlistItem;
}) {
  return (
    <main className="finance-module flex min-h-0 flex-col rounded-lg border border-border/80 bg-background/45">
      <div className="finance-module-header flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{copy.latestNews}</p>
          <p className="truncate text-xs text-muted-foreground">
            {selectedWatchlistItem ? `${selectedWatchlistItem.symbol} - ${stockName(selectedWatchlistItem)}` : responseSymbol || selectedSymbol || copy.selectSymbol}
          </p>
        </div>
        <Badge variant="muted">{news.length}</Badge>
      </div>

      <div className="min-h-0 flex-1 p-3 lg:overflow-y-auto">
        {message ? (
          <div className="finance-soft-state mb-3 rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {message}
          </div>
        ) : null}

        {!selectedSymbol ? (
          <EmptyState icon={<Newspaper />} label={copy.selectSymbol} />
        ) : null}
        {selectedSymbol && isLoadingNews && news.length === 0 ? (
          <EmptyState icon={<Loader2 className="animate-spin" />} label={i18n[language].common.loading} />
        ) : null}
        {selectedSymbol && !isLoadingNews && news.length === 0 ? (
          <EmptyState icon={<Newspaper />} label={copy.emptyNews} />
        ) : null}
        {news.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {news.map((item) => (
              <NewsCard item={item} key={item.id || item.url || item.title} language={language} />
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function GuardianNewsList({
  copy,
  feedTitle,
  feedUrl,
  isLoading,
  items,
  language,
  message,
  onOpenArticle,
}: {
  copy: typeof i18n.zh.newsPage;
  feedTitle: string;
  feedUrl: string;
  isLoading: boolean;
  items: GuardianFeedItem[];
  language: AppLanguage;
  message: string;
  onOpenArticle: (item: GuardianFeedItem) => void;
}) {
  return (
    <main className="finance-module flex min-h-0 flex-col rounded-lg border border-border/80 bg-background/45">
      <div className="finance-module-header flex items-center justify-between gap-3 p-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{feedTitle || copy.guardianLatest}</p>
          <p className="truncate text-xs text-muted-foreground">{feedUrl || copy.guardianRssHint}</p>
        </div>
        <Badge variant="muted">{items.length}</Badge>
      </div>
      <div className="min-h-0 flex-1 p-3 lg:overflow-y-auto">
        {message ? (
          <div className="finance-soft-state mb-3 rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {message}
          </div>
        ) : null}
        {isLoading && items.length === 0 ? (
          <EmptyState icon={<Loader2 className="animate-spin" />} label={i18n[language].common.loading} />
        ) : null}
        {!isLoading && items.length === 0 ? (
          <EmptyState icon={<Globe2 />} label={copy.emptyNews} />
        ) : null}
        {items.length > 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {items.map((item) => (
              <GuardianCard item={item} key={item.id || item.url || item.title} language={language} onOpenArticle={onOpenArticle} />
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function EmptyState({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="finance-soft-state grid h-full min-h-64 place-items-center rounded-md border border-dashed border-border/80 bg-muted/20 px-4 text-center">
      <div>
        <span className="mx-auto mb-3 block text-muted-foreground [&_svg]:mx-auto [&_svg]:size-8">{icon}</span>
        <p className="text-sm font-medium">{label}</p>
      </div>
    </div>
  );
}

function NewsCard({ item, language }: { item: SecurityNewsItem; language: AppLanguage }) {
  const copy = i18n[language].newsPage;
  return (
    <article className="finance-row-card rounded-md border border-border/80 bg-card/80 p-3 transition-colors hover:border-primary/45">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-semibold leading-5">{item.title || "-"}</p>
          {item.description ? <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{item.description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {item.published_at ? <Badge variant="outline">{formatNewsTime(item.published_at, language)}</Badge> : null}
          <Metric icon={<ThumbsUp />} label={copy.likes} value={item.likes_count} />
          <Metric icon={<MessageCircle />} label={copy.comments} value={item.comments_count} />
          <Metric icon={<Share2 />} label={copy.shares} value={item.shares_count} />
        </div>
        {item.url ? <SourceLink href={item.url} label={copy.openSource} /> : null}
      </div>
    </article>
  );
}

function GuardianCard({ item, language, onOpenArticle }: { item: GuardianFeedItem; language: AppLanguage; onOpenArticle: (item: GuardianFeedItem) => void }) {
  const copy = i18n[language].newsPage;
  return (
    <article className="finance-row-card rounded-md border border-border/80 bg-card/80 p-3 transition-colors hover:border-primary/45">
      <div className="flex min-h-0 flex-col gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-semibold leading-5">{item.title || "-"}</p>
          {item.description ? <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{item.description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {item.published_at ? <Badge variant="outline">{formatNewsTime(item.published_at, language)}</Badge> : null}
          {item.author ? <Badge variant="muted">{item.author}</Badge> : null}
          {item.categories.slice(0, 2).map((category) => (
            <Badge key={category} variant="outline">{category}</Badge>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {item.url ? <SourceLink href={item.url} label={copy.openSource} /> : null}
          <Button size="sm" variant="outline" disabled={!item.url} onClick={() => onOpenArticle(item)}>
            <FileText />
            {copy.guardianReadArticle}
          </Button>
        </div>
      </div>
    </article>
  );
}

function SourceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="inline-flex h-8 w-fit items-center gap-2 rounded-md border border-border/80 bg-background/70 px-3 text-xs font-semibold transition-colors hover:border-primary/45 hover:bg-primary/10"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <ExternalLink className="size-3.5" />
      {label}
    </a>
  );
}

function fontSizeLabel(size: ArticleFontSize, copy: typeof i18n.zh.newsPage) {
  if (size === "small") return copy.fontSmall;
  if (size === "large") return copy.fontLarge;
  return copy.fontMedium;
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: number | null }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="[&_svg]:size-3.5">{icon}</span>
      {label}: {value ?? 0}
    </span>
  );
}

function stockName(item: Pick<WatchlistItem, "name" | "name_cn" | "name_hk" | "name_en">) {
  return item.name || item.name_cn || item.name_hk || item.name_en || "-";
}

function formatNewsTime(value: string, language: AppLanguage) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(localeFor(language), {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
