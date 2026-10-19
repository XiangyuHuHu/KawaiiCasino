import test from "node:test";
import assert from "node:assert/strict";
import { io } from "socket.io-client";
import { createCasino } from "../server/index.js";
import { games } from "../server/games/index.js";

test("Docker 邀请使用宿主机地址和发布端口", async () => {
  const casino = createCasino({
    publicUrls: "http://192.168.1.10:4399, http://192.168.2.10:4399/",
  });
  await new Promise((resolve) => casino.server.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(
      `http://127.0.0.1:${casino.server.address().port}/api/addresses`,
    );
    assert.deepEqual((await response.json()).addresses, [
      "http://192.168.1.10:4399",
      "http://192.168.2.10:4399",
    ]);
  } finally {
    await new Promise((resolve) => casino.io.close(resolve));
  }
  assert.throws(() => createCasino({ publicUrls: "file:///tmp" }));
});

for (const [gameType, game] of games)
  test(`${game.name} 单人开局：唯一真人、满桌机器人、私人房间与重连`, async () => {
    const casino = createCasino({ botDelay: 1e9 });
    await new Promise((resolve) =>
      casino.server.listen(0, "127.0.0.1", resolve),
    );
    const url = `http://127.0.0.1:${casino.server.address().port}`;
    const clients = [];
    const connect = async () => {
      const socket = io(url, { forceNew: true, transports: ["websocket"] });
      clients.push(socket);
      socket.on("state", (state) => (socket.state = state));
      await new Promise((resolve) => socket.once("connect", resolve));
      return socket;
    };
    try {
      const a = await connect();
      const session = await a
        .timeout(3000)
        .emitWithAck("create", { gameType, solo: true, name: "薄荷团子" });
      assert.ok(session.ok, session.error);
      assert.equal(a.state.mode, "solo");
      assert.equal(a.state.gameType, gameType);
      assert.equal(a.state.players.length, game.maxPlayers);
      assert.equal(a.state.players.filter((p) => !p.bot).length, 1);
      assert.equal(
        a.state.players.filter((p) => p.bot).length,
        game.maxPlayers - 1,
      );
      assert.equal(
        new Set(a.state.players.map((p) => p.id)).size,
        game.maxPlayers,
      );
      assert.equal(
        new Set(a.state.players.map((p) => p.name)).size,
        game.maxPlayers,
      );
      assert.notEqual(a.state.stage, "waiting");
      assert.equal(a.state.hand, 1);
      const b = await connect();
      const join = await b
        .timeout(3000)
        .emitWithAck("join", { code: session.code, name: "不应加入" });
      assert.equal(join.ok, false);
      assert.match(join.error, /单人/);
      a.disconnect();
      const resume = await b
        .timeout(3000)
        .emitWithAck("resume", { code: session.code, token: session.token });
      assert.ok(resume.ok, resume.error);
      assert.equal(b.state.mode, "solo");
      assert.equal(b.state.players.filter((p) => !p.bot).length, 1);
      assert.equal(b.state.me, a.state.me);
    } finally {
      clients.forEach((s) => s.disconnect());
      await new Promise((resolve) => casino.io.close(resolve));
    }
  });
