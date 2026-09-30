import { useI18n } from "@/i18n/react";
import { cn } from "@/lib/utils";
import {
  Check,
  Copy
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useState } from "react";

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const { messages } = useI18n();
  const [copied, setCopied] = useState(false);

  // copied 变为 true 后 1.5s 自动复位；组件卸载或再次复制时清理旧定时器。
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function handleCopy(e: ReactMouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      // clipboard API not available
    }
  }

  return (
    <button
      type="button"
      className={cn(
        "shrink-0 rounded-md p-1 text-current/60 transition-colors hover:bg-foreground/10 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onClick={handleCopy}
      title={copied ? messages.chat.copied : messages.chat.copy}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}
