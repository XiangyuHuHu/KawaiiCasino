import { test, expect } from "@playwright/test";
import { createCasino } from "../../server/index.js";

test("多人房间补齐机器人并空出一个座位", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-command="create"]').first().click();
  await page.getByLabel("你的昵称").fill("多人房主");
  await page.locator("#room-submit").click();
  await page.getByRole("button", { name: "练习伙伴" }).click();
  await expect(page.locator("#players-value")).toHaveText("4 / 8");
  await page.getByRole("button", { name: "补齐机器人" }).click();
  await expect(page.locator("#players-value")).toHaveText("8 / 8");
  await expect(page.getByRole("button", { name: "补齐机器人" })).toBeDisabled();
  await page.getByRole("button", { name: "－ 机器人" }).click();
  await expect(page.locator("#players-value")).toHaveText("7 / 8");
  await expect(page.locator(".seat.me")).toHaveCount(1);
});

test("手机麻将显示实体牌面、按玩家出牌记录并在刷新后恢复", async ({ page }) => {
  const casino = createCasino({ botDelay: 20, tickInterval: 10 });
  await new Promise((resolve) => casino.server.listen(0, "127.0.0.1", resolve));
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`http://127.0.0.1:${casino.server.address().port}`);
    await page.getByRole("button", { name: "更多游戏" }).click();
    await page.locator('[data-pick-game="mahjong"]').click();
    await page.getByLabel("你的昵称").fill("出牌记录测试");
    await page.locator("#room-submit").click();
    await expect(page.locator("#mahjong-records")).toBeVisible();
    await expect(page.locator(".mj-record-group")).toHaveCount(4);
    for (let i = 0; i < 8; i++) {
      await expect
        .poll(
          async () =>
            (await page.locator('[data-action="assist"]').count()) ||
            (await page.locator("#stage-label").textContent()) === "本手结束",
        )
        .toBeTruthy();
      if (
        (await page.locator("#mahjong-records .mj-discard").count()) > 2 ||
        (await page.locator("#stage-label").textContent()) === "本手结束"
      )
        break;
      const version = await page
        .locator("#table-scene")
        .getAttribute("data-version");
      await page.locator('[data-action="assist"]').click();
      await expect
        .poll(() => page.locator("#table-scene").getAttribute("data-version"))
        .not.toBe(version);
    }
    await expect
      .poll(() => page.locator("#mahjong-records .mj-discard").count())
      .toBeGreaterThan(0);
    await expect(
      page.locator(".mj-seat.me .mj-face, .mj-seat.me .mj-wan-mark").first(),
    ).toBeVisible();
    const oldCount = await page.locator("#mahjong-records .mj-discard").count();
    await page.getByText("按时间查看完整记录").click();
    await expect(page.locator(".mj-chronology li").first()).toContainText("#");
    await page.reload();
    await expect
      .poll(() => page.locator("#mahjong-records .mj-discard").count())
      .toBeGreaterThanOrEqual(oldCount);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: "test-results/mahjong-refreshed.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await new Promise((resolve) => casino.io.close(resolve));
  }
});
