import test from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import { createCasino } from "../server/index.js";
import { BlackjackTable, botBet } from "../server/games/blackjack.js";

test("21点下注按风格和筹码变化，低筹码合法，机器人实际下注不再固定100", () => {
  const bets = [];
  for (let style = 0; style < 3; style++)
    for (let choice = 0; choice < 4; choice++) {
      const amount = botBet(10000, 10, style, choice);
      bets.push(amount);
      assert.ok(amount >= 50 && amount <= 400);
      assert.equal(amount % 10, 0);
      for (const stack of [10, 11, 29, 100, 2000]) {
        const small = botBet(stack, 10, style, choice);
        assert.ok(Number.isSafeInteger(small) && small >= 10 && small <= stack);
      }
    }
  assert.ok(new Set(bets).size > 4);
  const t = new BlackjackTable();
  const p = t.addPlayer("活跃伙伴", { bot: true, avatar: 2 });
  t.start();
  t.automaticAction(p.id, true);
  assert.ok([150, 200, 300, 400].includes(p.hands[0].bet));
});

test("多人补机器人：两位真人、反复补位、局中等下一手、满桌校验与房主移除", async () => {
  const casino = createCasino({ botDelay: 1e9 });
  await new Promise((resolve) => casino.server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${casino.server.address().port}`;
  const sockets = [];
  async function connect() {
    const s = io(url, { transports: ["websocket"], forceNew: true });
    sockets.push(s);
    s.on("state", (state) => (s.state = state));
    await new Promise((resolve) => s.once("connect", resolve));
    return s;
  }
  const send = (s, event, data = {}) =>
    s.timeout(3000).emitWithAck(event, data);
  try {
    const a = await connect(),
      b = await connect();
    const room = await send(a, "create", { name: "房主" });
    assert.ok((await send(b, "join", { code: room.code, name: "朋友" })).ok);
    assert.equal((await send(b, "bots", { count: 1 })).ok, false);
    assert.equal((await send(a, "bots", { count: -1 })).ok, false);
    assert.ok((await send(a, "bots", { count: 1 })).ok);
    assert.equal(a.state.players.length, 3);
    assert.ok((await send(a, "deal")).ok);
    assert.ok((await send(a, "bots", { count: 1 })).ok);
    assert.equal(a.state.players.length, 4);
    assert.equal(a.state.players.at(-1).inHand, false);
    assert.equal((await send(a, "removeBot")).ok, false);
    assert.ok((await send(a, "bots")).ok);
    assert.equal(a.state.players.length, 7);
    assert.ok((await send(a, "bots", { count: 8 })).ok);
    assert.equal(a.state.players.length, 8);
    assert.equal(new Set(a.state.players.map((p) => p.name)).size, 8);
    assert.equal(a.state.players.filter((p) => !p.bot).length, 2);
    assert.equal((await send(a, "bots")).ok, false);
    const t = casino.rooms.get(room.code).table;
    for (let i = 0; t.playing && i < 100; i++)
      t.automaticAction(t.players[t.turn].id, false);
    assert.equal(t.playing, false);
    assert.equal((await send(b, "removeBot")).ok, false);
    assert.ok((await send(a, "removeBot")).ok);
    assert.equal(a.state.players.length, 7);
    assert.ok(a.state.players.some((p) => p.name === "朋友"));
    assert.ok((await send(a, "bots", { count: 1 })).ok);
    assert.equal(a.state.players.length, 8);
  } finally {
    sockets.forEach((s) => s.disconnect());
    await new Promise((resolve) => casino.io.close(resolve));
  }
});
