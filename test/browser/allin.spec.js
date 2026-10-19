import { test, expect } from "@playwright/test";

test("德州全下按钮显示剩余筹码，手机点击后双方全下自动摊牌", async ({
  browser,
}) => {
  const a = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const b = await browser.newPage();
  try {
    await a.goto("/");
    await a.locator('[data-command="create"]').first().click();
    await a.getByLabel("你的昵称").fill("全下玩家");
    await a.locator("#room-submit").click();
    await expect(a.locator("#room-dialog")).not.toBeVisible();
    const code = new URL(a.url()).searchParams.get("room");
    await b.goto(`/?room=${code}`);
    await b.getByLabel("你的昵称").fill("跟注玩家");
    await b.locator("#room-submit").click();
    await expect(a.locator("#players-value")).toHaveText("2 / 8");
    const openingTotal =
      Number(
        (await a.locator("#stack-value").innerText()).replaceAll(",", ""),
      ) * 2;
    await a.getByRole("button", { name: "开始发牌" }).click();
    const allin = a.getByRole("button", { name: /ALL-IN \/ 全下/ });
    await expect(allin).toBeEnabled();
    const remaining = await a.locator("#stack-value").innerText();
    await expect(allin.locator("small")).toHaveText(`◈ ${remaining}`);
    expect(
      await a.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await a.screenshot({
      path: "test-results/poker-allin-mobile.png",
      fullPage: true,
    });
    await allin.click();
    await expect(a.locator(".seat.me .seat-stack")).toHaveText("0");
    await expect(a.locator(".seat.me .seat-status")).toHaveText("全下");
    await b.getByRole("button", { name: /ALL-IN \/ 全下/ }).click();
    await expect(a.locator("#stage-label")).toHaveText("本手结束");
    await expect(a.locator(".community-cards .card:not(.empty)")).toHaveCount(
      5,
    );
    const finalStacks = await a.locator(".seat-stack").allTextContents();
    expect(
      finalStacks.reduce(
        (sum, text) => sum + Number(text.replaceAll(",", "")),
        0,
      ),
    ).toBe(openingTotal);
  } finally {
    await a.close();
    await b.close();
  }
});
