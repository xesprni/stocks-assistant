import assert from "node:assert/strict";

async function visibleBounds(locator, viewport) {
  const rect = await locator.boundingBox();
  assert.ok(rect && rect.width > 0 && rect.height > 0, "Control must be visible");
  assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1, "Control must remain inside the viewport without auto-scrolling");
  return rect;
}

export async function checkMobileChat(page, { origin, session }) {
  const savedSession = structuredClone(session);
  Object.assign(session, {
    message_count: 12,
    messages: Array.from({ length: 12 }, (_, index) => ({
      id: `mobile-message-${index}`, role: index % 2 ? "assistant" : "user",
      content: index % 2 ? `Mobile fixture reply ${index}\n\n${"Readable conversation content. ".repeat(12)}` : "Mobile fixture question",
      created_at: session.created_at,
    })),
  });
  try {
    const viewports = [
      { width: 390, height: 844 }, { width: 320, height: 568 },
      { width: 844, height: 390 }, { width: 667, height: 375 },
      { width: 568, height: 320 }, { width: 1024, height: 768 },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto(`${origin}/dashboard`);
      await page.getByRole("button", { name: "搜索或提问", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "搜索或提问", exact: true });
      await dialog.getByText("Mobile fixture reply 11", { exact: false }).waitFor();
      // Reduced-motion sheets still settle on the next frame.
      await page.waitForFunction(() => {
        const panel = document.querySelector(".dashboard-chat-drawer");
        return panel && Math.abs(panel.getBoundingClientRect().bottom - innerHeight) < 2;
      });
      await visibleBounds(dialog, viewport);
      const messages = dialog.locator(".chat-messages");
      const collapsed = await visibleBounds(messages, viewport);
      assert.ok(collapsed.height >= viewport.height * 0.5, "Collapsed composer must leave at least half the screen for reading");
      const input = dialog.getByRole("textbox", { name: "打开提问输入框", exact: true });
      assert.equal(await input.isVisible(), false);
      await dialog.getByRole("button", { name: "打开提问输入框", exact: true }).click();
      await input.fill("Draft survives collapse and rotation");
      await visibleBounds(input, viewport);
      await visibleBounds(dialog.getByRole("button", { name: "发送", exact: true }), viewport);
      const expanded = await visibleBounds(messages, viewport);
      assert.ok(expanded.height >= 100, "Even the smallest landscape must retain usable conversation space");
      await dialog.getByRole("button", { name: "收起输入框", exact: true }).click();
      assert.equal(await input.isVisible(), false);
      assert.match(await dialog.getByRole("button", { name: "打开提问输入框", exact: true }).innerText(), /Draft survives/);
      assert.ok((await messages.boundingBox()).height > expanded.height, "Collapsing must return the input's space to messages");
      await dialog.getByRole("button", { name: "打开提问输入框", exact: true }).click();
      assert.equal(await input.inputValue(), "Draft survives collapse and rotation");
      await input.press("Escape");
      assert.ok(await dialog.isVisible(), "Escape from the input collapses it without dismissing the chat");
      await dialog.getByRole("button", { name: "历史", exact: true }).click();
      await visibleBounds(dialog.locator(".chat-history-menu"), viewport);
      await dialog.getByRole("button", { name: "历史", exact: true }).click();
      await page.screenshot({ path: `/tmp/stocks-chat-${viewport.width}.png` });
      await dialog.getByRole("button", { name: "关闭 AI 抽屉", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
    }
    // Rotate while editing, then send through the real chat controller and fixture stream.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "搜索或提问", exact: true }).click();
    const input = page.getByRole("textbox", { name: "打开提问输入框", exact: true });
    await input.fill("Mobile rotated submission");
    await page.setViewportSize({ width: 844, height: 390 });
    assert.equal(await input.inputValue(), "Mobile rotated submission");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await page.getByText("Fixture reply", { exact: true }).waitFor();
    assert.equal(await input.isVisible(), false, "Sending must return mobile chat to reading mode");
    await page.getByRole("button", { name: "关闭 AI 抽屉", exact: true }).click();
  } finally {
    Object.assign(session, savedSession);
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
}
