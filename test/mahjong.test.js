import test from "node:test";
import { randomInt } from "node:crypto";
import assert from "node:assert/strict";
import {
  MahjongTable,
  deck,
  winningShape,
  canWin,
  scoreHand,
  fewestSuit,
} from "../server/games/mahjong.js";

// Each fixture assigns physical copy ids, including repeated face values.
function tiles(wan = [], tiao = [], tong = []) {
  return [wan, tiao, tong].flatMap((ranks, i) => {
    const copies = new Map(),
      suit = ["wan", "tiao", "tong"][i];
    return ranks.map((rank) => {
      const copy = copies.get(rank) || 0;
      copies.set(rank, copy + 1);
      return { id: `${suit}${rank}-${copy}`, suit, rank };
    });
  });
}
const standard = () => tiles([1, 2, 3, 4, 5, 6], [2, 3, 4, 6, 7, 8, 9, 9]);
const pairs = () => tiles([1, 1, 2, 2, 4, 4], [1, 1, 3, 3, 6, 6, 9, 9]);
const pong = () => ({ type: "pong", tiles: tiles([8, 8, 8]) });
function table(options) {
  const t = new MahjongTable(options);
  for (let i = 0; i < 4; i++) t.addPlayer(`玩家${i}`);
  return t;
}
function setup(options) {
  const t = table(options);
  t.start();
  for (let i = 0; i < 4; i++)
    t.action(t.players[t.turn].id, { type: "void", suit: "tong" });
  return t;
}
function balanced(t, total = 40000) {
  assert.equal(
    t.players.reduce((n, p) => n + p.stack, 0),
    total,
  );
  for (const p of t.players)
    assert.ok(Number.isSafeInteger(p.stack) && p.stack >= 0);
}
function accounted(t) {
  const all = [
    ...t.wall,
    ...t.discards,
    ...t.players.flatMap((p) => [
      ...p.tiles,
      ...p.melds.flatMap((m) => m.tiles),
    ]),
  ];
  assert.equal(all.length, 108);
  assert.equal(new Set(all.map((t) => t.id)).size, 108);
}
function discardFixture() {
  const t = setup();
  // A 9条 discard; seats 1 and 2 can both win with it, seat 3 can pong.
  t.players[0].tiles = tiles([], [9]);
  for (const i of [1, 2]) t.players[i].tiles = standard().slice(0, -1);
  t.players[3].tiles = tiles([], [9, 9, 2]);
  return t;
}

test("108 张牌各有唯一 id，三门各四张；发牌庄14闲13，牌墙55，定缺按座位且隐藏手牌", () => {
  const d = deck();
  assert.equal(d.length, 108);
  assert.equal(new Set(d.map((t) => t.id)).size, 108);
  for (const suit of ["wan", "tiao", "tong"])
    for (let rank = 1; rank <= 9; rank++)
      assert.equal(
        d.filter((t) => t.rank === rank && t.suit === suit).length,
        4,
      );
  const t = table();
  t.players[0].token = "secret";
  t.players[0].socketId = "private";
  t.start();
  assert.deepEqual(
    t.players.map((p) => p.tiles.length),
    [14, 13, 13, 13],
  );
  assert.equal(t.wall.length, 55);
  accounted(t);
  const v = t.view(t.players[0].id);
  assert.ok(v.players[0].tiles.every(Boolean));
  assert.ok(v.players[1].tiles.every((v) => v === null));
  assert.equal(v.players[0].token, undefined);
  assert.equal(v.players[0].socketId, undefined);
  assert.equal(v.wall, undefined);
  assert.equal(t.legal(t.players[1].id), null);
  assert.throws(() => t.action(t.players[1].id, { type: "void", suit: "wan" }));
  const version = t.version;
  assert.throws(() => t.action(t.players[0].id, { type: "void", suit: "bad" }));
  assert.equal(t.version, version);
  for (let i = 0; i < 4; i++) {
    assert.equal(t.turn, i);
    t.automaticAction(t.players[i].id, false);
  }
  assert.equal(t.stage, "playing");
  assert.equal(t.turn, 0);
  assert.equal(fewestSuit(tiles([1, 2], [], [1])), "tiao");
  assert.equal(fewestSuit([]), "wan");
});

