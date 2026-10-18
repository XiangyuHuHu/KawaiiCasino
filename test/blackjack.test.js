import test from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { BlackjackTable, handValue, shoe } from "../server/games/blackjack.js";

const card = (rank, suit = "s") => ({ rank, suit });
// Draws use pop(); padding keeps these fixtures above the cut card.
function rig(t, ranks) {
  t.cards = [
    ...Array.from({ length: 80 }, () => card(10)),
    ...ranks.map((r) => card(r)).reverse(),
  ];
}
function round(ranks, { stack = 1000, bet = 10 } = {}) {
  const t = new BlackjackTable({ stack });
  const p = t.addPlayer("玩家");
  rig(t, ranks);
  t.start();
  t.act(p.id, "bet", bet);
  return { t, p };
}
function balanced(t, total) {
  assert.equal(
    t.players.reduce((sum, p) => sum + p.stack, 0) + t.houseNet,
    total,
  );
  for (const p of t.players)
    assert.ok(Number.isSafeInteger(p.stack) && p.stack >= 0);
}

test("点数：人头牌、多张 A、软硬转换和爆牌", () => {
  for (const [ranks, total, soft] of [
    [[14, 6], 17, true],
    [[14, 6, 10], 17, false],
    [[14, 14, 9], 21, true],
    [[14, 14, 9, 10], 21, false],
    [[11, 12, 13], 30, false],
    [[14, 14, 14, 8], 21, true],
  ])
    assert.deepEqual(handValue(ranks.map((r) => card(r))), { total, soft });
});

test("六副牌鞋及 25% 切牌阈值（只在新手开始洗牌）", () => {
  const cards = shoe();
  assert.equal(cards.length, 312);
  for (const suit of ["s", "h", "d", "c"])
    for (let rank = 2; rank <= 14; rank++)
      assert.equal(
        cards.filter((c) => c.rank === rank && c.suit === suit).length,
        6,
      );
  const t = new BlackjackTable();
  t.addPlayer("玩家");
  t.cards = cards.slice(0, 78);
  const original = t.cards;
  t.start();
  assert.equal(t.cards, original);
  t.remove(t.players[0].id); // No wager: end round without draws.
  t.prune();
  t.addPlayer("新玩家");
  t.cards = cards.slice(0, 77);
  t.start();
  assert.equal(t.cards.length, 312);
});

test("依座位分两轮发牌，庄家最后；底牌与凭证不会泄露", () => {
  const t = new BlackjackTable();
  const a = t.addPlayer("甲", { token: "secret", socketId: "private" });
  const b = t.addPlayer("乙");
  rig(t, [2, 3, 4, 5, 6, 7]);
  t.start();
  assert.equal(t.legal(b.id), null);
  t.act(a.id, "bet", 10);
  assert.equal(a.hands[0].cards.length, 0);
  t.act(b.id, "bet", 20);
  assert.deepEqual(
    a.hands[0].cards.map((c) => c.rank),
    [2, 5],
  );
  assert.deepEqual(
    b.hands[0].cards.map((c) => c.rank),
    [3, 6],
  );
  assert.deepEqual(
    t.dealerCards.map((c) => c.rank),
    [4, 7],
  );
  const view = t.view(a.id);
  assert.deepEqual(view.dealerCards, [card(4), null]);
  assert.equal(view.dealerValue, null);
  assert.equal(view.players[0].token, undefined);
  assert.equal(view.players[0].socketId, undefined);
});

test("下注、行动次序与非法请求不改变筹码或版本", () => {
  const t = new BlackjackTable({ stack: 20 });
  const p = t.addPlayer("玩家");
  t.start();
  for (const bad of [9, 21, 10.5, NaN, Infinity, "10", -10, null]) {
    const version = t.version;
    assert.throws(() => t.action(p.id, { type: "bet", amount: bad }));
    assert.equal(t.version, version);
    balanced(t, 20);
  }
  assert.throws(() => t.act(p.id, "hit"));
  assert.throws(() => t.act("unknown", "bet", 10));
  rig(t, [8, 10, 8, 7]);
  t.act(p.id, "bet", 15);
  assert.deepEqual(t.legal(p.id).actions, ["hit", "stand"]);
  for (const action of ["double", "split", "surrender", "insurance", "wat"])
    assert.throws(() => t.act(p.id, action));
  balanced(t, 20);
  assert.throws(() => t.start());
});

