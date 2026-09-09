import { useEffect, useState } from "react";
import { Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getRenderedImage } from "@/lib/api";
import { i18n, type AppLanguage } from "@/lib/i18n";
import type { RenderedImage, RenderedImageFile } from "@/types/app";

function useImageUrl(artifactId: string, filename: RenderedImageFile | null) {
  const [attempt, setAttempt] = useState(0);
  const key = `${artifactId}:${filename}:${attempt}`;
  const [state, setState] = useState({ key: "", url: "", error: "" });
  useEffect(() => {
    if (!filename) return;
    const controller = new AbortController();
    let objectUrl = "";
    void getRenderedImage(artifactId, filename, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setState({ key, url: objectUrl, error: "" });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setState({ key, url: "", error: error instanceof Error ? error.message : "Request failed" });
      }
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifactId, filename, key]);
  return {
    url: state.key === key ? state.url : "",
    error: state.key === key ? state.error : "",
    retry: () => setAttempt((value) => value + 1),
  };
}

export function RenderImagePreview({ artifact, language }: { artifact: RenderedImage; language: AppLanguage }) {
  const text = i18n[language].chat;
  const [selected, setSelected] = useState<RenderedImageFile>("image.png");
  const original = useImageUrl(artifact.artifact_id, "image.png");
  const inspection = useImageUrl(artifact.artifact_id, selected === "image.png" ? null : selected);
  const preview = selected === "image.png" ? original : inspection;
  const options = [
    { key: "image", file: "image.png", label: text.imageFull },
    { key: "top", file: "top.png", label: text.imageTop },
    { key: "middle", file: "middle.png", label: text.imageMiddle },
    { key: "bottom", file: "bottom.png", label: text.imageBottom },
    { key: "mobile", file: "mobile.png", label: text.imageMobile },
  ] as const;
  const currentLabel = options.find((option) => option.file === selected)?.label ?? text.imageFull;

  return (
    <section className="not-prose mb-3 min-w-0 space-y-2 rounded-xl border border-border bg-background/70 p-3" aria-label={text.renderedImage}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{text.renderedImage} <span className="text-xs font-normal text-muted-foreground">{artifact.width} × {artifact.height} px · PNG</span></p>
        {original.url ? (
          <Button asChild className="h-8 text-xs" size="sm" variant="outline">
            <a download={`render-${artifact.artifact_id}.png`} href={original.url}><Download className="size-3.5" />{text.imageDownload}</a>
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={text.imageInspections}>
        {options.filter((option) => option.key === "image" || artifact.files[option.key]).map((option) => (
          <Button
            aria-pressed={selected === option.file}
            className="h-8 px-2.5 text-xs"
            key={option.file}
            onClick={() => setSelected(option.file)}
            size="sm"
            variant={selected === option.file ? "secondary" : "ghost"}
          >{option.label}</Button>
        ))}
      </div>
      {preview.error ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert">
          <span>{text.imageLoadFailed}: {preview.error}</span>
          <Button onClick={preview.retry} size="sm" variant="ghost"><RefreshCw className="size-3.5" />{text.imageRetry}</Button>
        </div>
      ) : preview.url ? (
        <a className="block rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={preview.url} rel="noreferrer" target="_blank" title={text.imageOpen}>
          <img alt={`${text.renderedImage} · ${currentLabel}`} className="mx-auto max-h-[480px] max-w-full rounded-lg object-contain" src={preview.url} />
          <span className="flex items-center justify-center gap-1 py-2 text-xs text-muted-foreground"><ExternalLink className="size-3" />{text.imageOpen}</span>
        </a>
      ) : (
        <div className="flex min-h-24 items-center justify-center gap-2 text-xs text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" />{text.imageLoading}</div>
      )}
    </section>
  );
}
