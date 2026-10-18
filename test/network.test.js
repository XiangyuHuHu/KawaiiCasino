import test from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import { createCasino } from "../server/index.js";

test("真实 Socket.IO 客户端：建房、隐私、聊天、对局、断线恢复与房主转移", async () => {
  const casino = createCasino();
  await new Promise((r) => casino.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${casino.server.address().port}`;
  const sockets = [];
  async function connect() {
    const s = io(url, { transports: ["websocket"], forceNew: true });
    sockets.push(s);
    s.on("state", (v) => (s.state = v));
    await new Promise((r) => s.once("connect", r));
    return s;
  }
  async function send(s, e, d = {}) {
    return await s.timeout(3000).emitWithAck(e, d);
  }
  async function waitFor(fn) {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.fail("等待同步超时");
  }
  try {
    const a = await connect(),
      b = await connect();
    const room = await send(a, "create", { name: "房主" });
    assert.ok(room.ok);
    assert.match(room.code, /^\d{6}$/);
    const joined = await send(b, "join", { name: "朋友", code: room.code });
    assert.ok(joined.ok);
    await waitFor(() => a.state?.players.length === 2);
    assert.equal((await send(b, "deal")).ok, false);
    assert.ok((await send(a, "deal")).ok);
    await waitFor(() => b.state?.stage === "preflop");
    assert.ok(a.state.players[0].cards.every(Boolean));
    assert.deepEqual(b.state.players[0].cards, [null, null]);
    assert.equal(
      (await send(a, "action", { type: "call", hand: 0, version: 0 })).ok,
      false,
    );
    assert.equal(
      (
        await send(a, "action", {
          type: "check",
          hand: a.state.hand,
          version: a.state.version,
        })
      ).ok,
      false,
    );
    assert.ok(
      (await send(b, "chat", { text: "<img src=x onerror=alert(1)>你好" })).ok,
    );
    await waitFor(() => a.state.messages.length === 1);
    const c = await connect();
    assert.ok((await send(c, "join", { name: "后来者", code: room.code })).ok);
    await waitFor(() => a.state.players.length === 3);
    assert.equal(c.state.players[2].inHand, false);
    for (let steps = 0; steps < 30 && a.state.stage !== "showdown"; steps++) {
      const active = a.state.players[a.state.turn].id === a.state.me ? a : b;
      await waitFor(() => !!active.state.legal);
      const v = active.state.version;
      const action = active.state.legal.toCall ? "call" : "check";
      assert.ok(
        (
          await send(active, "action", {
            type: action,
            version: v,
            hand: active.state.hand,
          })
        ).ok,
      );
      await waitFor(() => a.state.version > v);
    }
    assert.equal(a.state.stage, "showdown");
    assert.equal(
      a.state.players.slice(0, 2).reduce((n, p) => n + p.stack, 0),
      20000,
    );
    a.disconnect();
    await waitFor(() => b.state.hostId === b.state.me);
    const restored = await connect();
    assert.ok(
      (await send(restored, "resume", { code: room.code, token: room.token }))
        .ok,
    );
    await waitFor(() => restored.state?.me === a.state.me);
    assert.equal(restored.state.players.length, 3);
    assert.equal(restored.state.hostId, b.state.me);
    assert.equal(
      (await send(c, "resume", { code: room.code, token: "wrong" })).ok,
      false,
    );
    assert.ok((await send(c, "leave")).ok);
    assert.ok((await send(b, "bots")).ok);
    assert.ok((await send(b, "deal")).ok);
    await waitFor(() => b.state.hand === 2);
    assert.equal(b.state.players.filter((p) => p.bot).length, 3);
    assert.equal((await fetch(`${url}/../package.json`)).status, 404);
    assert.ok((await (await fetch(`${url}/api/health`)).json()).ok);
  } finally {
    sockets.forEach((s) => s.disconnect());
    await new Promise((r) => {
      casino.io.close(r);
    });
  }
});
