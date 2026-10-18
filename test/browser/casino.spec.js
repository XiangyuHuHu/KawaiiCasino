import { test, expect } from "@playwright/test";
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