test("加倍只在首两张；分牌必须同 rank，不能重复分牌", () => {
  const { t, p } = round([5, 10, 6, 7, 2]);
  assert.ok(t.legal(p.id).actions.includes("double"));
  t.act(p.id, "hit");
  assert.deepEqual(t.legal(p.id).actions, ["hit", "stand"]);
  assert.throws(() => t.act(p.id, "double"));
  const unequal = round([10, 10, 11, 7]);
  assert.ok(!unequal.t.legal(unequal.p.id).actions.includes("split"));
  const split = round([8, 10, 8, 7, 8, 8]);
  split.t.act(split.p.id, "split");
  assert.equal(split.p.hands.length, 2);
  assert.ok(!split.t.legal(split.p.id).actions.includes("split"));
  assert.throws(() => split.t.act(split.p.id, "split"));
  assert.ok(split.t.legal(split.p.id).actions.includes("double"));
});

test("庄家软 17 停牌，软 16 要牌；硬 17 停牌", () => {
  for (const [ranks, expected] of [
    [
      [10, 14, 8, 6, 10],
      [14, 6],
    ],
    [
      [10, 14, 8, 5, 2],
      [14, 5, 2],
    ],
    [
      [10, 10, 8, 7, 2],
      [10, 7],
    ],
  ]) {
    const { t, p } = round(ranks);
    t.act(p.id, "stand");
    assert.deepEqual(
      t.dealerCards.map((c) => c.rank),
      expected,
    );
    balanced(t, 1000);
  }
});

test("普通胜、负、平、爆牌、黑杰克 3:2（向下取整）、庄家黑杰克", () => {
  for (const [ranks, action, outcome, payout] of [
    [[10, 10, 8, 7], "stand", "win", 22],
    [[10, 10, 6, 7], "stand", "lose", 0],
    [[10, 10, 7, 7], "stand", "push", 11],
    [[10, 10, 6, 7, 10], "hit", "bust", 0],
    [[14, 10, 10, 7], null, "blackjack", 27],
    [[14, 14, 10, 10], null, "push", 11],
    [[10, 14, 9, 10], null, "lose", 0],
    [[10, 10, 9, 6, 10], "stand", "win", 22],
  ]) {
    const { t, p } = round(ranks, { bet: 11 });
    if (action) t.act(p.id, action);
    assert.equal(t.stage, "showdown");
    assert.equal(p.hands[0].outcome, outcome);
    assert.equal(p.hands[0].payout, payout);
    assert.equal(p.stack, 1000 - 11 + payout);
    assert.equal(t.result[0].net, payout - 11);
    assert.ok(t.view(p.id).dealerCards.every(Boolean));
    balanced(t, 1000);
  }
});

test("爆牌即输，其他玩家尚未行动时也已经结算", () => {
  const t = new BlackjackTable({ stack: 100 });
  const a = t.addPlayer("甲"),
    b = t.addPlayer("乙");
  rig(t, [10, 10, 10, 6, 8, 7, 10]);
  t.start();
  t.act(a.id, "bet", 10);
  t.act(b.id, "bet", 10);
  t.act(a.id, "hit");
  assert.equal(t.stage, "playing");
  assert.equal(a.hands[0].settled, true);
  assert.equal(a.hands[0].outcome, "bust");
  assert.equal(t.result.length, 1);
  balanced(t, 200);
  t.act(b.id, "stand");
  assert.equal(t.result.length, 2);
  balanced(t, 200);
});

test("加倍只拿一张，赢赔加倍的本金；爆牌全输；可用尽筹码", () => {
  for (const [draw, outcome, stack] of [
    [10, "win", 40],
    [2, "lose", 0],
  ]) {
    const { t, p } = round([5, 10, 6, 7, draw], { stack: 20 });
    t.act(p.id, "double");
    assert.equal(t.stage, "showdown");
    assert.equal(p.hands[0].bet, 20);
    assert.equal(p.hands[0].cards.length, 3);
    assert.equal(p.hands[0].outcome, outcome);
    assert.equal(p.stack, stack);
    balanced(t, 20);
  }
  const { t, p } = round([10, 10, 6, 7, 10], { stack: 20 });
  t.act(p.id, "double");
  assert.equal(p.hands[0].outcome, "bust");
  assert.equal(p.stack, 0);
  balanced(t, 20);
});

test("分牌独立结算，分牌后可加倍，分 A 只补一张且 21 不算黑杰克", () => {
  const { t, p } = round([8, 10, 8, 7, 3, 10, 10]);
  t.act(p.id, "split");
  assert.equal(p.stack, 980);
  t.act(p.id, "double");
  assert.equal(t.activeHand, 1);
  t.act(p.id, "stand");
  assert.deepEqual(
    p.hands.map((h) => [h.bet, h.outcome, h.payout]),
    [
      [20, "win", 40],
      [10, "win", 20],
    ],
  );
  assert.deepEqual(
    t.result.map((r) => r.handIndex),
    [0, 1],
  );
  balanced(t, 1000);
  const aces = round([14, 10, 14, 7, 10, 6]);
  aces.t.act(aces.p.id, "split");
  assert.equal(aces.t.stage, "showdown");
  assert.equal(aces.t.legal(aces.p.id), null);
  assert.deepEqual(
    aces.p.hands.map((h) => [h.cards.length, h.outcome, h.payout]),
    [
      [2, "win", 20],
      [2, "push", 10],
    ],
  );
  balanced(aces.t, 1000);
});

