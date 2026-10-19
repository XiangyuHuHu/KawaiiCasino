import test from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import {
  DoudizhuTable,
  deck,
  classify,
  combinations,
  beats,
  legalMoves,
} from "../server/games/doudizhu.js";

function cards(ranks) {
  const available = deck();
  return ranks.map((rank) => {
    const index = available.findIndex((c) => c.rank === rank);
    assert.ok(index >= 0, `fixture exceeds rank ${rank}`);
    return available.splice(index, 1)[0];
  });
}
function table(stack = 1000) {
  const t = new DoudizhuTable({ stack });
  for (let i = 0; i < 3; i++)
    t.addPlayer(`玩家${i}`, {
      bot: i > 0,
      token: "secret",
      socketId: "private",
    });
  t.nextFirstBidder = 0;
  t.start();
  return t;
}
function act(t, type, input = {}) {
  t.action(t.players[t.turn].id, { type, ...input });
}
function balanced(t, total) {
  assert.equal(
    t.players.reduce((sum, p) => sum + p.stack, 0),
    total,
  );
  for (const p of t.players)
    assert.ok(Number.isSafeInteger(p.stack) && p.stack >= 0);
}
function accounted(t) {
  const all = [
    ...t.players.flatMap((p) => p.cards),
    ...t.played,
    ...(t.stage === "bidding" ? t.bottom : []),
  ];
  assert.equal(all.length, 54);
  assert.equal(new Set(all.map((c) => c.id)).size, 54);
  assert.deepEqual(
    all.map((c) => c.id).sort(),
    deck()
      .map((c) => c.id)
      .sort(),
  );
}
const examples = [
  ["single", [3], [4]],
  ["pair", [3, 3], [4, 4]],
  ["triple", [3, 3, 3], [4, 4, 4]],
  ["tripleSingle", [3, 3, 3, 17], [4, 4, 4, 3]],
  ["triplePair", [3, 3, 3, 15, 15], [4, 4, 4, 3, 3]],
  ["straight", [3, 4, 5, 6, 7], [4, 5, 6, 7, 8]],
  ["pairStraight", [3, 3, 4, 4, 5, 5], [4, 4, 5, 5, 6, 6]],
  ["plane", [3, 3, 3, 4, 4, 4], [4, 4, 4, 5, 5, 5]],
  ["planeSingle", [3, 3, 3, 4, 4, 4, 8, 8], [4, 4, 4, 5, 5, 5, 16, 17]],
  ["planePair", [3, 3, 3, 4, 4, 4, 8, 8, 9, 9], [4, 4, 4, 5, 5, 5, 8, 8, 9, 9]],
  ["fourSingle", [3, 3, 3, 3, 8, 8], [4, 4, 4, 4, 16, 17]],
  ["fourPair", [3, 3, 3, 3, 8, 8, 9, 9], [4, 4, 4, 4, 8, 8, 9, 9]],
  ["bomb", [3, 3, 3, 3], [4, 4, 4, 4]],
];
for (const [type, low, high] of examples) {
  test(`牌型 ${type}：识别、主体比较、同牌不压、生成合法应牌`, () => {
    const a = classify(cards(low)),
      b = classify(cards(high));
    assert.equal(a.type, type);
    assert.equal(b.type, type);
    assert.ok(beats(b, a));
    assert.equal(beats(a, b), false);
    assert.equal(beats(a, a), false);
    assert.ok(beats(a, null));
    const moves = legalMoves(cards(high), a);
    assert.ok(moves.some((m) => m.type === type && m.count === high.length));
    assert.equal(
      legalMoves(cards(low), b).filter((m) => m.type === type).length,
      0,
    );
    // Validate the exact selection through the authoritative action path too.
    const t = table();
    act(t, "bid", { amount: 3 });
    t.players[0].cards = cards([...low, 15]);
    t.lastPlay = { playerIndex: 2, combo: b };
    const before = JSON.stringify(t.view(t.players[0].id));
    assert.throws(() =>
      act(t, "play", {
        cards: t.players[0].cards.slice(0, low.length).map((c) => c.id),
      }),
    );
    assert.equal(JSON.stringify(t.view(t.players[0].id)), before);
    t.players[0].cards = cards([...high, 15]);
    t.lastPlay = { playerIndex: 2, combo: a };
    act(t, "play", {
      cards: t.players[0].cards.slice(0, high.length).map((c) => c.id),
    });
    assert.equal(t.lastPlay.combo.type, type);
    assert.equal(t.bombs, type === "bomb" ? 1 : 0);
    assert.equal(t.turn, 1);
  });
}

