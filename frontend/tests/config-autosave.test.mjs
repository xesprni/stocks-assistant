import assert from "node:assert/strict";
import { test } from "node:test";
import { configAutosaveDelay, createConfigAutosave } from "../src/lib/config-autosave.ts";

const defaults = {
  llm_model: "original-model",
  llm_provider: "openai",
  llm_auth_mode: "api_key",
  llm_reasoning_effort: "medium",
  llm_api_key_masked: "saved-key",
  system_prompt: "original prompt",
  mcp_servers_text: "[]",
  memory_enabled: false,
  agent_max_steps: 8,
};

// 密钥在服务端响应中只保留掩码，重新生成草稿时必须清空已保存的明文。
const toDraft = (config) => ({ ...defaults, ...config, llm_api_key: "" });
const clone = (value) => structuredClone(value);
const settle = async () => {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
};

function setup(t, initial = {}, extra = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const drafts = [];
  const saved = [];
  const states = [];
  const errors = [];
  const controller = createConfigAutosave({
    persist: (source, patch) => {
      const completion = Promise.withResolvers();
      calls.push({ source: clone(source), patch: clone(patch), ...completion });
      return completion.promise;
    },
    toDraft,
    onDraft: (draft) => drafts.push(clone(draft)),
    onSaved: (config) => saved.push(clone(config)),
    onState: (state) => states.push(state),
    onError: (error) => errors.push(error),
    ...extra,
  });
  t.after(() => controller.dispose());
  controller.acceptSaved({ ...defaults, ...initial });
  return {
    controller, calls, drafts, saved, states, errors,
    draft: () => drafts.at(-1),
    async tick(milliseconds) {
      t.mock.timers.tick(milliseconds);
      await settle();
    },
    async succeed(index, response = {}) {
      const call = calls[index];
      assert.ok(call, `Expected save request ${index + 1}`);
      const config = { ...saved.at(-1), ...call.patch, ...response };
      delete config.llm_api_key;
      call.resolve(config);
      await settle();
    },
  };
}

test("save delays distinguish text, long text, booleans and discrete options", () => {
  assert.equal(configAutosaveDelay({ llm_model: "next" }), 800);
  assert.equal(configAutosaveDelay({ agent_max_steps: 12 }), 800);
  assert.equal(configAutosaveDelay({ system_prompt: "long prompt" }), 1200);
  assert.equal(configAutosaveDelay({ mcp_servers_text: "[]" }), 1200);
  assert.equal(configAutosaveDelay({ memory_enabled: true }), 0);
  assert.equal(configAutosaveDelay({ llm_provider: "anthropic" }), 0);
  assert.equal(configAutosaveDelay({ llm_reasoning_effort: "high" }), 0);
  assert.equal(configAutosaveDelay({ agent_tool_allowlist: ["read_file"] }), 0);
});

test("typing resets the 800 ms debounce and submits only the latest values", async (t) => {
  const h = setup(t);
  h.controller.patch({ llm_model: "partial" });
  await h.tick(799);
  assert.equal(h.calls.length, 0);
  h.controller.patch({ llm_model: "finished", agent_max_steps: 12 });
  await h.tick(799);
  assert.equal(h.calls.length, 0);
  await h.tick(1);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].patch, { llm_model: "finished", agent_max_steps: 12 });
  assert.equal(h.controller.isDirty(), true);
  await h.succeed(0);
  assert.equal(h.controller.isDirty(), false);
  assert.equal(h.states.at(-1), "saved");
});

test("long text waits 1200 ms after the final edit", async (t) => {
  const h = setup(t);
  h.controller.patch({ system_prompt: "first revision" });
  await h.tick(1199);
  assert.equal(h.calls.length, 0);
  h.controller.patch({ system_prompt: "final revision" });
  await h.tick(1199);
  assert.equal(h.calls.length, 0);
  await h.tick(1);
  assert.deepEqual(h.calls[0].patch, { system_prompt: "final revision" });
  await h.succeed(0);
});

