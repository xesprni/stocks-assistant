export function formatJsonParseError(error: unknown, label = "JSON") {
  const message = error instanceof Error ? error.message : "格式错误";
  if (/Unexpected non-whitespace character after JSON/i.test(message)) {
    return `${label} 格式错误：一个完整 JSON 对象后面还有多余内容。请删除第二段 JSON、注释或 Markdown 代码围栏，只保留一个 JSON 对象。`;
  }
  return `${label} 格式错误：${message}`;
}

export function parseJsonObject(text: string, label = "JSON") {
  const trimmed = text.trim();
  if (!trimmed) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(formatJsonParseError(error, label));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是对象`);
  }
  return parsed as Record<string, unknown>;
}

