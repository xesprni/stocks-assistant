import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import ts from "typescript";

const sourceRoot = new URL("../src/", import.meta.url);
function sourceFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    return entry.isDirectory() ? sourceFiles(url) : /\.tsx?$/.test(entry.name) ? [url] : [];
  });
}

test("business modules keep language selection and interpolation in the i18n framework", () => {
  const violations: string[] = [];
  for (const url of sourceFiles(sourceRoot)) {
    if (url.pathname.includes("/src/i18n/")) continue;
    const file = fileURLToPath(url);
    const source = ts.createSourceFile(file, readFileSync(url, "utf8"), ts.ScriptTarget.Latest, true);
    function record(node: ts.Node, reason: string) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      violations.push(`${file}:${line + 1}: ${reason}`);
    }
    function visit(node: ts.Node) {
      if (ts.isFunctionDeclaration(node) && ["formatTemplate", "normalizeLanguage", "localeFor"].includes(node.name?.text ?? "")) {
        record(node, "Use the shared i18n implementation");
      }
      if (ts.isObjectLiteralExpression(node)) {
        const names = new Set(node.properties.map((property) => property.name?.getText(source).replace(/["']/g, "")));
        if (names.has("zh") && names.has("en")) record(node, "Move translated labels into locale resources");
      }
      if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(node.operatorToken.kind)) {
        const operands = [node.left, node.right];
        if (operands.some((operand) => ts.isStringLiteral(operand) && ["zh", "en"].includes(operand.text))) {
          record(node, "Resolve locale-dependent content through the registry");
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  assert.deepEqual(violations, []);
});