test("boolean and enum changes save immediately without waiting for a timer", async (t) => {
  const h = setup(t);
  h.controller.patch({ memory_enabled: true });
  await settle();
  assert.deepEqual(h.calls[0].patch, { memory_enabled: true });
  await h.succeed(0);
  h.controller.patch({ llm_reasoning_effort: "high" });
  await settle();
  assert.deepEqual(h.calls[1].patch, { llm_reasoning_effort: "high" });
  await h.succeed(1);
  await h.tick(10_000);
  assert.equal(h.calls.length, 2);
});

test("flush saves pending text immediately and cancels its debounce timer", async (t) => {
  const h = setup(t);
  h.controller.patch({ llm_model: "blurred-model" });
  const flushed = h.controller.flush();
  await settle();
  assert.equal(h.calls.length, 1);
  await h.succeed(0);
  await flushed;
  await h.tick(10_000);
  assert.equal(h.calls.length, 1);
});

test("reset restores the saved draft and cancels pending work", async (t) => {
  const h = setup(t);
  h.controller.patch({ llm_model: "discarded", llm_api_key: "discarded-key" });
  h.controller.reset();
  assert.equal(h.draft().llm_model, defaults.llm_model);
  assert.equal(h.draft().llm_api_key, "");
  assert.equal(h.controller.isDirty(), false);
  assert.equal(h.states.at(-1), "idle");
  await h.tick(10_000);
  await h.controller.flush();
  assert.equal(h.calls.length, 0);
});

test("initialization, unchanged values and reverting to saved values never persist", async (t) => {
  const h = setup(t);
  await h.tick(10_000);
  h.controller.patch({ llm_model: defaults.llm_model });
  await h.tick(10_000);
  h.controller.patch({ llm_model: "temporary-model" });
  h.controller.patch({ llm_model: defaults.llm_model });
  await h.tick(10_000);
  await h.controller.flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.controller.isDirty(), false);
  assert.equal(h.draft().llm_model, defaults.llm_model);
});

test("an in-flight response preserves newer edits and keys and queues requests serially", async (t) => {
  const h = setup(t);
  h.controller.patch({ llm_model: "first-model", llm_api_key: "first-key" });
  await h.tick(800);
  assert.equal(h.calls.length, 1);
  h.controller.patch({ llm_model: "second-model", llm_api_key: "second-key" });
  await h.tick(800);
  assert.equal(h.calls.length, 1, "The second request must wait for the first response");
  await h.succeed(0, { llm_api_key_masked: "first-key-mask" });
  assert.equal(h.draft().llm_model, "second-model");
  assert.equal(h.draft().llm_api_key, "second-key");
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].patch, { llm_model: "second-model", llm_api_key: "second-key" });
  assert.equal(h.calls[1].source.llm_api_key, "second-key");
  h.controller.patch({ llm_model: "third-model" });
  h.controller.flush();
  await settle();
  assert.equal(h.calls.length, 2);
  await h.succeed(1, { llm_api_key_masked: "second-key-mask" });
  assert.equal(h.draft().llm_api_key, "");
  assert.equal(h.draft().llm_model, "third-model");
  assert.equal(h.calls.length, 3);
  assert.deepEqual(h.calls[2].patch, { llm_model: "third-model" });
  await h.succeed(2);
  assert.equal(h.controller.isDirty(), false);
});

test("a response does not bypass the debounce for a recent edit", async (t) => {
  const h = setup(t);
  h.controller.patch({ llm_model: "first-model" });
  await h.tick(800);
  h.controller.patch({ llm_model: "second-model" });
  await h.tick(200);
  await h.succeed(0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.draft().llm_model, "second-model");
  await h.tick(599);
  assert.equal(h.calls.length, 1);
  await h.tick(1);
  assert.equal(h.calls.length, 2);
  await h.succeed(1);
});

