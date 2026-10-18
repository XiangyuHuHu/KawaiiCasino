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

test("21点 Socket.IO：注册表、机器人自动下注、完整结算、补码、重连与静态模块", async () => {
  const casino = createCasino({ botDelay: 0, tickInterval: 5 });
  await new Promise((r) => casino.server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${casino.server.address().port}`;
  const sockets = [];
  const connect = async () => {
    const s = io(url, { transports: ["websocket"], forceNew: true });
    sockets.push(s);
    s.on("state", (state) => (s.state = state));
    await new Promise((r) => s.once("connect", r));
    return s;
  };
  const send = (s, event, data = {}) =>
    s.timeout(3000).emitWithAck(event, data);
  const waitFor = async (fn) => {
    for (let i = 0; i < 200; i++) {
      if (fn()) return;
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.fail("等待 21点 同步超时");
  };
  try {
    const a = await connect();
    assert.equal(
      (await send(a, "create", { name: "房主", gameType: "unknown" })).ok,
      false,
    );
    const created = await send(a, "create", {
      name: "房主",
      gameType: "blackjack",
    });
    assert.ok(created.ok);
    assert.equal(a.state.gameType, "blackjack");
    assert.equal(a.state.game.name, "21点");
    assert.ok((await send(a, "bots")).ok);
    assert.equal(a.state.players.filter((p) => p.bot).length, 4);
    const t = casino.rooms.get(created.code).table;
    // Five players, two dealing passes; human gets 16, bots get 18, house 17.
    const ranks = [10, 9, 9, 9, 9, 10, 6, 9, 9, 9, 9, 7];
    t.cards = [
      ...Array.from({ length: 80 }, () => ({ rank: 10, suit: "h" })),
      ...ranks.reverse().map((rank) => ({ rank, suit: "s" })),
    ];
    assert.ok((await send(a, "start")).ok);
    assert.equal(a.state.stage, "betting");
    const action = (type, amount) =>
      send(a, "action", {
        type,
        amount,
        hand: a.state.hand,
        version: a.state.version,
      });
    assert.equal((await action("hit")).ok, false);
    assert.equal((await action("bet", 10001)).ok, false);
    assert.ok((await action("bet", 20)).ok);
    assert.equal((await send(a, "rebuy")).ok, false);
    await waitFor(() => a.state.stage === "playing" && a.state.legal);
    assert.equal(a.state.dealerCards[1], null);
    assert.equal(a.state.players[0].hands[0].value.total, 16);
    assert.equal(
      (await send(a, "action", { type: "stand", hand: 0, version: 0 })).ok,
      false,
    );
    assert.ok((await action("stand")).ok);
    await waitFor(() => a.state.stage === "showdown");
    assert.equal(a.state.result.length, 5);
    assert.ok(
      a.state.players.slice(1).every((p) => p.hands[0].outcome === "win"),
    );
    assert.equal(a.state.players[0].stack, 9980);
    assert.equal(
      a.state.players.reduce((n, p) => n + p.stack, 0) + a.state.houseNet,
      50000,
    );
    assert.equal(a.state.houseNet, -380);
    assert.ok(a.state.dealerCards.every(Boolean));
    assert.ok((await send(a, "rebuy")).ok);
    assert.equal(a.state.players[0].stack, 10000);
    assert.equal(a.state.houseNet, -380);
    a.disconnect();
    const resumed = await connect();
    assert.ok(
      (
        await send(resumed, "resume", {
          code: created.code,
          token: created.token,
        })
      ).ok,
    );
    assert.equal(resumed.state.me, created.playerId);
    assert.equal(resumed.state.gameType, "blackjack");
    assert.ok((await send(resumed, "next")).ok);
    assert.equal(resumed.state.hand, 2);
    assert.equal(resumed.state.stage, "betting");
    const metadata = await (await fetch(`${url}/api/games`)).json();
    assert.deepEqual(
      metadata.map((g) => g.gameType),
      ["poker", "blackjack"],
    );
    const module = await fetch(`${url}/games/blackjack.js`);
    assert.equal(module.status, 200);
    assert.match(
      module.headers.get("content-security-policy"),
      /script-src 'self'/,
    );
    assert.match(await module.text(), /renderBlackjack/);
  } finally {
    sockets.forEach((s) => s.disconnect());
    await new Promise((r) => casino.io.close(r));
  }
});

test("21点服务器计时器：下注超时最低注，行动超时停牌", async () => {
  const casino = createCasino({
    botDelay: 0,
    tickInterval: 5,
    actionTimeout: 40,
  });
  await new Promise((r) => casino.server.listen(0, "127.0.0.1", r));
  const s = io(`http://127.0.0.1:${casino.server.address().port}`, {
    transports: ["websocket"],
  });
  s.on("state", (state) => (s.state = state));
  try {
    await new Promise((r) => s.once("connect", r));
    const created = await s.emitWithAck("create", {
      name: "玩家",
      gameType: "blackjack",
    });
    const t = casino.rooms.get(created.code).table;
    t.cards = Array.from({ length: 100 }, () => ({ rank: 10, suit: "s" }));
    assert.ok((await s.emitWithAck("deal", {})).ok);
    for (let i = 0; i < 100 && s.state?.stage !== "showdown"; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(s.state.stage, "showdown");
    assert.equal(s.state.players[0].hands[0].bet, 10);
    assert.equal(s.state.players[0].hands[0].cards.length, 2);
    assert.equal(s.state.result[0].outcome, "push");
  } finally {
    s.disconnect();
    await new Promise((r) => casino.io.close(r));
  }
});
