import type { AppLanguage } from "@/lib/i18n";
import type { LoginRecord, LoginSession } from "@/types/app";

export function deviceInfo(userAgent: string, unknown: string) {
  const source = userAgent || "";
  // iOS 的 UA 也包含 Mac OS，移动浏览器也使用自己的标识，必须优先识别。
  const os = /iPad/i.test(source) ? "iPadOS"
    : /iPhone|iPod/i.test(source) ? "iOS"
      : /Android/i.test(source) ? "Android"
        : /Windows/i.test(source) ? "Windows"
          : /Mac OS|Macintosh/i.test(source) ? "macOS"
            : /Linux/i.test(source) ? "Linux" : unknown;
  const browser = /Edg(?:e|A|iOS)?\//i.test(source) ? "Edge"
    : /OPR\/|Opera|OPT\//i.test(source) ? "Opera"
      : /SamsungBrowser\//i.test(source) ? "Samsung Internet"
        : /Firefox\/|FxiOS\//i.test(source) ? "Firefox"
          : /Chrome\/|CriOS\//i.test(source) ? "Chrome"
            : /Safari\//i.test(source) ? "Safari" : "";
  const kind = /iPad|Tablet/i.test(source) || (/Android/i.test(source) && !/Mobile/i.test(source))
    ? "tablet" : /iPhone|iPod|Android|Mobile/i.test(source) ? "phone" : "desktop";
  return { name: browser ? `${browser} · ${os}` : os, os, browser, kind };
}

export function sessionKey(session: Pick<LoginRecord, "user_id" | "id">) {
  return `${session.user_id}:${session.id}`;
}

export function dateValue(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function hasValidLogin(record: LoginRecord | LoginSession, now = Date.now()) {
  const records = "records" in record && Array.isArray(record.records) && record.records.length > 0
    ? record.records : [record];
  // 离线或 refresh token 失效不代表访问权限已撤销；设备内任一有效登录都应允许退出。
  return records.some((item) => !item.revoked_at && dateValue(item.expires_at) > now);
}

export function formatSessionDate(value: string, language: AppLanguage) {
  if (!dateValue(value)) return "—";
  return new Date(value).toLocaleString(language === "en" ? "en-US" : "zh-CN", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function relativeSessionDate(value: string, language: AppLanguage, now: number) {
  if (!dateValue(value)) return "—";
  const seconds = Math.min(0, Math.round((dateValue(value) - now) / 1000));
  const formatter = new Intl.RelativeTimeFormat(language === "en" ? "en" : "zh-CN", { numeric: "auto" });
  if (seconds > -60) return formatter.format(0, "second");
  if (seconds > -3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (seconds > -86400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (seconds > -604800) return formatter.format(Math.round(seconds / 86400), "day");
  return formatSessionDate(value, language);
}
