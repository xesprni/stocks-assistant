import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: [new URL("../src/lib/api.ts", import.meta.url).pathname],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  define: { "import.meta.env": "{}" },
  tsconfig: new URL("../tsconfig.app.json", import.meta.url).pathname,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`;
const loadApi = () => import(`${moduleUrl}#${crypto.randomUUID()}`);

test("PNG downloads use bearer authentication and survive token refresh", { timeout: 5000 }, async (t) => {
  const api = await loadApi();
  api.setAuthTokens({ access_token: "expired", refresh_token: "refresh" });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, authorization: new Headers(init.headers).get("Authorization") });
    if (url === "/api/v1/auth/refresh") {
      return Response.json({ access_token: "renewed", refresh_token: "next", user: {} });
    }
    if (calls.length === 1) return Response.json({ detail: "Expired" }, { status: 401 });
    return new Response("png-payload", { headers: { "Content-Type": "image/png" } });
  });
  const blob = await api.getRenderedImage("a".repeat(32), "image.png");
  assert.ok(blob instanceof Blob);
  assert.equal(blob.type, "image/png");
  assert.equal(await blob.text(), "png-payload");
  assert.equal(calls.length, 3);
  assert.equal(calls[0].authorization, "Bearer expired");
  assert.equal(calls[2].authorization, "Bearer renewed");
});

test("missing PNGs report the API error without trying to decode JSON as an image", async (t) => {
  const api = await loadApi();
  t.mock.method(globalThis, "fetch", async () => Response.json({ detail: "Rendered image not found" }, { status: 404 }));
  await assert.rejects(api.getRenderedImage("b".repeat(32), "top.png"), /Rendered image not found/);
});

test("saved conversation metadata restores image previews", async (t) => {
  const api = await loadApi();
  const id = "c".repeat(32);
  const image = { artifact_id: id, width: 2400, height: 3000, files: { image: `artifacts/renderings/${id}/image.png` } };
  t.mock.method(globalThis, "fetch", async () => Response.json({
    id: "session", title: "Report", created_at: "2026-09-09T00:00:00Z", updated_at: "2026-09-09T00:00:00Z", message_count: 1,
    messages: [{ id: "message", role: "assistant", content: "Done", created_at: "2026-09-09T00:00:00Z", metadata: { rendered_images: [image] } }],
  }));
  const conversation = await api.getChatSession("session");
  assert.deepEqual(conversation.messages[0].renderedImages, [image]);
});
