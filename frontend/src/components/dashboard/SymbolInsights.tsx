import { useErrorToast } from "@/components/common/Toast";
import { InlineState } from "@/components/dashboard/shared";
import { getMessages, localeFor, type AppLanguage } from "@/i18n";
import type {
  DashboardSymbolInsightSection,
  DashboardSymbolInsightsResponse
} from "@/types/app";
import {
  Building2,
  CalendarDays,
  FileText,
  Landmark,
  Loader2,
  Users
} from "lucide-react";
import { type ReactNode } from "react";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasInsightValue(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (Array.isArray(value)) return value.some(hasInsightValue);
  if (isRecord(value)) return Object.values(value).some(hasInsightValue);
  return true;
}

export function displayInsightValue(value: unknown, language: AppLanguage): string {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? (getMessages(language).dashboard.yes) : (getMessages(language).dashboard.no);
  if (typeof value === "number") return value.toLocaleString(localeFor(language), { maximumFractionDigits: 4 });
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => displayInsightValue(item, language)).filter(Boolean).join(" · ");
  if (isRecord(value)) {
    const direct = firstInsightText(value, ["desc", "name", "title", "value", "target", "recommend", "date_str", "date"], language);
    if (direct) return direct;
    return Object.entries(value)
      .filter(([, entryValue]) => hasInsightValue(entryValue))
      .slice(0, 3)
      .map(([key, entryValue]) => `${key}: ${displayInsightValue(entryValue, language)}`)
      .join(" · ");
  }
  return String(value);
}

export function firstInsightText(record: Record<string, unknown>, keys: string[], language: AppLanguage): string {
  for (const key of keys) {
    const text = displayInsightValue(record[key], language);
    if (text) return text;
  }
  return "";
}