test("胡牌检测：标准顺刻将、七对、四张作两对、明刻及所有杠；错张数、坏牌、缺门、坏副露均拒绝", () => {
  assert.ok(winningShape(standard()).standard);
  assert.ok(winningShape(pairs()).sevenPairs);
  assert.ok(
    winningShape(tiles([1, 1, 1, 1, 2, 2, 3, 3], [2, 2, 4, 4, 9, 9]))
      .sevenPairs,
  );
  const rest = tiles([1, 2, 3], [2, 3, 4, 6, 7, 8, 9, 9]);
  for (const type of ["pong", "kong", "concealedKong", "addedKong"]) {
    const m = {
      type,
      tiles: tiles([8, 8, 8, ...(type === "pong" ? [] : [8])]),
    };
    assert.ok(canWin(rest, [m], "tong"));
  }
  assert.equal(canWin(standard(), [], "wan"), false);
  assert.equal(canWin(rest, [pong()], "wan"), false);
  assert.equal(canWin(standard().slice(1)), false);
  assert.equal(
    canWin(tiles([1, 1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9])),
    false,
  );
  assert.equal(
    canWin(tiles([1, 2, 3, 4, 5, 6], [1, 3, 4, 6, 7, 8, 9, 9])),
    false,
  );
  assert.equal(
    canWin(rest, [{ type: "chow", tiles: tiles([7, 8, 9]) }]),
    false,
  );
  assert.equal(
    canWin(rest, [{ type: "pong", tiles: tiles([7, 8, 8]) }]),
    false,
  );
  const bad = standard();
  bad[0] = { suit: "flower", rank: 1 };
  assert.equal(canWin(bad), false);
});

test("番数：平胡1倍、对对胡+1、清一色+2、七对+2、每杠+1、杠上花+1，3番封顶", () => {
  assert.equal(scoreHand(standard()).multiplier, 1);
  assert.equal(
    scoreHand(tiles([1, 1, 1, 2, 2, 2], [3, 3, 3, 4, 4, 4, 9, 9])).fan,
    1,
  );
  assert.equal(
    scoreHand(tiles([1, 2, 3, 2, 3, 4, 4, 5, 6, 7, 8, 9, 9, 9])).fan,
    2,
  );
  assert.equal(scoreHand(pairs()).fan, 2);
  assert.equal(scoreHand(pairs(), [], null, true).fan, 3);
  const m = [{ type: "kong", tiles: tiles([8, 8, 8, 8]) }];
  const rest = tiles([1, 2, 3, 2, 3, 4, 4, 5, 6, 9, 9]);
  const s = scoreHand(rest, m, "tong", true);
  assert.equal(s.rawFan, 4);
  assert.equal(s.fan, 3);
  assert.equal(s.multiplier, 8);
  assert.equal(scoreHand(standard(), [], "tiao"), null);
});

test("必须先打缺门、非法动作不变更状态、出牌后顺时针摸牌；超时出最小合法牌", () => {
  const t = setup();
  const p = t.players[0];
  p.tiles = tiles([1], [2], [9, 3]);
  const before = JSON.stringify(t.view(p.id));
  for (const action of [
    { type: "discard", tile: p.tiles[0].id },
    { type: "discard", tile: "not-mine" },
    { type: "chow" },
    { type: "hu" },
    { type: "pass" },
    { type: "concealedKong", tile: p.tiles[0].id },
  ])
    assert.throws(() => t.action(p.id, action));
  assert.equal(JSON.stringify(t.view(p.id)), before);
  for (const q of t.players.slice(1)) q.tiles = tiles([1]);
  const count = t.wall.length;
  t.automaticAction(p.id, false);
  assert.equal(t.lastDiscard.tile.suit, "tong");
  assert.equal(t.lastDiscard.tile.rank, 3);
  assert.equal(t.turn, 1);
  assert.equal(t.wall.length, count - 1);
  assert.equal(t.players[1].tiles.length, 2);
});

