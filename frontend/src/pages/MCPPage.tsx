import { Field } from "@/components/common/Field";
import { useErrorToast } from "@/components/common/Toast";
import { MCPServersPanel } from "@/components/mcp/MCPServersPanel";
import { mcpPageCopy } from "@/components/mcp/model";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppLanguage } from "@/i18n";
import { loadConfig, saveConfig } from "@/lib/api";
import { Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";

export function MCPPage({ language }: { language: AppLanguage }) {
  const copy = mcpPageCopy[language];
  const [mcpServersText, setMcpServersText] = useState("{}");
  const [toolTimeoutSeconds, setToolTimeoutSeconds] = useState(60);
  const [isSavingTimeout, setIsSavingTimeout] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, copy.title);

  useEffect(() => {
    loadConfig()
      .then((cfg) => {
        setMcpServersText(JSON.stringify(cfg.mcp_servers ?? {}, null, 2));
        setToolTimeoutSeconds(cfg.mcp_tool_timeout_seconds ?? 60);
      })
      .catch((e) => setError(e instanceof Error ? e.message : copy.loadFailed));
  }, []);

  async function handleServersChange(updated: Record<string, Record<string, unknown>>) {
    setError("");
    try {
      const next = await saveConfig({ mcp_servers: updated });
      setMcpServersText(JSON.stringify(next.mcp_servers ?? {}, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.saveFailed);
    }
  }

  async function handleSaveTimeout() {
    setError("");
    setIsSavingTimeout(true);
    try {
      const timeout = Math.max(1, Number(toolTimeoutSeconds) || 60);
      const next = await saveConfig({ mcp_tool_timeout_seconds: timeout });
      setToolTimeoutSeconds(next.mcp_tool_timeout_seconds ?? timeout);
    } catch (e) {
      setError(e instanceof Error ? e.message : copy.saveFailed);
    } finally {
      setIsSavingTimeout(false);
    }
  }

  return (
    <section className="panel motion-panel page-enter flex min-h-0 min-w-0 flex-1 flex-col rounded-md lg:h-full">
      <div className="page-toolbar flex flex-col items-end gap-2 sm:flex-row sm:justify-end">
        <Field label={copy.toolTimeout}>
          <Input
            className="w-32"
            min={1}
            type="number"
            value={toolTimeoutSeconds}
            onChange={(event) => setToolTimeoutSeconds(Number(event.target.value))}
          />
        </Field>
        <Button size="sm" variant="outline" onClick={handleSaveTimeout} disabled={isSavingTimeout}>
          {isSavingTimeout ? <Loader2 className="animate-spin" /> : <Save />}
          {copy.save}
        </Button>
      </div>

      <div className="panel-body min-h-0 flex-1 lg:overflow-y-auto">
        <MCPServersPanel copy={copy} mcpServersText={mcpServersText} setMcpServersText={setMcpServersText} onServersChange={handleServersChange} />
      </div>
    </section>
  );
}
