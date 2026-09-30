import { ConfigField as Field } from "@/components/config/ConfigForm";
import { ConfigSection } from "@/components/config/ConfigSection";
import type { ConfigPageState } from "@/components/config/useSettings";
import { LongbridgeAuthPanel } from "@/components/LongbridgeAuthPanel";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { Database, Globe2, ShieldCheck } from "lucide-react";

type Props = Pick<ConfigPageState, "copy" | "draft" | "language" | "onLongbridgeAuthChanged" | "patchDraft" | "layoutCopy"> & { draft: NonNullable<ConfigPageState["draft"]> };

export function SettingsLongbridge({ copy, draft, language, onLongbridgeAuthChanged, patchDraft, layoutCopy }: Props) {
  return (<TabsContent value="longbridge" className="mt-0 space-y-5">
    <ConfigSection
      description={copy.credentialSectionHint}
      icon={<ShieldCheck className="size-4 text-primary" />}
      title={copy.credentialSection}
    >
      <LongbridgeAuthPanel
        draft={draft}
        language={language}
        onAuthChanged={onLongbridgeAuthChanged}
        patchDraft={patchDraft}
      />
    </ConfigSection>
    <ConfigSection
      description={copy.endpointSectionHint}
      icon={<Database className="size-4 text-secondary" />}
      title={copy.endpointSection}
    >
      <div className="grid items-start gap-x-5 gap-y-5 md:grid-cols-2">
        <Field label="HTTP URL">
          <Input
            placeholder={layoutCopy.sdkDefault}
            value={draft.longbridge_http_url ?? ""}
            onChange={(event) => patchDraft({ longbridge_http_url: event.target.value })}
          />
        </Field>
        <Field label="Quote WS URL">
          <Input
            placeholder={layoutCopy.sdkDefault}
            value={draft.longbridge_quote_ws_url ?? ""}
            onChange={(event) => patchDraft({ longbridge_quote_ws_url: event.target.value })}
          />
        </Field>
      </div>
    </ConfigSection>
    <ConfigSection
      description={copy.webSearchSectionHint}
      icon={<Globe2 className="size-4 text-secondary" />}
      title={copy.webSearchSection}
    >
      <div className="grid items-start gap-x-5 gap-y-5 md:grid-cols-2">
        <Field label={copy.webSearchApiUrl}>
          <Input
            value={draft.search_api_url ?? ""}
            onChange={(event) => patchDraft({ search_api_url: event.target.value })}
          />
        </Field>
        <Field label={copy.webSearchApiKey}>
          <Input
            placeholder={draft.has_search_api_key ? draft.search_api_key_masked : "Bocha API key"}
            type="password"
            value={draft.search_api_key}
            onChange={(event) => patchDraft({ search_api_key: event.target.value })}
          />
        </Field>
      </div>
    </ConfigSection>
  </TabsContent>);
}