test("截胡优先于碰杠，多个胡按出牌者下家顺序；过后下一家胡；全部过可碰", () => {
  for (const skip of [false, true]) {
    const t = discardFixture();
    t.action(t.players[0].id, {
      type: "discard",
      tile: t.players[0].tiles[0].id,
    });
    assert.equal(t.stage, "claim");
    assert.equal(t.turn, 1);
    assert.deepEqual(t.legal(t.players[1].id).actions, [
      "hu",
      "pass",
      "assist",
    ]);
    assert.throws(() => t.action(t.players[3].id, { type: "pong" }));
    if (skip) {
      t.action(t.players[1].id, { type: "pass" });
      assert.equal(t.turn, 2);
    }
    t.action(t.players[t.turn].id, { type: "hu" });
    assert.equal(t.stage, "showdown");
    assert.equal(t.outcome.winner, skip ? 2 : 1);
    assert.equal(t.outcome.discarder, 0);
    balanced(t);
  }
  const t = discardFixture();
  t.action(t.players[0].id, {
    type: "discard",
    tile: t.players[0].tiles[0].id,
  });
  t.automaticAction(t.players[1].id, false);
  t.automaticAction(t.players[2].id, false);
  assert.equal(t.turn, 3);
  assert.ok(t.legal(t.players[3].id).actions.includes("pong"));
  const n = t.wall.length;
  t.action(t.players[3].id, { type: "pong" });
  assert.equal(t.players[3].melds[0].tiles.length, 3);
  assert.equal(t.players[3].tiles.length, 1);
  assert.equal(t.wall.length, n);
  assert.equal(t.turn, 3);
  assert.equal(t.discards.length, 0);
  assert.ok(!t.legal(t.players[3].id).actions.includes("hu"));
  assert.equal(t.hasDraw, false);
});

test("明杠从墙尾补牌；暗杠隐藏牌面；加杠升级碰，三类杠均不立即收费", () => {
  for (const kind of ["kong", "concealedKong", "addedKong"]) {
    const t = setup(),
      p = t.players[kind === "kong" ? 1 : 0];
    for (const q of t.players) q.tiles = tiles([1]);
    t.wall = tiles([4, 5, 6]);
    const replacement = t.wall.at(-1);
    if (kind === "kong") {
      t.players[0].tiles = tiles([8]);
      p.tiles = tiles([8, 8, 8]);
      t.action(t.players[0].id, {
        type: "discard",
        tile: t.players[0].tiles[0].id,
      });
      assert.ok(t.legal(p.id).actions.includes("kong"));
      t.action(p.id, { type: "kong" });
    } else {
      p.tiles = tiles(kind === "concealedKong" ? [8, 8, 8, 8] : [8]);
      if (kind === "addedKong") {
        p.tiles[0].id = "wan8-3";
        p.melds = [pong()];
      }
      const before = t.version;
      assert.throws(() => t.action(p.id, { type: kind, tile: "bad" }));
      assert.equal(t.version, before);
      t.action(p.id, { type: kind, tile: p.tiles[0].id });
    }
    assert.equal(t.wall.length, 2);
    assert.deepEqual(p.tiles, [replacement]);
    assert.equal(t.kongDraw, true);
    assert.equal(p.melds[0].tiles.length, 4);
    balanced(t);
    const v = t.view(t.players[2].id).players.find((q) => q.id === p.id);
    assert.ok(
      v.melds[0].tiles.every((v) =>
        kind === "concealedKong" ? v === null : !!v,
      ),
    );
    if (kind === "concealedKong")
      assert.ok(t.view(p.id).players[0].melds[0].tiles.every(Boolean));
  }
});

test("定缺禁止碰杠缺门牌；碰后不能立即暗杠；空墙不可杠", () => {
  const t = setup();
  for (const p of t.players) p.tiles = tiles([1]);
  t.players[0].tiles = tiles([], [], [8]);
  t.players[1].tiles = tiles([], [], [8, 8, 8]);
  t.action(t.players[0].id, {
    type: "discard",
    tile: t.players[0].tiles[0].id,
  });
  assert.equal(t.stage, "playing");
  assert.equal(t.turn, 1);
  t.players[1].tiles = tiles([8, 8, 8, 8]);
  t.hasDraw = false;
  assert.equal(t.kongOptions(t.players[1]).length, 0);
  t.hasDraw = true;
  t.wall = [];
  assert.equal(t.kongOptions(t.players[1]).length, 0);
});