test("王炸、炸弹优先级、同型同长度，不同带牌不能互压", () => {
  const rocket = classify(cards([16, 17]));
  const bomb = classify(cards([3, 3, 3, 3]));
  assert.equal(rocket.type, "rocket");
  for (const [, ranks] of examples) {
    const combo = classify(cards(ranks));
    assert.ok(beats(rocket, combo));
    assert.equal(beats(combo, rocket), false);
    if (combo.type !== "bomb") assert.ok(beats(bomb, combo));
  }
  assert.equal(beats(rocket, rocket), false);
  assert.equal(
    beats(
      classify(cards([4, 5, 6, 7, 8, 9])),
      classify(cards([3, 4, 5, 6, 7])),
    ),
    false,
  );
  assert.equal(
    beats(classify(cards([4, 4, 4, 3, 3])), classify(cards([3, 3, 3, 4]))),
    false,
  );
  const t = table();
  act(t, "bid", { amount: 3 });
  t.players[0].cards = cards([16, 17, 3]);
  act(t, "play", { cards: t.players[0].cards.slice(0, 2).map((c) => c.id) });
  assert.equal(t.rockets, 1);
  assert.equal(t.bombs, 0);
});

test("非法组合：含 2 / 王的连续牌、短顺、错翅膀、主体与翅膀重复", () => {
  for (const ranks of [
    [],
    [3, 4],
    [3, 4, 5, 6],
    [11, 12, 13, 14, 15],
    [12, 13, 14, 15, 16],
    [14, 14, 15, 15, 16, 17],
    [3, 3, 4, 4],
    [3, 3, 3, 5, 5, 5],
    [3, 3, 3, 4, 4, 4, 4, 8],
    [3, 3, 3, 4, 4, 4, 8, 8, 8, 8],
    [3, 3, 3, 3, 8, 9, 10, 10],
  ]) {
    assert.equal(classify(cards(ranks)), null, ranks.join(","));
    const t = table();
    act(t, "bid", { amount: 3 });
    t.players[0].cards = cards(ranks);
    const before = JSON.stringify(t.view(t.players[0].id));
    assert.throws(() =>
      act(t, "play", { cards: t.players[0].cards.map((c) => c.id) }),
    );
    assert.equal(JSON.stringify(t.view(t.players[0].id)), before);
  }
  assert.equal(classify(null), null);
  assert.equal(classify([{ rank: 18 }]), null);
  assert.equal(classify(Array(5).fill({ rank: 3 })), null);
  assert.equal(classify(cards([10, 11, 12, 13, 14])).type, "straight");
  assert.equal(classify(cards([13, 13, 13, 14, 14, 14])).type, "plane");
  const ambiguous = cards([3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6]);
  assert.equal(classify(ambiguous).type, "plane");
  assert.ok(
    combinations(ambiguous).some(
      (c) => c.type === "planeSingle" && c.main === 6,
    ),
  );
  const t = table();
  act(t, "bid", { amount: 3 });
  t.players[0].cards = [...ambiguous, ...cards([15])];
  t.lastPlay = {
    playerIndex: 2,
    combo: classify(cards([3, 3, 3, 4, 4, 4, 5, 5, 5, 8, 9, 10])),
  };
  act(t, "play", { cards: ambiguous.map((c) => c.id) });
  assert.equal(t.lastPlay.combo.type, "planeSingle");
  assert.equal(t.lastPlay.combo.main, 6);
});

test("54 张牌完整发放、17×3+3、地主20张、手牌和凭证隐私", () => {
  const d = deck();
  assert.equal(d.length, 54);
  assert.equal(new Set(d.map((c) => c.id)).size, 54);
  for (let rank = 3; rank <= 17; rank++)
    assert.equal(d.filter((c) => c.rank === rank).length, rank >= 16 ? 1 : 4);
  const t = table();
  assert.deepEqual(
    t.players.map((p) => p.cards.length),
    [17, 17, 17],
  );
  assert.equal(t.bottom.length, 3);
  accounted(t);
  const view = t.view(t.players[0].id);
  assert.ok(view.players[0].cards.every(Boolean));
  assert.ok(view.players[1].cards.every((c) => c === null));
  assert.deepEqual(view.bottom, [null, null, null]);
  assert.equal(view.players[0].token, undefined);
  assert.equal(view.players[0].socketId, undefined);
  assert.equal(view.played, undefined);
  act(t, "bid", { amount: 3 });
  assert.equal(t.stage, "playing");
  assert.equal(t.landlord, 0);
  assert.deepEqual(
    t.players.map((p) => p.cards.length),
    [20, 17, 17],
  );
  assert.ok(t.view(t.players[1].id).bottom.every(Boolean));
  assert.ok(t.view(t.players[1].id).players[0].cards.every((c) => c === null));
  accounted(t);
});

