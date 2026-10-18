import test from "node:test";
import assert from "node:assert/strict";
import { Table, deck, evaluate } from "../server/poker.js";

const parse = (text) =>
  text
    .split(" ")
    .map((s) => ({ rank: "23456789TJQKA".indexOf(s[0]) + 2, suit: s[1] }));
function table(n = 3) {
  const t = new Table();
  for (let i = 0; i < n; i++) t.addPlayer(`玩家${i}`);
  return t;
}
function act(t, type, amount) {
  t.act(t.players[t.turn].id, type, amount);
}
function checkThrough(t) {
  let guard = 100;
  while (t.playing && guard--)
    act(t, t.legal(t.players[t.turn].id).toCall ? "call" : "check");
  assert.ok(guard > 0);
}

test("洗牌得到 52 张不同的牌", () => {
  const cards = deck();
  assert.equal(cards.length, 52);
  assert.equal(new Set(cards.map((c) => `${c.rank}${c.suit}`)).size, 52);
});
test("识别所有九种牌型及 A2345 顺子", () => {
  [
    "As Jd 9c 7h 4d",
    "As Ad 9c 7h 4d",
    "As Ad 9c 9h 4d",
    "As Ad Ac 7h 4d",
    "As 2d 3c 4h 5d",
    "As Js 9s 7s 4s",
    "As Ad Ac 7h 7d",
    "As Ad Ac Ah 4d",
    "As Ks Qs Js Ts",
  ].forEach((s, i) => assert.equal(evaluate(parse(s)).category, i));
  assert.ok(
    evaluate(parse("2s 3s 4d 5h 6c")).score >
      evaluate(parse("As 2s 3d 4h 5c")).score,
  );
});
test("七张选最佳五张，正确比较踢脚和双三条葫芦", () => {
  assert.equal(evaluate(parse("As Ad Ac Ks Kd Kc 2s")).category, 6);
  assert.ok(
    evaluate(parse("As Ad Kh Qc 7s 3d 2s")).score >
      evaluate(parse("As Ad Jh Qc 7s 3d 2s")).score,
  );
  assert.equal(evaluate(parse("As Ks Qs Js Ts 2h 3h")).name, "同花顺");
});
test("单挑庄家小盲先行动，翻牌后大盲先行动", () => {
  const t = table(2);
  t.start();
  assert.equal(t.sb, t.dealer);
  assert.equal(t.turn, t.dealer);
  act(t, "call");
  act(t, "check");
  assert.equal(t.stage, "flop");
  assert.equal(t.turn, t.bb);
  checkThrough(t);
  assert.equal(t.stage, "showdown");
  assert.equal(
    t.players.reduce((n, p) => n + p.stack, 0),
    20000,
  );
});
test("多人大盲有过牌机会；轮转庄位；非法动作不扣钱", () => {
  const t = table();
  t.start();
  act(t, "call");
  act(t, "call");
  assert.equal(t.turn, t.bb);
  assert.equal(t.stage, "preflop");
  act(t, "check");
  assert.equal(t.stage, "flop");
  const stack = t.players[t.turn].stack;
  assert.throws(() => act(t, "raise", 25));
  assert.equal(t.players[t.turn].stack, stack);
  assert.throws(() => t.act(t.players[(t.turn + 1) % 3].id, "fold"));
  checkThrough(t);
  const dealer = t.dealer;
  t.start();
  assert.equal(t.dealer, (dealer + 1) % 3);
});
test("全体弃牌直接结算，退回未跟注部分", () => {
  const t = table();
  t.start();
  act(t, "raise", 1000);
  act(t, "fold");
  act(t, "fold");
  assert.equal(t.stage, "showdown");
  assert.equal(t.board.length, 0);
  assert.equal(t.players[0].stack, 10150);
  assert.ok(t.pots.some((p) => p.refund));
});
test("短码全下不重开加注；未行动玩家仍可加注", () => {
  const t = table();
  t.players[1].stack = 150;
  t.start();
  act(t, "call");
  act(t, "allin");
  assert.equal(t.legal(t.players[t.turn].id).canRaise, true);
  act(t, "call");
  assert.equal(t.legal(t.players[t.turn].id).canRaise, false);
  assert.throws(() => act(t, "raise", 300));
  act(t, "call");
  assert.equal(t.stage, "flop");
});
test("完整加注重新开放下注", () => {
  const t = table();
  t.start();
  act(t, "call");
  act(t, "raise", 300);
  act(t, "call");
  assert.equal(t.legal(t.players[t.turn].id).canRaise, true);
  assert.equal(t.legal(t.players[t.turn].id).min, 500);
});
test("全下自动发完公共牌，短码只获得有资格的主池", () => {
  const t = table();
  t.players.forEach((p, i) => (p.stack = [100, 200, 300][i]));
  t.start();
  t.players[0].cards = parse("As Ad");
  t.players[1].cards = parse("Ks Kd");
  t.players[2].cards = parse("Qs Qd");
  t.cards = parse("2s 3d 4h 7s 8c 9d Tc Jh");
  act(t, "allin");
  act(t, "allin");
  act(t, "allin");
  assert.equal(t.stage, "showdown");
  assert.equal(t.board.length, 5);
  assert.deepEqual(
    t.players.map((p) => p.stack),
    [300, 200, 100],
  );
  assert.equal(t.pots.length, 3);
});
test("相同牌型分池，奇数筹码从庄家左手起分配", () => {
  const t = table(3);
  t.dealer = 0;
  t.hand = 1;
  t.board = parse("As Ks Qs Js Ts");
  t.players.forEach((p, i) => {
    p.inHand = true;
    p.cards = parse(i === 0 ? "2c 3c" : i === 1 ? "4c 5c" : "6c 7c");
    p.total = 1;
    p.stack = 0;
  });
  t.players[0].folded = true;
  t.finish(true);
  assert.deepEqual(
    t.players.map((p) => p.stack),
    [0, 2, 1],
  );
});
test("底牌只对本人公开，弃牌者在摊牌后仍保密", () => {
  const t = table();
  t.start();
  const id = t.players[0].id;
  assert.ok(t.view(id).players[0].cards.every(Boolean));
  assert.deepEqual(t.view(id).players[1].cards, [null, null]);
  act(t, "fold");
  checkThrough(t);
  assert.deepEqual(t.view(t.players[1].id).players[0].cards, [null, null]);
  assert.ok(t.view(t.players[1].id).players[2].cards.every(Boolean));
  assert.equal(JSON.stringify(t.view(id)).includes("token"), false);
});
test("中途加入从下一手参与", () => {
  const t = table(2);
  t.start();
  const p = t.addPlayer("后来者");
  assert.equal(p.inHand, false);
  checkThrough(t);
  t.start();
  assert.equal(p.inHand, true);
});
test("离桌仍保留全下玩家的底池资格", () => {
  const t = table(3);
  t.players[0].stack = 100;
  t.start();
  act(t, "allin");
  t.remove(t.players[0].id);
  assert.equal(t.players[0].folded, false);
  checkThrough(t);
  assert.equal(
    t.players.reduce((n, p) => n + p.stack, 0),
    20100,
  );
});
test("非当前行动者离桌，在轮到自己时弃牌，边池不会失去资格玩家", () => {
  const t = table();
  t.players[0].stack = 100;
  t.start();
  act(t, "allin");
  act(t, "raise", 200);
  act(t, "call");
  assert.equal(t.stage, "flop");
  assert.equal(t.turn, 1);
  t.remove(t.players[2].id);
  assert.equal(t.players[2].folded, false);
  act(t, "fold");
  assert.equal(t.stage, "showdown");
  assert.equal(
    t.players.reduce((n, p) => n + p.stack, 0),
    20100,
  );
  const q = table();
  q.start();
  q.remove(q.players[1].id);
  act(q, "call");
  assert.equal(q.players[1].folded, true);
  assert.equal(q.turn, 2);
});
test("随机牌局保持筹码守恒，最终均能结束", () => {
  for (let game = 0; game < 100; game++) {
    const t = table(2 + (game % 7));
    t.players.forEach((p, i) => (p.stack = 75 + ((game * 13 + i * 97) % 1500)));
    const total = t.players.reduce((n, p) => n + p.stack, 0);
    t.start();
    let steps = 0;
    while (t.playing && steps++ < 200) {
      const legal = t.legal(t.players[t.turn].id);
      const r = Math.random();
      if (r < 0.15) act(t, "fold");
      else if (r < 0.3 && (legal.canRaise || legal.max <= t.currentBet))
        act(t, "allin");
      else act(t, legal.toCall ? "call" : "check");
    }
    assert.equal(t.stage, "showdown");
    assert.equal(
      t.players.reduce((n, p) => n + p.stack, 0),
      total,
    );
    assert.ok(t.players.every((p) => p.stack >= 0));
  }
});