test("save failure retains the latest draft and permits explicit retry without looping", async (t) => {
  const h = setup(t);
  h.controller.patch({ llm_model: "first-model", llm_api_key: "first-key" });
  await h.tick(800);
  h.controller.patch({ llm_model: "latest-model", llm_api_key: "latest-key" });
  await h.tick(800);
  const failure = new Error("Service unavailable");
  h.calls[0].reject(failure);
  await settle();
  assert.equal(h.draft().llm_model, "latest-model");
  assert.equal(h.draft().llm_api_key, "latest-key");
  assert.equal(h.controller.isDirty(), true);
  assert.equal(h.states.at(-1), "error");
  assert.deepEqual(h.errors, [failure]);
  await h.tick(100_000);
  assert.equal(h.calls.length, 1, "A failed save must not retry indefinitely");
  const retry = h.controller.flush();
  await settle();
  assert.deepEqual(h.calls[1].patch, { llm_model: "latest-model", llm_api_key: "latest-key" });
  await h.succeed(1, { llm_api_key_masked: "latest-key-mask" });
  await retry;
  assert.equal(h.draft().llm_api_key, "");
  assert.equal(h.controller.isDirty(), false);
  assert.equal(h.states.at(-1), "saved");
});

test("an omitted empty secret payload normalizes the draft without an error or dirty state", async (t) => {
  const h = setup(t);
  h.controller.patch({ llm_api_key: "   " });
  await h.tick(800);
  assert.deepEqual(h.calls[0].patch, { llm_api_key: "   " });
  // 接入层会省略空白密钥，空 payload 以 null 表示无需提交 HTTP 请求。
  h.calls[0].resolve(null);
  await settle();
  assert.deepEqual(h.draft(), toDraft(defaults));
  assert.deepEqual(h.errors, []);
  assert.equal(h.controller.isDirty(), false);
  assert.equal(h.states.at(-1), "saved");
  await h.tick(10_000);
  await h.controller.flush();
  assert.equal(h.calls.length, 1);
});

test("acceptSaved refreshes untouched fields while preserving unsaved edits", async (t) => {
  const h = setup(t);
  h.controller.patch({ llm_model: "local-model", llm_api_key: "local-key" });
  h.controller.acceptSaved({ ...defaults, llm_model: "remote-model", agent_max_steps: 24 });
  assert.equal(h.draft().llm_model, "local-model");
  assert.equal(h.draft().llm_api_key, "local-key");
  assert.equal(h.draft().agent_max_steps, 24);
  await h.tick(800);
  assert.deepEqual(h.calls[0].patch, { llm_model: "local-model", llm_api_key: "local-key" });
  assert.equal(h.calls[0].source.agent_max_steps, 24);
  await h.succeed(0);
});

test("external updates received during a save survive its older response", async (t) => {
  const h = setup(t);
  h.controller.patch({ llm_model: "local-model" });
  await h.tick(800);
  h.controller.acceptSaved({ ...defaults, agent_max_steps: 32 });
  assert.equal(h.draft().llm_model, "local-model");
  assert.equal(h.draft().agent_max_steps, 32);
  await h.succeed(0, { agent_max_steps: defaults.agent_max_steps });
  assert.equal(h.draft().llm_model, "local-model");
  assert.equal(h.draft().agent_max_steps, 32);
  assert.equal(h.saved.at(-1).agent_max_steps, 32);
});

test("OAuth completion updates its auth fields while retaining unrelated dirty fields", async (t) => {
  const h = setup(t);
  h.controller.patch({ llm_model: "local-model", llm_api_key: "local-key" });
  h.controller.acceptSavedPatch({ llm_auth_mode: "codex_oauth", llm_api_key_masked: "oauth-mask" }, ["llm_api_key"]);
  assert.equal(h.draft().llm_auth_mode, "codex_oauth");
  assert.equal(h.draft().llm_model, "local-model");
  assert.equal(h.draft().llm_api_key, "");
  await h.tick(800);
  assert.deepEqual(h.calls[0].patch, { llm_model: "local-model" });
  assert.equal(h.calls[0].source.llm_auth_mode, "codex_oauth");
  await h.succeed(0);
});

