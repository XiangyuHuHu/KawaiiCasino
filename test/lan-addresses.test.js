import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCasino } from "../server/index.js";
import { parseHostAddresses } from "../server/lan-addresses.js";

test("宿主机地址租约拒绝旧地址、容器回环地址和无效分享地址", () => {
  const now = Date.now();
  const read = (addresses, updatedAt = now) =>
    parseHostAddresses(JSON.stringify({ addresses, updatedAt }), now);
  assert.deepEqual(
    read(["http://192.0.2.1:4399", "http://192.0.2.1:4399/"]).addresses,
    ["http://192.0.2.1:4399"],
  );
  assert.equal(read([]).available, false);
  assert.throws(
    () => read(["http://192.0.2.1:4399"], now - 30001),
    /同步已停止/,
  );
  assert.throws(() => read([], now + 10001), /同步已停止/);
  for (const value of [
    "http://localhost:4399",
    "http://127.0.0.1:4399",
    "http://169.254.1.2:4399",
    "http://user:pass@192.0.2.1:4399",
    "http://192.0.2.1:4399/old?room=123456",
    "file:///tmp",
    "javascript:alert(1)",
  ])
    assert.throws(() => read([value]));
});

test("不重启服务即可读取换网后的IP，断网／过期／文件损坏时不回退到写死地址", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "kawaii-lan-"));
  const file = join(directory, "addresses.json");
  const casino = createCasino({
    hostAddressesFile: file,
    publicUrls: "http://192.0.2.99:4399",
  });
  await new Promise((resolve) => casino.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => casino.io.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${casino.server.address().port}/api/addresses`;
  async function update(addresses, updatedAt = Date.now()) {
    await writeFile(file, JSON.stringify({ addresses, updatedAt }));
  }
  await update(["http://192.0.2.10:4399"]);
  const initial = await fetch(url);
  assert.equal(initial.headers.get("cache-control"), "no-store");
  assert.deepEqual((await initial.json()).addresses, [
    "http://192.0.2.10:4399",
  ]);
  await update(["http://198.51.100.20:4399"]);
  assert.deepEqual((await (await fetch(url)).json()).addresses, [
    "http://198.51.100.20:4399",
  ]);
  await update([]);
  assert.equal((await (await fetch(url)).json()).available, false);
  await update(["http://192.0.2.10:4399"], Date.now() - 31000);
  assert.deepEqual((await (await fetch(url)).json()).addresses, []);
  await writeFile(file, '{"partial":');
  assert.deepEqual((await (await fetch(url)).json()).addresses, []);
  await rm(file);
  assert.deepEqual((await (await fetch(url)).json()).addresses, []);
});