test("自摸三家各付每份加底，点炮一家付；不足封顶、实际到账守恒；赢家坐庄", () => {
  for (const selfDraw of [false, true]) {
    const t = setup(),
      p = t.players[0];
    p.tiles = standard();
    t.players[1].stack = 5;
    t.players[2].stack = 11;
    t.players[3].stack = 100;
    const total = p.stack + 116;
    if (selfDraw) t.action(p.id, { type: "hu" });
    else {
      t.turn = 1;
      t.players[1].tiles = [p.tiles.pop()];
      t.players[2].tiles = tiles([1]);
      t.players[3].tiles = tiles([1]);
      t.action(t.players[1].id, {
        type: "discard",
        tile: t.players[1].tiles[0].id,
      });
      t.action(p.id, { type: "hu" });
    }
    assert.equal(t.score, 10);
    assert.deepEqual(
      t.result.map((r) => r.net),
      selfDraw ? [36, -5, -11, -20] : [5, -5, 0, 0],
    );
    assert.equal(t.nextDealer, 0);
    assert.equal(
      t.result.reduce((n, r) => n + r.net, 0),
      0,
    );
    balanced(t, total);
    assert.ok(t.view(p.id).players.every((p) => p.tiles.every(Boolean)));
    assert.throws(() => t.action(p.id, { type: "hu" }));
  }
});

test("牌墙耗尽流局不支付、下家坐庄；最后一张的弃牌仍可胡，不能再碰杠", () => {
  const t = setup();
  for (const p of t.players) p.tiles = tiles([1]);
  t.wall = [];
  t.action(t.players[0].id, {
    type: "discard",
    tile: t.players[0].tiles[0].id,
  });
  assert.equal(t.stage, "showdown");
  assert.ok(t.outcome.draw);
  assert.equal(t.nextDealer, 1);
  assert.ok(t.result.every((r) => r.net === 0));
  balanced(t);
  t.start();
  assert.equal(t.dealer, 1);
  assert.equal(t.players[1].tiles.length, 14);
  const last = discardFixture();
  last.wall = [];
  last.action(last.players[0].id, {
    type: "discard",
    tile: last.players[0].tiles[0].id,
  });
  assert.equal(last.stage, "claim");
  last.action(last.players[1].id, { type: "hu" });
  assert.equal(last.outcome.winner, 1);
  const pass = discardFixture();
  pass.wall = [];
  pass.action(pass.players[0].id, {
    type: "discard",
    tile: pass.players[0].tiles[0].id,
  });
  while (pass.playing) pass.automaticAction(pass.players[pass.turn].id, false);
  assert.ok(pass.outcome.draw);
});

test("机器人立即抢牌；真人抢牌限时8秒；离桌保留至结算再移除；恰好四席且不足底分须补码", () => {
  const t = discardFixture();
  t.players[1].bot = true;
  t.action(t.players[0].id, {
    type: "discard",
    tile: t.players[0].tiles[0].id,
  });
  assert.equal(t.stage, "showdown");
  assert.equal(t.outcome.winner, 1);
  const timed = discardFixture();
  timed.action(timed.players[0].id, {
    type: "discard",
    tile: timed.players[0].tiles[0].id,
  });
  assert.ok(timed.deadline - Date.now() <= 8000);
  timed.remove(timed.players[1].id);
  assert.equal(timed.turn, 2);
  timed.prune();
  assert.equal(timed.players.length, 4);
  timed.action(timed.players[2].id, { type: "hu" });
  timed.prune();
  assert.equal(timed.players.length, 3);
  assert.throws(() => timed.start());
  const low = table({ stack: 9 });
  assert.throws(() => low.start());
  const full = table();
  assert.throws(() => full.addPlayer("满"));
  full.start();
  assert.throws(() => full.start());
});

