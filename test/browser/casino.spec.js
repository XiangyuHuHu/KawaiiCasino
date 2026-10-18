import { test, expect } from "@playwright/test";
import { createCasino } from "../../server/index.js";
test("两位真实玩家入座、聊天、防注入、完成对局并刷新恢复", async ({
  browser,
}) => {
  const a = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    b = await browser.newPage();
  const errors = [];
  a.on("pageerror", (e) => errors.push(e.message));
  b.on("pageerror", (e) => errors.push(e.message));
  await a.goto("/");
  await a
    .getByRole("button", { name: "创建房间", exact: false })
    .first()
    .click();
  await a.getByLabel("你的昵称").fill("小狐狸");
  await a.locator("#room-submit").click();
  await expect(a.locator("#room-dialog")).not.toBeVisible();
  const code = new URL(a.url()).searchParams.get("room");
  expect(code).toMatch(/^\d{6}$/);
  await b.goto(`/?room=${code}`);
  await b.getByLabel("你的昵称").fill("小猫咪");
  await b.locator("#room-submit").click();
  await expect(b.locator("#room-dialog")).not.toBeVisible();
  await expect(b.locator("#players-value")).toHaveText("2 / 8");
  await expect(a.locator("#players-value")).toHaveText("2 / 8");
  await b.getByLabel("聊天消息").fill("<img src=x onerror=alert(1)>你好！");
  await expect(b.getByLabel("聊天消息")).toHaveValue(
    "<img src=x onerror=alert(1)>你好！",
  );
  await b.getByRole("button", { name: "发送消息" }).click();
  await expect(b.getByLabel("聊天消息")).toHaveValue("");
  await expect(a.locator(".message p")).toHaveText(
    "<img src=x onerror=alert(1)>你好！",
  );
  await expect(a.locator(".message img")).toHaveCount(0);
  await a.getByRole("button", { name: "开始发牌" }).click();
  await expect(a.locator(".seat.me .card")).toHaveCount(2);
  await expect(b.locator(".seat.me .card")).toHaveCount(2);
  await expect(a.locator(".seat:not(.me) .card.back")).toHaveCount(2);
  await a.reload();
  await expect(a.locator("#players-value")).toHaveText("2 / 8");
  await expect(a.locator(".seat.me .card")).toHaveCount(2);
  for (let step = 0; step < 12; step++) {
    if ((await a.locator("#stage-label").textContent()) === "本手结束") break;
    await expect
      .poll(
        async () =>
          (await a
            .locator('[data-action="call"],[data-action="check"]')
            .count()) +
          (await b
            .locator('[data-action="call"],[data-action="check"]')
            .count()),
      )
      .toBeGreaterThan(0);
    const active = (await a
      .locator('[data-action="call"],[data-action="check"]')
      .count())
      ? a
      : b;
    const version = await active
      .locator("#table-scene")
      .getAttribute("data-version");
    await active.locator('[data-action="call"],[data-action="check"]').click();
    await expect
      .poll(() => active.locator("#table-scene").getAttribute("data-version"))
      .not.toBe(version);
    const updated = await active
      .locator("#table-scene")
      .getAttribute("data-version");
    await expect(a.locator("#table-scene")).toHaveAttribute(
      "data-version",
      updated,
    );
    await expect(b.locator("#table-scene")).toHaveAttribute(
      "data-version",
      updated,
    );
  }
  await expect(a.locator("#stage-label")).toHaveText("本手结束");
  await expect(a.locator(".community-cards .card:not(.empty)")).toHaveCount(5);
  await expect(a.locator(".result-banner")).toBeVisible();
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});
test("手机牌桌无横向溢出，单人练习可玩", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.locator('[data-command="create"]').first().click();
  await page.getByLabel("你的昵称").fill("手机玩家");
  await page.locator("#room-submit").click();
  await page.getByRole("button", { name: "练习伙伴" }).click();
  await expect(page.locator("#players-value")).toHaveText("4 / 8");
  await page.getByRole("button", { name: "开始发牌" }).click();
  await expect(page.locator(".seat.me .card")).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "test-results/mobile-table.png",
    fullPage: true,
  });
});