test("叫分顺序、只叫一次、更高分、3分立即结束及首叫轮转", () => {
  const t = table();
  assert.equal(t.legal(t.players[1].id), null);
  assert.throws(() => t.action(t.players[1].id, { type: "bid", amount: 1 }));
  act(t, "bid", { amount: 1 });
  for (const bad of [1, -1, 4, 1.5, "2", null, NaN, Infinity]) {
    const snapshot = JSON.stringify(t.view(t.players[1].id));
    assert.throws(() => act(t, "bid", { amount: bad }));
    assert.equal(JSON.stringify(t.view(t.players[1].id)), snapshot);
  }
  act(t, "bid", { amount: 2 });
  act(t, "bid", { amount: 0 });
  assert.equal(t.landlord, 1);
  assert.equal(t.bid, 2);
  assert.equal(t.turn, 1);
  assert.deepEqual(
    t.players.map((p) => p.bid),
    [1, 2, 0],
  );
  while (t.playing) t.automaticAction(t.players[t.turn].id, true);
  t.start();
  assert.equal(t.firstBidder, 1);
  act(t, "bid", { amount: 3 });
  assert.equal(t.stage, "playing");
  assert.equal(t.bidCount, 1);
});

test("全不叫最多重发三次，第四轮强制首叫者为1分地主", () => {
  const t = table();
  for (let i = 0; i < 12; i++) {
    assert.equal(t.stage, "bidding");
    act(t, "bid", { amount: 0 });
    accounted(t);
    balanced(t, 3000);
  }
  assert.equal(t.stage, "playing");
  assert.equal(t.redeals, 3);
  assert.equal(t.landlord, t.firstBidder);
  assert.equal(t.bid, 1);
  assert.equal(t.hand, 1);
  assert.equal(t.turn, t.landlord);
});

test("非法行动原子拒绝、领出不能过、两次不出后原出牌者自由领出", () => {
  const t = table();
  act(t, "bid", { amount: 3 });
  const p = t.players[0];
  const bad = [
    { type: "pass" },
    { type: "bid", amount: 3 },
    { type: "play", cards: [] },
    { type: "play", cards: "s3" },
    { type: "play", cards: [p.cards[0].id, p.cards[0].id] },
    { type: "play", cards: [t.players[1].cards[0].id] },
    { type: "play", cards: [null] },
    { type: "play", cards: Array(21).fill("s3") },
  ];
  for (const input of bad) {
    const before = JSON.stringify(t.view(p.id));
    assert.throws(() => t.action(p.id, input));
    assert.equal(JSON.stringify(t.view(p.id)), before);
  }
  act(t, "play", { cards: [p.cards[0].id] });
  assert.equal(t.turn, 1);
  assert.throws(() => t.action(p.id, { type: "pass" }));
  act(t, "pass");
  assert.equal(t.turn, 2);
  act(t, "pass");
  assert.equal(t.turn, 0);
  assert.equal(t.lastPlay, null);
  assert.equal(t.passes, 0);
  act(t, "play", { cards: [p.cards[0].id] });
  accounted(t);
});

for (const [
  winner,
  landlordCount,
  farmerCount,
  bombs,
  rockets,
  expectedSpring,
  score,
] of [
  [0, 1, 0, 0, 0, "春天", 20],
  [0, 2, 1, 0, 0, null, 10],
  [1, 1, 1, 0, 0, "反春", 20],
  [1, 2, 1, 0, 0, null, 10],
  [0, 1, 0, 2, 1, "春天", 160],
  [1, 1, 1, 1, 1, "反春", 80],
]) {
  test(`结算：${winner === 0 ? "地主" : "农民"}胜 / ${expectedSpring} / 炸弹${bombs}王炸${rockets}`, () => {
    const t = table();
    act(t, "bid", { amount: 1 });
    act(t, "bid", { amount: 0 });
    act(t, "bid", { amount: 0 });
    t.players.forEach((p, i) => {
      p.playCount = i === 0 ? landlordCount : farmerCount;
    });
    t.bombs = bombs;
    t.rockets = rockets;
    t.finish(winner);
    assert.equal(t.score, score);
    assert.equal(t.spring, expectedSpring);
    assert.deepEqual(
      t.result.map((r) => r.net),
      winner === 0 ? [score * 2, -score, -score] : [-score * 2, score, score],
    );
    assert.equal(
      t.result.reduce((sum, r) => sum + r.net, 0),
      0,
    );
    assert.equal(t.turn, -1);
    assert.equal(t.deadline, null);
    assert.ok(
      t.view(t.players[0].id).players.every((p) => p.cards.every(Boolean)),
    );
    balanced(t, 3000);
  });
}

