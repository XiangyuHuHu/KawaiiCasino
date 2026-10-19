import { test, expect } from "@playwright/test";

test("只有自己入座时只渲染一个本人座位", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-command="create"]').first().click();
  await page.getByLabel("你的昵称").fill("只有一个我");
  await page.locator("#room-submit").click();
  await expect(page.locator("#room-dialog")).not.toBeVisible();
  await expect(page.locator(".seat.me")).toHaveCount(1);
  await expect(page.locator(".empty-seat")).toHaveCount(7);
  await expect(
    page.locator(".seat-name").filter({ hasText: "只有一个我" }),
  ).toHaveCount(1);
});

for (const [gameType, name, seats, selector] of [
  ["poker", "德州扑克", 8, ".seat"],
  ["blackjack", "21点", 5, ".bj-seat"],
  ["doudizhu", "斗地主", 3, ".ddz-seat"],
  ["mahjong", "麻将", 4, ".mj-seat"],
  ["guandan", "掼蛋", 4, ".gd-seat"],
  ["roulette", "轮盘", 8, ".rl-seat"],
])
  test(`${name}：更多游戏入口、自动补满机器人、刷新恢复`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "更多游戏" }).click();
    await expect(page.locator("[data-pick-game]")).toHaveCount(6);
    await page.locator(`[data-pick-game="${gameType}"]`).click();
    await expect(page.locator("#game-select")).toHaveValue(gameType);
    await page.getByLabel("你的昵称").fill("快乐单人");
    await page.locator("#room-submit").click();
    await expect(page.locator("#room-dialog")).not.toBeVisible();
    await expect(page.locator("#room-label")).toContainText(
      `${name} · 单人娱乐`,
    );
    await expect(page.locator("#players-value")).toHaveText(
      `${seats} / ${seats}`,
    );
    await expect(page.locator(`${selector}.me`)).toHaveCount(1);
    await expect(
      page.locator("#seats .seat-name").filter({ hasText: "BOT" }),
    ).toHaveCount(seats - 1);
    await expect(page.locator("#stage-label")).not.toHaveText("等待开局");
    await expect(page.locator("#invite-button")).not.toBeVisible();
    await page.reload();
    await expect(page.locator("#room-label")).toContainText("单人娱乐");
    await expect(page.locator(`${selector}.me`)).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });

test("入座开玩默认选择单人娱乐", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "入座开玩" }).click();
  await expect(page.locator("#dialog-title")).toHaveText(
    "自己玩，搭子已就位。",
  );
  await page.getByLabel("你的昵称").fill("一键开玩");
  await page.locator("#room-submit").click();
  await expect(page.locator("#room-label")).toContainText("单人娱乐");
  await expect(page.locator(".seat.me")).toHaveCount(1);
  await expect(page.locator(".bot-tag")).toHaveCount(7);
});
