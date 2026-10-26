import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCasino } from "../../server/index.js";

test("模拟换Wi-Fi：打开的邀请弹窗自动更新IP，复制时重新查询，房间不重启", async ({
  browser,
}) => {
  const directory = await mkdtemp(join(tmpdir(), "kawaii-lan-browser-")),
    file = join(directory, "addresses.json");
  const update = (addresses, updatedAt = Date.now()) =>
    writeFile(file, JSON.stringify({ addresses, updatedAt }));
  await update(["http://192.0.2.10:4399"]);
  const casino = createCasino({ hostAddressesFile: file });
  await new Promise((resolve) => casino.server.listen(0, "127.0.0.1", resolve));
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  try {
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${casino.server.address().port}`);
    await page.locator('[data-command="create"]').first().click();
    await page.getByLabel("你的昵称").fill("动态地址测试");
    await page.locator("#room-submit").click();
    await expect(page.locator("#room-dialog")).not.toBeVisible();
    const code = new URL(page.url()).searchParams.get("room"),
      originalRoom = casino.rooms.get(code);
    await page.locator("#invite-button").click();
    await expect(page.locator("#invite-details a")).toHaveAttribute(
      "href",
      `http://192.0.2.10:4399/?room=${code}`,
    );
    await update(["http://198.51.100.20:4399"]);
    await expect(page.locator("#invite-details a")).toHaveAttribute(
      "href",
      `http://198.51.100.20:4399/?room=${code}`,
      { timeout: 7000 },
    );
    await update(["http://203.0.113.30:4399"]);
    await page.locator("#copy-invite").click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(`http://203.0.113.30:4399/?room=${code}`);
    await update(["http://192.0.2.10:4399"], Date.now() - 31000);
    await expect(page.locator("#invite-details")).toContainText("同步已停止", {
      timeout: 7000,
    });
    await expect(page.locator("#copy-invite")).toBeDisabled();
    await expect(page.locator("#invite-details a")).toHaveCount(0);
    await update([]);
    await expect(page.locator("#invite-details")).toContainText(
      "暂未连接局域网",
      { timeout: 7000 },
    );
    await update(["http://203.0.113.40:4399"]);
    await expect(page.locator("#copy-invite")).toBeEnabled({ timeout: 7000 });
    expect(casino.rooms.get(code)).toBe(originalRoom);
    expect(originalRoom.table.players.length).toBe(1);
  } finally {
    await context.close();
    await new Promise((resolve) => casino.io.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
