import { test, expect } from "@playwright/test";
import { createCasino } from "../../server/index.js";

test("导航计算器：介绍、完整三游戏计算、导出和手机布局", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#calculator-button").click();
  await expect(page.locator("#calculator-intro")).toContainText("120万");
  await page.locator('[data-calculator-tab="manual"]').first().click();
  const frame = page.frameLocator("#calculator-frame");
  await expect(frame.locator("#calculation-status")).toContainText("计算完成");
  await expect(frame.locator("#results")).toContainText("48.65%");
  const downloadPromise = page.waitForEvent("download");
  await frame.locator("#export").click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.json$/);
  await frame.locator("#tab-blackjack").click();
  await frame.locator("#form-blackjack summary").click();
  await frame
    .locator('#form-blackjack [name="model"]')
    .selectOption("infinite");
  await frame.locator("#calculate").click();
  await expect(frame.locator("#method-badge")).toHaveText("无限牌靴模型");
  await expect(frame.locator("#results")).toContainText("停牌");
  await frame.locator("#tab-poker").click();
  await frame.locator('#form-poker [name="hero"]').fill("As Ks");
  await frame.locator('#form-poker [name="board"]').fill("Qs Js Ts 2h 3d");
  await frame.locator('#form-poker [name="opponents"]').fill("?");
  await frame.locator("#calculate").click();
  await expect(frame.locator("#method-badge")).toHaveText("精确枚举");
  await expect(frame.locator("#results")).toContainText("100.00%");
  expect(
    await frame
      .locator("body")
      .evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("轮盘：手机实际下注结算和规则概率实时跟随投注", async ({ page }) => {
  const casino = createCasino({ botDelay: 10, tickInterval: 10 });
  await new Promise((r) => casino.server.listen(0, "127.0.0.1", r));
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`http://127.0.0.1:${casino.server.address().port}`);
    await page.locator("#more-games-button").click();
    await page.locator('[data-pick-game="roulette"]').click();
    await page.getByLabel("你的昵称").fill("转盘测试");
    await page.locator("#room-submit").click();
    await expect(page.locator("#probability-panel")).toContainText("48.6%");
    await page.locator("#roulette-bet-select").selectOption("straight");
    await page.locator("#roulette-numbers").fill("17");
    await expect(page.locator("#probability-panel")).toContainText("2.7%");
    await page.locator('[data-action="bet"]').click();
    await expect(page.locator("#stage-label")).toHaveText("本手结束");
    await expect(page.locator("#board-area")).toContainText("本局落点");
    await expect(page.locator("#probability-panel")).toContainText(
      "本局已结算",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/roulette-mobile.png",
      fullPage: true,
    });
  } finally {
    await new Promise((r) => casino.io.close(r));
  }
});

test("掼蛋风格切换保持27张牌，推荐只选牌；德州局内概率工作线程", async ({
  page,
}) => {
  const casino = createCasino({ botDelay: 10, tickInterval: 10 });
  await new Promise((r) => casino.server.listen(0, "127.0.0.1", r));
  try {
    await page.goto(`http://127.0.0.1:${casino.server.address().port}`);
    await page.locator("#more-games-button").click();
    await page.locator('[data-pick-game="guandan"]').click();
    await page.getByLabel("你的昵称").fill("整理测试");
    await page.locator("#room-submit").click();
    await expect(page.locator(".gd-card")).toHaveCount(27);
    for (const style of ["protect", "chains", "rank", "balanced"]) {
      await page.locator("#gd-sort").selectOption(style);
      await expect(page.locator(".gd-card")).toHaveCount(27);
    }
    await expect(page.locator("[data-gd-hint]")).toBeVisible();
    await page.locator("[data-gd-hint]").click();
    await expect(page.locator(".gd-card.selected").first()).toBeVisible();
    await expect(page.locator(".gd-card")).toHaveCount(27);
    await page.screenshot({
      path: "test-results/guandan-combinations.png",
      fullPage: true,
    });
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(`http://127.0.0.1:${casino.server.address().port}/`);
    await page.locator('[data-command="create"]').first().click();
    await page.getByLabel("你的昵称").fill("概率测试");
    await page.locator("#room-submit").click();
    await page.getByRole("button", { name: "练习伙伴" }).click();
    await page.getByRole("button", { name: "开始发牌" }).click();
    await expect(page.locator("#probability-panel")).toContainText("摊牌权益", {
      timeout: 15000,
    });
    await expect(page.locator("#probability-panel")).toContainText("均匀随机");
  } finally {
    await new Promise((r) => casino.io.close(r));
  }
});

test("21点局内概率：有限牌靴结果、显式切换近似与庄家暗牌隐藏", async ({
  page,
}) => {
  const casino = createCasino();
  await new Promise((r) => casino.server.listen(0, "127.0.0.1", r));
  try {
    await page.goto(`http://127.0.0.1:${casino.server.address().port}`);
    await page.locator('[data-command="create"]').first().click();
    await page.getByLabel("你的昵称").fill("21点概率");
    await page.getByLabel("选择游戏").selectOption("blackjack");
    await page.locator("#room-submit").click();
    await page.getByRole("button", { name: "开始发牌" }).click();
    const t = [...casino.rooms.values()][0].table;
    const c = (rank) => ({ rank, suit: "s" });
    t.cards = [c(10), c(6), c(6), c(10)];
    await page.locator('[data-action="bet"]').click();
    await expect(page.locator("#probability-panel")).toContainText(
      "净期望筹码",
      { timeout: 20000 },
    );
    await expect(page.locator("#board-area .card.back")).toHaveCount(1);
    await page.locator("#prob-model").selectOption("infinite");
    await expect(page.locator("#probability-panel")).toContainText(
      "无限牌靴近似 · 每次抽牌独立",
    );
  } finally {
    await new Promise((r) => casino.io.close(r));
  }
});
