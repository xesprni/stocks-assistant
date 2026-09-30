import { ConfigField as Field } from "@/components/config/ConfigForm";
import { ConfigSection } from "@/components/config/ConfigSection";
import type { ConfigPageState } from "@/components/config/useSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";

type Props = Pick<ConfigPageState, "copy" | "setIsPasswordDialogOpen" | "canManageSystem" | "draft" | "patchDraft"> & { draft: NonNullable<ConfigPageState["draft"]> };

export function SettingsSecurity({ copy, setIsPasswordDialogOpen, canManageSystem, draft, patchDraft }: Props) {
  return (<TabsContent value="security" className="mt-0 space-y-5">
    <ConfigSection
      description={copy.accountSecurityHint}
      icon={<LockKeyhole className="size-4 text-secondary" />}
      title={copy.accountSecurity}
    >
      <div className="flex justify-start">
        <Button size="sm" variant="outline" onClick={() => setIsPasswordDialogOpen(true)}>
          <KeyRound />
          {copy.changePassword}
        </Button>
      </div>
      {canManageSystem ? (
        <div className="mt-5 grid gap-4 border-t border-border/60 pt-5 sm:grid-cols-[minmax(0,1fr)_160px] sm:items-center">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{copy.maxLoginDevices}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.maxLoginDevicesHint}</p>
            </div>
          </div>
          <Field label={copy.maxLoginDevicesValue}>
            <Input
              min={1}
              max={50}
              type="number"
              value={draft.auth_max_devices_per_user}
              onChange={(event) => patchDraft({ auth_max_devices_per_user: Number(event.target.value) })}
            />
          </Field>
        </div>
      ) : null}
    </ConfigSection>

  </TabsContent>);
}