test("OAuth completion repairs a conflicting auth update already in flight", async (t) => {
  const h = setup(t, { llm_auth_mode: "codex_oauth" });
  h.controller.patch({ llm_auth_mode: "api_key" });
  await settle();
  h.controller.patch({ llm_model: "local-model" });
  h.controller.acceptSavedPatch({ llm_auth_mode: "codex_oauth" }, ["llm_auth_mode"]);
  assert.equal(h.draft().llm_auth_mode, "codex_oauth");
  await h.tick(800);
  assert.equal(h.calls.length, 1);
  await h.succeed(0, { llm_auth_mode: "api_key" });
  assert.equal(h.draft().llm_auth_mode, "codex_oauth");
  assert.ok(h.saved.every((config) => config.llm_auth_mode === "codex_oauth"), "Saved state must never revert to the stale auth mode");
  assert.deepEqual(h.calls[1].patch, { llm_model: "local-model", llm_auth_mode: "codex_oauth" });
  await h.succeed(1);
  assert.equal(h.saved.at(-1).llm_auth_mode, "codex_oauth");
});

test("composition suppresses debounce and explicit flush until Chinese input is complete", async (t) => {
  const h = setup(t);
  h.controller.patch({ llm_model: "before-composition" });
  await h.tick(400);
  h.controller.compositionStart();
  h.controller.patch({ llm_model: "投" });
  await h.tick(10_000);
  await h.controller.flush();
  assert.equal(h.calls.length, 0);
  h.controller.patch({ llm_model: "投研模型" });
  h.controller.compositionEnd();
  await h.tick(799);
  assert.equal(h.calls.length, 0);
  await h.tick(1);
  assert.deepEqual(h.calls[0].patch, { llm_model: "投研模型" });
  await h.succeed(0);
});

test("dispose cancels pending timers and ignores later edits", async (t) => {
  const h = setup(t);
  h.controller.patch({ llm_model: "pending-model" });
  h.controller.dispose();
  const count = h.drafts.length;
  h.controller.patch({ memory_enabled: true });
  h.controller.acceptSaved({ ...defaults, llm_model: "external-model" });
  await h.tick(10_000);
  await h.controller.flush();
  assert.equal(h.calls.length, 0);
  assert.equal(h.drafts.length, count);
});

test("dispose before an immediate save starts prevents persist from running", async (t) => {
  const h = setup(t);
  h.controller.patch({ memory_enabled: true });
  h.controller.dispose();
  const counts = [h.drafts.length, h.saved.length, h.states.length, h.errors.length];
  await settle();
  await h.tick(10_000);
  assert.equal(h.calls.length, 0);
  assert.deepEqual([h.drafts.length, h.saved.length, h.states.length, h.errors.length], counts);
});

test("dispose ignores late responses and does not drain queued requests", async (t) => {
  const h = setup(t);
  h.controller.patch({ llm_model: "first-model" });
  await h.tick(800);
  h.controller.patch({ llm_model: "queued-model" });
  await h.tick(800);
  h.controller.dispose();
  const counts = [h.drafts.length, h.saved.length, h.states.length, h.errors.length];
  await h.succeed(0);
  await h.tick(10_000);
  assert.deepEqual([h.drafts.length, h.saved.length, h.states.length, h.errors.length], counts);
  assert.equal(h.calls.length, 1);
});

test("canSave prevents requests while retaining pending changes for a later flush", async (t) => {
  let permitted = false;
  const h = setup(t, {}, { canSave: () => permitted });
  h.controller.patch({ llm_model: "pending-model" });
  await h.tick(800);
  assert.equal(h.calls.length, 0);
  assert.equal(h.controller.isDirty(), true);
  permitted = true;
  const flushed = h.controller.flush();
  await settle();
  assert.deepEqual(h.calls[0].patch, { llm_model: "pending-model" });
  await h.succeed(0);
  await flushed;
});
