import type { ConfigPageState } from "@/components/config/useSettings";
import { MarketConfigPage } from "@/components/MarketConfigPage";
import { TabsContent } from "@/components/ui/tabs";

type Props = Pick<ConfigPageState, "language" | "marketSettings" | "canWriteMarket">;

export function SettingsMarket({ language, marketSettings, canWriteMarket }: Props) {
  return (<TabsContent value="market" className="mt-0 space-y-5">
    <MarketConfigPage
      embedded
      language={language}
      {...marketSettings}
      readOnly={!canWriteMarket}
    />
  </TabsContent>);
}
