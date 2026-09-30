import assert from "node:assert/strict";

// Exercise the built UI with long fixture content. Never let locator auto-scrolling
// make a clipped, non-scrollable region look usable (overflow:hidden allows it).
async function visibleAtEnd(container, target) {
  await container.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await target.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2));
    const y = Math.min(innerHeight - 1, rect.bottom - 2);
    if (rect.bottom > innerHeight + 1 || rect.bottom <= 0 || !element.contains(document.elementFromPoint(x, y))) {
      throw new Error(`Content cannot be reached by scrolling: ${element.textContent?.slice(0, 80)}`);
    }
  });
}

async function swipe(cdp, x, y, dx, dy) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 12; step++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * step / 12, y: y + dy * step / 12 }] });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function assertWithinViewport(locator) {
  assert.ok(await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.left >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1;
  }), "Modal must stay inside the viewport, independent of the page's scroll position");
}

export async function checkMobileScroll(page, { origin, config }) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  const main = page.locator("#main-content");
  const originalServers = config.mcp_servers;
  const serverName = "fixture-long-server-name-for-wrapped-tools-header";
  const tools = Array.from({ length: 30 }, (_, i) => ({ name: `scroll_tool_${i}`, description: "Fixture tool description ".repeat(5), parameters: {} }));
  const skill = { slug: "scroll-preview", name: "Scroll preview", summary: "Fixture summary ".repeat(20), owner: "fixture", version: "1.0", scan: {}, skill_md: "# Fixture skill\n" + "Scrollable skill content\n".repeat(100) + "END OF SKILL", canonical_url: "https://example.invalid/skill" };
  const fixtures = {
    "/api/v1/mcp/status": { servers: [{ name: serverName, status: "connected", enabled: true, tools_count: tools.length }], total: 1 },
    [`/api/v1/mcp/${serverName}/tools`]: { server_name: serverName, tools, total: tools.length },
    "/api/v1/skills/refresh": { status: "ok", total: 20 },
    "/api/v1/skills": { skills: Array.from({ length: 20 }, (_, i) => ({ name: `Scroll skill ${i}`, description: "Long installed skill list", enabled: true, source: "builtin" })), total: 20 },
    "/api/v1/skills/clawhub/search": { results: [skill], total: 1 },
    "/api/v1/skills/clawhub/scroll-preview": skill,
    "/api/v1/memory/status": { chunks: 20, files: 20, workspace: "/fixture", embedding_enabled: false, search_mode: "fts" },
    "/api/v1/memory/files": { files: Array.from({ length: 20 }, (_, i) => ({ path: `scroll-memory-${i}.md`, size: 20, modified: 1780000000 })) },
  };
  const fixtureRoute = async (route) => {
    const fixture = fixtures[new URL(route.request().url()).pathname];
    if (!fixture) return route.fallback();
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(fixture) });
  };
  await page.route("**/api/**", fixtureRoute);
  config.mcp_servers = { [serverName]: { transport: "streamable_http", url: "https://example.invalid/mcp", enabled: true } };
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/settings`);
      await page.getByRole("tab", { name: "模型", exact: true }).click();
      await page.getByRole("textbox", { name: "LLM Model", exact: true }).waitFor();
      assert.ok(await main.evaluate((element) => element.scrollHeight > element.clientHeight), `Settings must scroll at ${viewport.width}×${viewport.height}`);
      await main.evaluate((element) => { element.scrollTop = 0; });
      await swipe(cdp, viewport.width - 8, viewport.height - 40, 0, -180);
      await page.waitForFunction(() => document.querySelector("#main-content").scrollTop > 20);
      const tabs = page.locator('#config-form [role="tab"]');
      const tabCount = await tabs.count();
      for (let index = 0; index < tabCount; index++) {
        await main.evaluate((element) => { element.scrollTop = 0; });
        await tabs.nth(index).click();
        const panel = page.locator('#config-form [role="tabpanel"][data-state="active"]');
        await panel.waitFor();
        // Check the bottom of the actual content, including explanatory text after inputs.
        await visibleAtEnd(main, panel.locator(":scope > :last-child"));
        assert.ok(await main.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), "Settings must not overflow horizontally");
      }
      if (viewport.width === 390) {
        await main.evaluate((element) => { element.scrollTop = 0; });
        const tabList = page.locator('#config-form [role="tablist"]');
        await tabList.evaluate((element) => { element.scrollLeft = 0; });
        const box = await tabList.boundingBox();
        await swipe(cdp, box.x + box.width - 20, box.y + box.height / 2, -220, 0);
        await page.waitForFunction(() => document.querySelector('#config-form [role="tablist"]').scrollLeft > 20);
        await page.screenshot({ path: "/tmp/stocks-settings-scroll-mobile.png" });
      }
    }

    // Existing drawers must retain their own scrolling in a short landscape viewport.
    await page.setViewportSize({ width: 667, height: 375 });
    await page.goto(`${origin}/settings`);
    await page.getByRole("tab", { name: "账号安全", exact: true }).click();
    await page.getByRole("button", { name: "修改密码", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await assertWithinViewport(dialog);
    await visibleAtEnd(dialog.locator(".sheet-scroll-edge"), dialog.locator("form > :last-child"));
    await assertWithinViewport(dialog.locator(".sheet-footer"));
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await page.goto(`${origin}/scheduler`);
    await page.getByRole("button", { name: "Add Task", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await assertWithinViewport(dialog);
    await visibleAtEnd(dialog.locator(".sheet-scroll-edge"), dialog.locator("form > :last-child"));
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/memory`);
    await page.getByText("scroll-memory-19.md", { exact: true }).waitFor();
    await visibleAtEnd(main, page.getByText("scroll-memory-19.md", { exact: true }));
    await page.goto(`${origin}/knowledge`);
    await page.getByText("Fixture note", { exact: true }).click();
    await page.getByText("Knowledge is retained", { exact: true }).waitFor();
    await visibleAtEnd(main, page.getByText("Knowledge is retained", { exact: true }));
    await page.goto(`${origin}/portfolio`);
    await page.getByRole("button", { name: "图表", exact: true }).click();
    await page.getByRole("group", { name: "资产快照图，左右方向键查看各日期" }).waitFor();
    await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    assert.ok(await main.evaluate((element) => element.scrollTop > 0), "Portfolio charts must remain scrollable");

    for (const viewport of [{ width: 390, height: 844 }, { width: 667, height: 375 }, { width: 1440, height: 1000 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/mcp`);
      const trigger = page.getByRole("button", { name: "查看工具", exact: true });
      await trigger.click();
      dialog = page.getByRole("dialog");
      await dialog.getByText("scroll_tool_29", { exact: true }).waitFor();
      await assertWithinViewport(dialog);
      await visibleAtEnd(dialog.locator(".overflow-y-auto"), dialog.getByText("scroll_tool_29", { exact: true }));
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.ok(await trigger.evaluate((element) => document.activeElement === element), "Closing tools must restore focus");

      await page.goto(`${origin}/skills`);
      await page.getByText("Scroll skill 19", { exact: true }).waitFor();
      await page.getByPlaceholder("搜索技能，例如 research、browser、python").fill("scroll");
      await page.getByRole("button", { name: "搜索", exact: true }).click();
      await page.getByRole("button", { name: "详情预览", exact: true }).click();
      dialog = page.getByRole("dialog");
      await dialog.getByText("Scroll preview", { exact: true }).waitFor();
      await assertWithinViewport(dialog);
      const preview = dialog.locator("pre").last();
      await visibleAtEnd(dialog.locator(".overflow-y-auto"), preview);
      await preview.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      assert.ok(await preview.evaluate((element) => element.scrollTop > 0), "Long skill source must scroll independently");
      await assertWithinViewport(dialog.getByRole("button", { name: "关闭", exact: true }));
      await page.screenshot({ path: `/tmp/stocks-skill-scroll-${viewport.width}.png` });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    }
    // Rotation back to desktop keeps content scrolling inside the settings pane.
    await page.goto(`${origin}/settings`);
    await page.getByRole("tab", { name: "模型", exact: true }).click();
    const pane = page.locator("#config-form aside + div");
    await visibleAtEnd(pane, page.locator('#config-form [role="tabpanel"][data-state="active"] > :last-child'));
    assert.equal(await main.evaluate((element) => element.scrollTop), 0);
  } finally {
    config.mcp_servers = originalServers;
    await page.unroute("**/api/**", fixtureRoute);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.detach();
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}