test("500 局机器人与随机合法动作：每步108张唯一牌、筹码零和非负，有限步结束", () => {
  const t = table({ stack: 100 });
  t.players.forEach((p, i) => {
    p.bot = i > 0;
  });
  let wins = 0,
    kongs = 0,
    total = 400;
  for (let round = 0; round < 500; round++) {
    for (const p of t.players)
      if (p.stack < 10) {
        total += 100 - p.stack;
        p.stack = 100;
      }
    t.start();
    let steps = 0;
    while (t.playing) {
      assert.ok(++steps < 400, `round ${round} must terminate`);
      const p = t.players[t.turn],
        l = t.legal(p.id);
      assert.ok(l);
      if (round % 5 === 0 && t.stage === "claim")
        t.automaticAction(p.id, false);
      else if (
        round % 5 === 0 &&
        t.stage === "playing" &&
        !l.actions.includes("hu")
      ) {
        t.action(p.id, {
          type: "discard",
          tile: l.discards[randomInt(l.discards.length)],
        });
      } else t.automaticAction(p.id, true);
      balanced(t, total);
      accounted(t);
    }
    if (!t.outcome.draw) wins++;
    kongs += t.players
      .flatMap((p) => p.melds)
      .filter((m) => m.type !== "pong").length;
    assert.equal(t.result.length, 4);
    assert.equal(
      t.result.reduce((n, r) => n + r.net, 0),
      0,
    );
  }
  assert.ok(wins > 0);
  assert.ok(kongs > 0);
});

test("下家可碰也必须让远家先胡；跨一号座的截胡顺序与机器人等待真人窗口", () => {
  const t = setup();
  for (const p of t.players) p.tiles = tiles([1]);
  t.turn = 2;
  t.players[2].tiles = tiles([], [9]);
  t.players[3].tiles = tiles([], [9, 9, 1]);
  t.players[0].tiles = standard().slice(0, -1);
  t.players[1].tiles = standard().slice(0, -1);
  t.players[1].bot = true;
  t.action(t.players[2].id, {
    type: "discard",
    tile: t.players[2].tiles[0].id,
  });
  assert.equal(t.turn, 0);
  assert.equal(t.stage, "claim"); // hu overrides the closer pong at seat 3
  assert.equal(t.legal(t.players[1].id), null);
  t.automaticAction(t.players[0].id, false);
  assert.equal(t.stage, "showdown");
  assert.equal(t.outcome.winner, 1);
  assert.equal(t.outcome.discarder, 2);
});

test("最后一张杠后补牌仍可杠上开花；暗杠任意一张均可选，结算后公开并只计赢家的杠", () => {
  const t = setup(),
    p = t.players[0];
  p.tiles = tiles([8, 8, 8, 8, 1, 2, 3], [2, 3, 4, 6, 7, 8, 9]);
  t.wall = tiles([], [9]);
  t.wall[0].id = "tiao9-1";
  const fourth = p.tiles[3].id;
  assert.ok(t.legal(p.id).kongs.some((o) => o.tile === fourth));
  t.action(p.id, { type: "concealedKong", tile: fourth });
  assert.equal(t.wall.length, 0);
  assert.ok(t.legal(p.id).actions.includes("hu"));
  assert.ok(
    t.view(t.players[1].id).players[0].melds[0].tiles.every((t) => t === null),
  );
  t.action(p.id, { type: "hu" });
  assert.equal(t.outcome.fan, 2);
  assert.equal(t.outcome.multiplier, 4);
  assert.equal(t.score, 40);
  assert.deepEqual(
    t.result.map((r) => r.net),
    [150, -50, -50, -50],
  );
  balanced(t);
  assert.ok(t.view(t.players[1].id).players[0].melds[0].tiles.every(Boolean));
  const version = t.version,
    stacks = t.players.map((p) => p.stack);
  t.finish(0);
  assert.equal(t.version, version);
  assert.deepEqual(
    t.players.map((p) => p.stack),
    stacks,
  );
});

