import { TelegramPhotoField } from "@/components/common/TelegramPhotoField";
import { ToggleRow } from "@/components/common/ToggleRow";
import { ConfigField as Field } from "@/components/config/ConfigForm";
import { ConfigSection } from "@/components/config/ConfigSection";
import type { ConfigPageState } from "@/components/config/useSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MAX_TELEGRAM_PHOTOS, parseTelegramPhotos } from "@/lib/telegram";
import { Loader2, MessageCircle, Send } from "lucide-react";

type Props = Pick<ConfigPageState, "copy" | "draft" | "patchDraft" | "telegramTestMessage" | "setTelegramTestMessage" | "setTelegramTestState" | "setTelegramTestResult" | "language" | "telegramTestPhotos" | "setTelegramTestPhotos" | "telegramTestState" | "handleTelegramTest" | "telegramTestResult"> & { draft: NonNullable<ConfigPageState["draft"]> };

export function SettingsChannels({
    copy, draft, patchDraft, telegramTestMessage, setTelegramTestMessage,
    setTelegramTestState, setTelegramTestResult, language, telegramTestPhotos, setTelegramTestPhotos,
    telegramTestState, handleTelegramTest, telegramTestResult,
  }: Props) {
  return (<TabsContent value="channels" className="mt-0 space-y-5">
    <ConfigSection
      description={copy.telegramChannelHint}
      icon={<MessageCircle className="size-4 text-primary" />}
      title={copy.telegramChannel}
    >
      <div className="space-y-3">
        <ToggleRow
          checked={draft.telegram_enabled}
          icon={<MessageCircle className="size-4 text-primary" />}
          label={copy.telegramEnabled}
          onCheckedChange={(checked) => patchDraft({ telegram_enabled: checked })}
        />
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label={copy.telegramBotToken}>
            <Input
              placeholder={draft.has_telegram_bot_token ? draft.telegram_bot_token_masked : "123456:ABC..."}
              type="password"
              value={draft.telegram_bot_token}
              onChange={(event) => patchDraft({ telegram_bot_token: event.target.value })}
            />
          </Field>
          <Field label={copy.telegramChatId}>
            <Input
              placeholder={copy.telegramChatIdPlaceholder}
              value={draft.telegram_chat_id ?? ""}
              onChange={(event) => patchDraft({ telegram_chat_id: event.target.value })}
            />
          </Field>
          <Field label={copy.telegramApiBase}>
            <Input
              placeholder="https://api.telegram.org"
              value={draft.telegram_api_base ?? ""}
              onChange={(event) => patchDraft({ telegram_api_base: event.target.value })}
            />
          </Field>
          <Field label={copy.telegramParseMode}>
            <Input
              placeholder={copy.telegramParseModePlaceholder}
              value={draft.telegram_parse_mode ?? ""}
              onChange={(event) => patchDraft({ telegram_parse_mode: event.target.value })}
            />
          </Field>
        </div>
      </div>
    </ConfigSection>
    <ConfigSection
      description={copy.channelTestSavedHint}
      icon={<Send className="size-4 text-secondary" />}
      title={copy.channelTestMessage}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="grid flex-1 gap-3">
          <Field label={copy.telegramTestMessage}>
            <Textarea
              className="min-h-[72px]"
              placeholder={copy.telegramTestMessagePlaceholder}
              value={telegramTestMessage}
              onChange={(event) => {
                setTelegramTestMessage(event.target.value);
                setTelegramTestState("idle");
                setTelegramTestResult("");
              }}
            />
          </Field>
          <TelegramPhotoField
            className="config-field space-y-0"
            language={language}
            value={telegramTestPhotos}
            onChange={(value) => {
              setTelegramTestPhotos(value);
              setTelegramTestState("idle");
              setTelegramTestResult("");
            }}
          />
        </div>
        <Button
          size="sm"
          className="lg:mb-0.5"
          disabled={telegramTestState === "sending"
            || (!telegramTestMessage.trim() && !telegramTestPhotos.trim())
            || parseTelegramPhotos(telegramTestPhotos).length > MAX_TELEGRAM_PHOTOS}
          onClick={handleTelegramTest}
        >
          {telegramTestState === "sending" ? <Loader2 className="animate-spin" /> : <Send />}
          {copy.telegramTestSend}
        </Button>
      </div>
      <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
        {telegramTestResult ? (
          <span className={telegramTestState === "error" ? "text-destructive" : "text-emerald-600 dark:text-emerald-300"}>
            {telegramTestResult}
          </span>
        ) : null}
      </div>
    </ConfigSection>
  </TabsContent>);
}