test("离桌自动停牌；未下注离桌不扣款；后来者等待下一手；下注/行动超时默认值", () => {
  const { t, p } = round([10, 10, 8, 7]);
  const later = t.addPlayer("后来者");
  assert.equal(later.inHand, false);
  t.remove(p.id);
  assert.equal(t.stage, "showdown");
  assert.equal(p.hands[0].outcome, "win");
  balanced(t, 2000);
  t.prune();
  assert.equal(t.players.length, 1);
  t.start();
  rig(t, [10, 10, 6, 7]);
  t.automaticAction(later.id, false);
  assert.equal(later.hands[0].bet, 10);
  t.automaticAction(later.id, false);
  assert.equal(t.stage, "showdown");
  assert.equal(later.hands[0].cards.length, 2);
  const waiting = new BlackjackTable();
  const a = waiting.addPlayer("甲"),
    b = waiting.addPlayer("乙");
  waiting.start();
  waiting.remove(a.id);
  assert.equal(a.stack, 10000);
  assert.ok(waiting.legal(b.id));
});

test("分牌后一手爆牌立即结算，另一手仍可平局退注", () => {
  const { t, p } = round([8, 10, 8, 7, 2, 9, 10, 10]);
  t.act(p.id, "split");
  t.act(p.id, "hit");
  t.act(p.id, "hit");
  assert.equal(p.hands[0].outcome, "bust");
  assert.equal(t.activeHand, 1);
  assert.equal(t.stage, "playing");
  t.act(p.id, "stand");
  assert.equal(p.hands[1].outcome, "push");
  assert.equal(p.stack, 990);
  balanced(t, 1000);
});

test("极端牌鞋耗尽时只重洗之前弃牌，桌上牌保留", () => {
  const { t, p } = round([2, 10, 2, 7]);
  t.cards = [];
  t.discards = [card(3)];
  t.act(p.id, "hit");
  assert.deepEqual(
    p.hands[0].cards.map((c) => c.rank),
    [2, 2, 3],
  );
  assert.deepEqual(
    t.dealerCards.map((c) => c.rank),
    [10, 7],
  );
  assert.equal(t.discards.length, 0);
  t.act(p.id, "stand");
  balanced(t, 1000);
});

test("1–5 席、最低筹码限制、单人可完成整局", () => {
  const t = new BlackjackTable({ stack: 9 });
  assert.throws(() => t.start());
  for (let i = 0; i < 5; i++) t.addPlayer(`玩家${i}`);
  assert.throws(() => t.addPlayer("超额"));
  assert.throws(() => t.start());
  const solo = round([10, 10, 8, 7]);
  solo.t.act(solo.p.id, "stand");
  assert.equal(solo.t.stage, "showdown");
});

test("1000 局随机合法行动和策略机器人：每步玩家筹码非负、玩家加庄家总账守恒", () => {
  const t = new BlackjackTable({ stack: 1000 });
  for (let i = 0; i < 5; i++) t.addPlayer(`玩家${i}`, { bot: i > 0 });
  let total = 5000;
  for (let round = 0; round < 1000; round++) {
    // Explicit rebuys are the only external chip source.
    for (const p of t.players)
      if (p.stack < 100) {
        total += 1000 - p.stack;
        p.stack = 1000;
      }
    const before = t.houseNet;
    t.start();
    let steps = 0;
    while (t.playing) {
      assert.ok(++steps < 150);
      const p = t.players[t.turn],
        legal = t.legal(p.id);
      if (p.bot) t.automaticAction(p.id, true);
      else if (t.stage === "betting")
        t.act(p.id, "bet", randomInt(10, Math.min(500, legal.max) + 1));
      else t.act(p.id, legal.actions[randomInt(legal.actions.length)]);
      balanced(t, total);
      assert.equal(
        t.cards.length +
          t.discards.length +
          t.dealerCards.length +
          t.players.reduce(
            (n, p) => n + p.hands.reduce((m, h) => m + h.cards.length, 0),
            0,
          ),
        312,
      );
    }
    assert.equal(t.houseNet - before, t.roundHouseNet);
    assert.equal(t.result.reduce((n, r) => n + r.net, 0) + t.roundHouseNet, 0);
    for (const p of t.players)
      for (const h of p.hands) assert.ok(h.done && h.settled);
  }
});