test("杠后打出即重置杠上花，连续杠每次消耗墙尾一张；两个杠累加两番", () => {
  const t = setup(),
    p = t.players[0];
  for (const q of t.players) q.tiles = tiles([1]);
  p.tiles = tiles([7, 7, 7, 7, 8, 8, 8, 8], [1, 2, 3, 4, 5, 6]);
  t.wall = tiles([], [8, 9]);
  t.action(p.id, { type: "concealedKong", tile: p.tiles[0].id });
  assert.equal(t.wall.length, 1);
  assert.equal(t.kongDraw, true);
  t.action(p.id, {
    type: "concealedKong",
    tile: p.tiles.find((t) => t.rank === 8 && t.suit === "wan").id,
  });
  assert.equal(t.wall.length, 0);
  assert.equal(p.melds.length, 2);
  assert.equal(t.kongDraw, true);
  t.action(p.id, { type: "discard", tile: p.tiles[0].id });
  assert.equal(t.kongDraw, false);
  assert.ok(t.outcome.draw);
  const two = [
    { type: "kong", tiles: tiles([8, 8, 8, 8]) },
    { type: "concealedKong", tiles: tiles([], [8, 8, 8, 8]) },
  ];
  assert.equal(
    scoreHand(tiles([1, 2, 3], [2, 3, 4, 9, 9]), two, "tong").fan,
    2,
  );
});

test("结算后离桌清理和补位，赢家名称/身份不变，保留赢家下手坐庄", () => {
  const t = discardFixture();
  t.action(t.players[0].id, {
    type: "discard",
    tile: t.players[0].tiles[0].id,
  });
  const winner = t.players[1];
  t.action(winner.id, { type: "hu" });
  t.remove(t.players[0].id);
  t.prune();
  assert.equal(t.outcome.winnerName, winner.name);
  assert.equal(t.outcome.winnerId, winner.id);
  assert.equal(t.outcome.winner, 0);
  assert.equal(t.nextDealer, 0);
  assert.equal(t.outcome.discarder, -1);
  t.addPlayer("补位");
  t.start();
  assert.equal(t.players[t.dealer].id, winner.id);
  for (let i = 0; i < 4; i++) t.automaticAction(t.players[t.turn].id, false);
  t.players[t.turn].tiles = standard();
  t.players[t.turn].voidSuit = "tong";
  t.action(winner.id, { type: "hu" });
  t.remove(winner.id);
  t.prune();
  assert.equal(t.outcome.winner, -1);
  assert.equal(t.outcome.winnerName, winner.name);
  assert.equal(t.view(t.players[0].id).outcome.winnerName, winner.name);
});
test("完整出牌记录保留玩家、顺序、碰牌去向；视图安全复制并在新手清空", () => {
  const t = discardFixture();
  const played = t.players[0].tiles[0];
  t.action(t.players[0].id, { type: "discard", tile: played.id });
  t.action(t.players[1].id, { type: "pass" });
  t.action(t.players[2].id, { type: "pass" });
  t.action(t.players[3].id, { type: "pong" });
  assert.equal(t.discards.length, 0);
  assert.equal(t.discardHistory.length, 1);
  const entry = t.discardHistory[0];
  assert.equal(entry.sequence, 1);
  assert.equal(entry.playerId, t.players[0].id);
  assert.equal(entry.claimType, "pong");
  assert.equal(entry.claimedBy, t.players[3].name);
  assert.equal(entry.tile.id, played.id);
  const view = t.view(t.players[0].id);
  view.discardHistory[0].name = "修改";
  view.discardHistory[0].tile.rank = 1;
  assert.equal(entry.name, "玩家0");
  assert.equal(entry.tile.rank, 9);
  t.finish();
  t.start();
  assert.deepEqual(t.discardHistory, []);
});

test("点炮胡牌在完整出牌记录中标记胡牌玩家", () => {
  const t = discardFixture();
  t.action(t.players[0].id, {
    type: "discard",
    tile: t.players[0].tiles[0].id,
  });
  t.action(t.players[1].id, { type: "hu" });
  assert.equal(t.discardHistory[0].claimType, "hu");
  assert.equal(t.discardHistory[0].claimedBy, t.players[1].name);
});
