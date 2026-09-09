import type { RenderedImage } from "@/types/app";

export function parseRenderedImage(value: unknown): RenderedImage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.artifact_id !== "string" || !/^[0-9a-f]{32}$/.test(item.artifact_id)) return null;
  if (typeof item.width !== "number" || !Number.isSafeInteger(item.width) || item.width <= 0) return null;
  if (typeof item.height !== "number" || !Number.isSafeInteger(item.height) || item.height <= 0) return null;
  const files: RenderedImage["files"] = {};
  const supplied = item.files && typeof item.files === "object" ? item.files as Record<string, unknown> : {};
  for (const name of ["image", "top", "middle", "bottom", "mobile"] as const) {
    const expected = `artifacts/renderings/${item.artifact_id}/${name}.png`;
    // 只识别固定制图产物；下载地址由受认证 API 生成，不使用工具提供的任意 URL。
    if (supplied[name] === expected) files[name] = expected;
  }
  return { artifact_id: item.artifact_id, width: item.width, height: item.height, files };
}

export function parseRenderedImages(value: unknown): RenderedImage[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, RenderedImage>();
  for (const item of value) {
    const parsed = parseRenderedImage(item);
    if (parsed) unique.set(parsed.artifact_id, parsed);
  }
  return [...unique.values()];
}