test("21点：手机建房选游戏、单人下注停牌、结算和刷新恢复", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.locator('[data-command="create"]').first().click();
  await page.getByLabel("你的昵称").fill("21点玩家");
  await page.getByLabel("选择游戏").selectOption("blackjack");
  await expect(page.locator("#blind-fields")).not.toBeVisible();
  await page.locator("#room-submit").click();
  await expect(page.locator("#room-label")).toContainText("21点");
  await expect(page.locator("#players-value")).toHaveText("1 / 5");
  await page.getByRole("button", { name: "开始发牌" }).click();
  await page.getByLabel("21点下注金额").fill("11");
  await page.locator('[data-action="bet"]').click();
  // A natural hand settles without a player turn.
  await expect
    .poll(
      async () =>
        (await page.locator('[data-action="stand"]').count()) > 0 ||
        (await page.locator("#stage-label").textContent()) === "本手结束",
    )
    .toBe(true);
  if (await page.locator('[data-action="stand"]').count()) {
    await expect(page.locator("#board-area .card.back")).toHaveCount(1);
    await page.locator('[data-action="stand"]').click();
  }
  await expect(page.locator("#stage-label")).toHaveText("本手结束");
  await expect(page.locator(".bj-outcome")).toContainText("净");
  await expect(page.locator("#board-area .card.back")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#room-label")).toContainText("21点");
  await expect(page.locator(".bj-outcome")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.getByRole("button", { name: "游戏规则" }).click();
  await expect(page.locator("#blackjack-rules-dialog")).toBeVisible();
  expect(errors).toEqual([]);
});

test("斗地主：手机选游戏、添加两位伙伴、点击选牌并完成结算", async ({
  page,
}) => {
  test.setTimeout(60000);
  const casino = createCasino({ botDelay: 20, tickInterval: 10 });
  await new Promise((resolve) => casino.server.listen(0, "127.0.0.1", resolve));
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${casino.server.address().port}/`);
    await page.locator('[data-command="create"]').first().click();
    await page.getByLabel("你的昵称").fill("斗地主玩家");
    await page.getByLabel("选择游戏").selectOption("doudizhu");
    await expect(page.locator("#blind-fields")).not.toBeVisible();
    await page.locator("#room-submit").click();
    await expect(page.locator("#room-label")).toContainText("斗地主");
    await expect(page.getByRole("button", { name: "开始发牌" })).toBeDisabled();
    await page.getByRole("button", { name: "练习伙伴" }).click();
    await expect(page.locator("#players-value")).toHaveText("3 / 3");
    casino.rooms.values().next().value.table.nextFirstBidder = 0;
    await page.getByRole("button", { name: "开始发牌" }).click();
    await expect(page.locator(".ddz-seat.me .ddz-card")).toHaveCount(17);
    await expect(page.locator(".ddz-seat:not(.me) .card.back")).toHaveCount(2);
    let selectedAndPlayed = false;
    for (let step = 0; step < 200; step++) {
      await expect
        .poll(
          async () =>
            (await page.locator('[data-action="assist"]').count()) > 0 ||
            (await page.locator("#stage-label").textContent()) === "本手结束",
          { timeout: 15000 },
        )
        .toBe(true);
      if ((await page.locator("#stage-label").textContent()) === "本手结束")
        break;
      const version = await page
        .locator("#table-scene")
        .getAttribute("data-version");
      if (await page.locator('[data-bid="3"]').count()) {
        await page.locator('[data-bid="3"]').click();
      } else if (
        (await page.locator('[data-action="play"]').count()) &&
        (await page.locator('[data-action="pass"]').isDisabled())
      ) {
        expect(
          await page.locator(".ddz-card").evaluateAll((buttons) => {
            const scene = document
              .querySelector("#table-scene")
              .getBoundingClientRect();
            return buttons.every((button) => {
              const rect = button.getBoundingClientRect();
              return (
                rect.left >= scene.left &&
                rect.right <= scene.right &&
                rect.top >= scene.top &&
                rect.bottom <= scene.bottom
              );
            });
          }),
        ).toBe(true);
        if (!selectedAndPlayed)
          await page.screenshot({
            path: "test-results/doudizhu-mobile.png",
            fullPage: true,
          });
        const first = page.locator(".ddz-card").first();
        await first.click();
        await expect(first).toHaveAttribute("aria-pressed", "true");
        await page.locator('[data-action="play"]').click();
        selectedAndPlayed = true;
      } else {
        await page.locator('[data-action="assist"]').click();
      }
      await expect(page.locator("#table-scene")).not.toHaveAttribute(
        "data-version",
        version,
      );
    }
    await expect(page.locator("#stage-label")).toHaveText("本手结束");
    expect(selectedAndPlayed).toBe(true);
    await expect(page.locator(".result-banner")).toContainText("获胜");
    await expect(page.locator(".result-banner")).toContainText("每份");
    await expect(page.locator(".ddz-seat:not(.me) .card.back")).toHaveCount(0);
    const stacks = await page
      .locator(".ddz-seat .seat-stack")
      .allTextContents();
    expect(
      stacks.reduce(
        (sum, text) =>
          sum + Number(text.match(/◈ ([\d,]+)/)[1].replaceAll(",", "")),
        0,
      ),
    ).toBe(30000);
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.reload();
    await expect(page.locator(".result-banner")).toContainText("获胜");
    await page.getByRole("button", { name: "游戏规则" }).click();
    await expect(page.locator("#doudizhu-rules-dialog")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await new Promise((resolve) => casino.io.close(resolve));
  }
});
