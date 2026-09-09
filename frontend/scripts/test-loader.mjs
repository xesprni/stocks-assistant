import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) specifier = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
  try {
    return nextResolve(specifier, context);
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND" || !/^(\.\.?\/|file:)/.test(specifier)) throw error;
    for (const extension of [".ts", ".tsx"]) {
      try { return nextResolve(`${specifier}${extension}`, context); } catch { /* Try the next source extension. */ }
    }
    throw error;
  }
}

export function load(url, context, nextLoad) {
  if (!/\.tsx?$/.test(url)) return nextLoad(url, context);
  const source = readFileSync(new URL(url), "utf8");
  const result = transformSync(source, { loader: url.endsWith(".tsx") ? "tsx" : "ts", format: "esm", sourcemap: "inline", sourcefile: url });
  return { format: "module", source: result.code, shortCircuit: true };
}