export function dateInsightText(value: unknown, language: AppLanguage): string {
  const text = displayInsightValue(value, language);
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}`;
  return text;
}

export function sectionHasInsightContent(section: DashboardSymbolInsightSection | undefined): boolean {
  if (!section) return false;
  return section.items.length > 0 || hasInsightValue(section.data);
}

export function sectionRecords(section: DashboardSymbolInsightSection | undefined): Array<Record<string, unknown>> {
  return section?.items.filter(isRecord) ?? [];
}

export function InsightField({ href, label, value }: { href?: string; label: string; value: string }) {
  if (!value) return null;
  const content = href ? (
    <a className="truncate text-primary hover:underline" href={href} rel="noreferrer" target="_blank">
      {value}
    </a>
  ) : (
    <span className="truncate">{value}</span>
  );
  return (
    <div className="min-w-0 rounded-md bg-muted/20 px-3 py-2">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 flex min-w-0 text-sm font-semibold">{content}</p>
    </div>
  );
}

export function InsightBlock({
  children,
  icon,
  section,
  title,
}: {
  children?: ReactNode;
  icon: ReactNode;
  section?: DashboardSymbolInsightSection;
  title: string;
}) {
  const hasContent = sectionHasInsightContent(section);
  if (!hasContent && !section?.error) return null;
  return (
    <div className="border-t border-border/55 pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex min-w-0 items-center gap-2 text-sm font-semibold">
        <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
        <span className="truncate">{title}</span>
      </div>
      {section?.error && !hasContent ? <InlineState>{section.error}</InlineState> : children}
    </div>
  );
}

export function CompanyInsightSection({ language, section }: { language: AppLanguage; section: DashboardSymbolInsightSection }) {
  const labels = getMessages(language).dashboard.company;
  const data = section.data;
  const profile = firstInsightText(data, ["profile"], language);
  const website = firstInsightText(data, ["website"], language);
  const fields = [
    { label: labels.fullName, value: firstInsightText(data, ["company_name", "name"], language) },
    { label: labels.market, value: [firstInsightText(data, ["market"], language), firstInsightText(data, ["region"], language)].filter(Boolean).join(" · ") },
    { label: labels.category, value: firstInsightText(data, ["category"], language) },
    { label: labels.founded, value: dateInsightText(data.founded, language) },
    { label: labels.listing, value: dateInsightText(data.listing_date, language) },
    { label: labels.fiscalYear, value: firstInsightText(data, ["year_end"], language) },
    { label: labels.employees, value: firstInsightText(data, ["employees"], language) },
    { label: labels.manager, value: firstInsightText(data, ["manager", "legal_repr"], language) },
    { label: labels.chairman, value: firstInsightText(data, ["chairman"], language) },
    { label: labels.website, value: website, href: /^https?:\/\//i.test(website) ? website : undefined },
    { label: labels.office, value: firstInsightText(data, ["office_address", "address"], language) },
  ].filter((field) => field.value);

  return (
    <InsightBlock icon={<Building2 />} section={section} title={labels.title}>
      <div className="space-y-3">
        {profile ? <p className="text-sm leading-6 text-muted-foreground">{profile}</p> : null}
        {fields.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {fields.map((field) => (
              <InsightField href={field.href} key={field.label} label={field.label} value={field.value} />
            ))}
          </div>
        ) : null}
      </div>
    </InsightBlock>
  );
}

export function RatingInsightSection({ language, section }: { language: AppLanguage; section: DashboardSymbolInsightSection }) {
  const labels = getMessages(language).dashboard.rating;
  const summary = isRecord(section.data.summary) ? section.data.summary : {};
  const latest = isRecord(section.data.latest) ? section.data.latest : {};
  const evaluate = isRecord(summary.evaluate) ? summary.evaluate : isRecord(latest.evaluate) ? latest.evaluate : {};
  const ccy = firstInsightText(summary, ["ccy_symbol"], language);
  const fields = [
    { label: labels.recommend, value: firstInsightText(summary, ["recommend"], language) },
    { label: labels.target, value: [ccy, firstInsightText(summary, ["target"], language)].filter(Boolean).join("") },
    { label: labels.change, value: firstInsightText(summary, ["change"], language) },
    { label: labels.updated, value: firstInsightText(summary, ["updated_at"], language) },
    { label: labels.buy, value: [firstInsightText(evaluate, ["strong_buy"], language), firstInsightText(evaluate, ["buy"], language)].filter(Boolean).join(" / ") },
    { label: labels.hold, value: firstInsightText(evaluate, ["hold"], language) },
    { label: labels.sell, value: [firstInsightText(evaluate, ["sell"], language), firstInsightText(evaluate, ["under"], language)].filter(Boolean).join(" / ") },
  ].filter((field) => field.value);

  return (
    <InsightBlock icon={<Users />} section={section} title={labels.title}>
      {fields.length > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {fields.map((field) => (
            <InsightField key={field.label} label={field.label} value={field.value} />
          ))}
        </div>
      ) : null}
    </InsightBlock>
  );
}

export function ListInsightSection({
  icon,
  kind,
  language,
  section,
  title,
}: {
  icon: ReactNode;
  kind: "dividend" | "action" | "filing";
  language: AppLanguage;
  section: DashboardSymbolInsightSection;
  title: string;
}) {
  const emptyLabel = getMessages(language).dashboard.emptyLabel;
  const records = sectionRecords(section).slice(0, 4);

  function recordTitle(record: Record<string, unknown>) {
    if (kind === "dividend") return firstInsightText(record, ["desc", "title", "name"], language);
    if (kind === "action") return firstInsightText(record, ["act_desc", "action", "act_type", "title"], language);
    return firstInsightText(record, ["title", "name", "filing_title", "type", "desc"], language);
  }

  function recordMeta(record: Record<string, unknown>) {
    if (kind === "dividend") {
      return [
        dateInsightText(record.ex_date, language) ? `${getMessages(language).dashboard.ex} ${dateInsightText(record.ex_date, language)}` : "",
        dateInsightText(record.payment_date, language) ? `${getMessages(language).dashboard.pay} ${dateInsightText(record.payment_date, language)}` : "",
      ].filter(Boolean).join(" · ");
    }
    if (kind === "action") {
      return [
        dateInsightText(record.date_str || record.date, language),
        firstInsightText(record, ["act_type", "date_type"], language),
      ].filter(Boolean).join(" · ");
    }
    return [
      dateInsightText(record.date || record.publish_time || record.released_at || record.time, language),
      firstInsightText(record, ["type", "source"], language),
    ].filter(Boolean).join(" · ");
  }

  return (
    <InsightBlock icon={icon} section={section} title={title}>
      {records.length > 0 ? (
        <div className="divide-y divide-border/55 border-y border-border/55">
          {records.map((record, index) => {
            const itemTitle = recordTitle(record) || emptyLabel;
            const meta = recordMeta(record);
            return (
              <div className="min-w-0 py-2.5" key={`${itemTitle}-${index}`}>
                <p className="line-clamp-2 text-sm font-semibold">{itemTitle}</p>
                {meta ? <p className="mt-1 truncate text-xs text-muted-foreground">{meta}</p> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </InsightBlock>
  );
}

export function SymbolInsightsPanel({
  canFundamentals,
  error,
  insights,
  language,
  loading,
}: {
  canFundamentals: boolean;
  error: string;
  insights: DashboardSymbolInsightsResponse | null;
  language: AppLanguage;
  loading: boolean;
}) {
  const labels = getMessages(language).dashboard.insights;
  const hasAnyContent = Boolean(insights && [
    insights.company,
    insights.institution_rating,
    insights.dividends,
    insights.corporate_actions,
    insights.filings,
  ].some((section) => sectionHasInsightContent(section) || section.error));
  useErrorToast(error, labels.title);

  return (
    <div className="border-t border-border/55 pt-4">
      <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{labels.title}</p>
          <p className="truncate text-xs text-muted-foreground">{labels.subtitle}</p>
        </div>
        {loading && insights ? (
          <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {labels.refreshing}
          </span>
        ) : null}
      </div>

      {!canFundamentals ? (
        <InlineState>{labels.hidden}</InlineState>
      ) : loading && !insights ? (
        <InlineState icon={<Loader2 className="size-4 animate-spin" />}>{labels.loading}</InlineState>
      ) : !insights || !hasAnyContent ? (
        <InlineState>{labels.empty}</InlineState>
      ) : (
        <div className="space-y-4">
          <CompanyInsightSection language={language} section={insights.company} />
          <RatingInsightSection language={language} section={insights.institution_rating} />
          <ListInsightSection icon={<CalendarDays />} kind="dividend" language={language} section={insights.dividends} title={labels.dividends} />
          <ListInsightSection icon={<Landmark />} kind="action" language={language} section={insights.corporate_actions} title={labels.actions} />
          <ListInsightSection icon={<FileText />} kind="filing" language={language} section={insights.filings} title={labels.filings} />
        </div>
      )}
    </div>
  );
}
