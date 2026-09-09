import { Field } from "@/components/common/Field";
import { Textarea } from "@/components/ui/textarea";
import { i18n, type AppLanguage } from "@/lib/i18n";
import { MAX_TELEGRAM_PHOTOS, parseTelegramPhotos } from "@/lib/telegram";

export function TelegramPhotoField({
  className,
  language,
  onChange,
  value,
}: {
  className?: string;
  language: AppLanguage;
  onChange: (value: string) => void;
  value: string;
}) {
  const copy = i18n[language].config;
  return (
    <Field
      className={className}
      description={copy.telegramPhotosHint}
      error={parseTelegramPhotos(value).length > MAX_TELEGRAM_PHOTOS ? copy.telegramPhotosTooMany : undefined}
      label={copy.telegramPhotos}
    >
      <Textarea
        className="min-h-[96px]"
        placeholder={copy.telegramPhotosPlaceholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
