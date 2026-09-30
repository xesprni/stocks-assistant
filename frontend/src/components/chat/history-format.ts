import { getMessages, type AppLanguage } from "@/i18n";
export function formatRelativeDate(iso: string, language: AppLanguage): string {
  const copy = getMessages(language).chat.history;
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDate.getTime() === today.getTime()) return copy.today;
  if (msgDate.getTime() === yesterday.getTime()) return copy.yesterday;
  return copy.earlier;
}
