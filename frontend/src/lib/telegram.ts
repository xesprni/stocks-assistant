export const MAX_TELEGRAM_PHOTOS = 10;

export function parseTelegramPhotos(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