test("余额封顶：农民独立付款、地主不足则均分，奇数按座位，零筹码不透支", () => {
  for (const [winner, stacks, expected] of [
    [0, [100, 3, 100], [113, 0, 90]],
    [1, [15, 100, 100], [0, 108, 107]],
    [1, [0, 100, 100], [0, 100, 100]],
    [1, [100, 100, 100], [80, 110, 110]],
  ]) {
    const t = table();
    act(t, "bid", { amount: 3 });
    t.bid = 1;
    t.players.forEach((p, i) => {
      p.stack = stacks[i];
      p.playCount = 2;
    });
    t.finish(winner);
    assert.deepEqual(
      t.players.map((p) => p.stack),
      expected,
    );
    balanced(
      t,
      stacks.reduce((a, b) => a + b, 0),
    );
  }
});

test("三席、10筹码门槛、补码、超时安全动作与离桌保留本手", () => {
  const t = new DoudizhuTable({ stack: 9, actionTimeout: 50 });
  t.addPlayer("甲");
  assert.throws(() => t.start());
  t.addPlayer("乙");
  t.addPlayer("丙");
  assert.throws(() => t.start());
  assert.throws(() => t.addPlayer("丁"));
  t.players.forEach((p) => {
    p.stack = 10;
  });
  t.nextFirstBidder = 0;
  t.start();
  t.automaticAction(t.players[0].id, false);
  assert.equal(t.players[0].bid, 0);
  act(t, "bid", { amount: 3 });
  assert.throws(() => t.start());
  const leader = t.players[t.turn],
    smallest = leader.cards[0].id;
  assert.ok(t.deadline >= Date.now());
  t.automaticAction(leader.id, false);
  assert.equal(t.lastPlay.cards[0].id, smallest);
  t.automaticAction(t.players[t.turn].id, false);
  assert.equal(t.passes, 1);
  const leaving = t.players[t.turn];
  t.remove(leaving.id);
  t.prune();
  assert.equal(t.players.length, 3);
  assert.equal(t.turn, 1);
  let steps = 0;
  while (t.playing) {
    assert.ok(++steps < 200);
    t.automaticAction(t.players[t.turn].id, true);
  }
  assert.equal(t.result.length, 3);
  t.prune();
  assert.equal(t.players.length, 2);
  assert.throws(() => t.start());
});

test("500局随机混合策略、超时和机器人：每手终止，每步54张不重不漏、整数余额守恒", () => {
  const t = table(100);
  let total = 300;
  for (let round = 0; round < 500; round++) {
    if (round) {
      for (const p of t.players)
        if (p.stack < 10) {
          total += 100 - p.stack;
          p.stack = 100;
        }
      t.start();
    }
    let steps = 0;
    while (t.playing) {
      assert.ok(++steps < 200, `round ${round} failed to terminate`);
      const p = t.players[t.turn];
      if (round % 3 === 0 && t.stage === "playing") {
        const moves = legalMoves(p.cards, t.lastPlay?.combo);
        if (t.lastPlay && (!moves.length || randomInt(3) === 0)) act(t, "pass");
        else act(t, "play", { cards: moves[randomInt(moves.length)].cards });
      } else t.automaticAction(p.id, p.bot || round % 2 === 0);
      accounted(t);
      balanced(t, total);
      if (t.playing) {
        const view = t.view(t.players[0].id);
        assert.ok(
          view.players.slice(1).every((p) => p.cards.every((c) => c === null)),
        );
      }
    }
    assert.equal(
      t.result.reduce((n, r) => n + r.net, 0),
      0,
    );
    assert.ok(t.players.some((p) => p.cards.length === 0));
    assert.equal(
      t.result.filter((r) => r.won).length,
      t.result[t.landlord].won ? 1 : 2,
    );
    assert.throws(() => t.action(t.players[0].id, { type: "assist" }));
  }
});

test("结算幂等，离桌清理后地主席位和阵营仍正确，补位可开始下一手", () => {
  const t = table();
  act(t, "bid", { amount: 0 });
  act(t, "bid", { amount: 0 });
  act(t, "bid", { amount: 3 });
  t.finish(2);
  const stacks = t.players.map((p) => p.stack);
  t.finish(2);
  assert.deepEqual(
    t.players.map((p) => p.stack),
    stacks,
  );
  t.remove(t.players[0].id);
  t.prune();
  assert.equal(t.landlord, 1);
  assert.equal(t.view(t.players[0].id).players[1].role, "地主");
  t.remove(t.players[1].id);
  t.prune();
  assert.equal(t.landlord, -1);
  assert.equal(t.view(t.players[0].id).players[0].role, "农民");
  t.addPlayer("补位甲");
  t.addPlayer("补位乙");
  t.start();
  assert.equal(t.stage, "bidding");
  accounted(t);
});
