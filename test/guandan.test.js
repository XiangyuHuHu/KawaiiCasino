import test from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import {
  GuandanTable,
  deck,
  classify,
  combinations,
  beats,
  legalMoves,
  rankValue,
  upgradeFor,
} from "../server/games/guandan.js";

function cards(ranks, level = 2) {
  const pool = deck().sort((a, b) => a.id.localeCompare(b.id));
  return ranks.map((rank, i) => {
    const candidates = pool.filter((c) => c.rank === rank);
    const natural = candidates.filter(
      (c) => !(c.rank === level && c.suit === "h"),
    );
    const available = natural.length ? natural : candidates;
    const card =
      available.find((c) => c.suit === ["s", "d", "c", "h"][i % 4]) ||
      available[0];
    assert.ok(card, `too many ${rank}`);
    pool.splice(pool.indexOf(card), 1);
    return card;
  });
}
const physical = (...ids) =>
  ids.map((id) => {
    const c = deck().find((c) => c.id === id);
    assert.ok(c, id);
    return c;
  });
function table(stack = 1000) {
  const t = new GuandanTable({ stack });
  for (let i = 0; i < 4; i++)
    t.addPlayer(`玩家${i}`, {
      bot: i > 0,
      token: "secret",
      socketId: "private",
    });
  t.start();
  return t;
}
const act = (t, type, input = {}) =>
  t.action(t.players[t.turn].id, { type, ...input });
const playAll = (t) =>
  act(t, "play", { cards: t.players[t.turn].cards.map((c) => c.id) });
function balanced(t, total) {
  assert.equal(
    t.players.reduce((n, p) => n + p.stack, 0),
    total,
  );
  assert.ok(
    t.players.every((p) => Number.isSafeInteger(p.stack) && p.stack >= 0),
  );
}
function accounted(t) {
  const all = [...t.played, ...t.players.flatMap((p) => p.cards)];
  assert.equal(all.length, 108);
  assert.equal(new Set(all.map((c) => c.id)).size, 108);
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
  ["triplePair", [3, 3, 3, 6, 6], [4, 4, 4, 5, 5]],
  ["straight", [14, 2, 3, 4, 5], [2, 3, 4, 5, 6]],
  ["pairStraight", [2, 2, 3, 3, 4, 4], [3, 3, 4, 4, 5, 5]],
  ["plate", [3, 3, 3, 4, 4, 4], [4, 4, 4, 5, 5, 5]],
  ["bomb", [3, 3, 3, 3], [4, 4, 4, 4]],
];
for (const [type, low, high] of examples) {
  test(`${type}：识别、比较、合法动作生成及服务端应牌校验`, () => {
    const a = classify(cards(low)),
      b = classify(cards(high));
    assert.equal(a.type, type);
    assert.equal(b.type, type);
    assert.ok(beats(b, a));
    assert.equal(beats(a, b), false);
    assert.equal(beats(a, a), false);
    assert.ok(beats(a, null));
    assert.ok(
      legalMoves(cards(high), a).some(
        (m) => m.type === type && m.count === high.length,
      ),
    );
    assert.equal(
      legalMoves(cards(low), b).filter((m) => m.type === type).length,
      0,
    );
    const t = table();
    t.players[0].cards = [...cards(low), ...cards([17])];
    t.lastPlay = { playerIndex: 3, combo: b };
    const before = JSON.stringify(t.view(t.players[0].id));
    assert.throws(() =>
      act(t, "play", {
        cards: t.players[0].cards.slice(0, low.length).map((c) => c.id),
      }),
    );
    assert.equal(JSON.stringify(t.view(t.players[0].id)), before);
    t.players[0].cards = [...cards(high), ...cards([17])];
    t.lastPlay = { playerIndex: 3, combo: a };
    act(t, "play", {
      cards: t.players[0].cards.slice(0, high.length).map((c) => c.id),
    });
    assert.equal(t.lastPlay.combo.type, type);
    assert.equal(t.turn, 1);
  });
}

test("108张双副牌：每人27张、无重复、级牌与伙伴手牌均保密", () => {
  const d = deck();
  assert.equal(d.length, 108);
  assert.equal(new Set(d.map((c) => c.id)).size, 108);
  for (const rank of [...Array.from({ length: 13 }, (_, i) => i + 2), 16, 17])
    assert.equal(d.filter((c) => c.rank === rank).length, rank >= 16 ? 2 : 8);
  const t = table();
  assert.deepEqual(
    t.players.map((p) => p.cards.length),
    [27, 27, 27, 27],
  );
  assert.deepEqual(
    t.players.map((p) => p.seat % 2),
    [0, 1, 0, 1],
  );
  accounted(t);
  const view = t.view(t.players[0].id);
  assert.ok(view.players[0].cards.every(Boolean));
  assert.ok(
    view.players.slice(1).every((p) => p.cards.every((c) => c === null)),
  );
  assert.ok(
    t.view("spectator").players.every((p) => p.cards.every((c) => c === null)),
  );
  assert.equal(view.players[0].token, undefined);
  assert.equal(view.players[0].socketId, undefined);
  assert.equal(view.played, undefined);
  view.teamLevels[0] = 14;
  assert.equal(t.teamLevels[0], 2);
});

test("级牌只在单/对/三/炸及三带二主体中提升，连续牌按原点数", () => {
  for (const level of [2, 5, 14]) {
    assert.equal(rankValue(level, level), 15);
    assert.ok(
      beats(
        classify(cards([level], level), level),
        classify(cards([13], level), level),
      ),
    );
    assert.ok(
      beats(
        classify(cards([16]), level),
        classify(cards([level], level), level),
      ),
    );
    assert.ok(
      beats(classify(cards([17]), level), classify(cards([16]), level)),
    );
    for (const count of [2, 3, 4, 8]) {
      const lower = Array(count).fill(level === 14 ? 13 : 14);
      assert.ok(
        beats(
          classify(cards(Array(count).fill(level), level), level),
          classify(cards(lower, level), level),
        ),
      );
    }
  }
  const straight = classify(cards([3, 4, 5, 6, 7], 5), 5);
  assert.equal(straight.main, 7);
  assert.equal(classify(cards([10, 11, 12, 13, 14])).main, 14);
  assert.equal(classify(cards([14, 2, 3, 4, 5])).main, 5);
  assert.equal(classify(cards([14, 14, 2, 2, 3, 3])).type, "pairStraight");
  assert.equal(classify(cards([14, 14, 14, 2, 2, 2])).type, "plate");
  assert.equal(classify(cards([16, 16])).type, "pair");
  assert.equal(classify(cards([4, 4, 4, 17, 17])).type, "triplePair");
});

test("逢人配：各普通牌型、双配、同花顺及8张炸，最高合法解释，不可替王", () => {
  const wilds = physical("0-h2", "1-h2");
  const fixtures = [
    ["single", [], 1],
    ["pair", [7], 1],
    ["triple", [7], 2],
    ["triplePair", [7, 7, 8], 2],
    ["straight", [3, 4, 6, 7], 1],
    ["pairStraight", [3, 3, 4, 5], 2],
    ["plate", [3, 3, 4, 4], 2],
    ["bomb", [7, 7, 7, 7, 7, 7], 2],
  ];
  for (const [type, natural, count] of fixtures) {
    const cs = [...cards(natural), ...wilds.slice(0, count)];
    assert.ok(
      combinations(cs).some((c) => c.type === type),
      type,
    );
    const move = legalMoves(cs, { type, main: 0, count: cs.length }).find(
      (m) => m.type === type && m.count === cs.length,
    );
    assert.ok(move, `generate ${type}`);
  }
  const flush = [...physical("0-s3", "0-s4", "0-s6"), ...wilds];
  assert.equal(classify(flush).type, "straightFlush");
  assert.equal(classify(flush).main, 7);
  const ambiguous = [...cards([7, 7, 7]), ...wilds];
  assert.equal(classify(ambiguous).type, "bomb");
  assert.ok(combinations(ambiguous).some((c) => c.type === "triplePair"));
  assert.equal(classify(wilds).main, 15);
  assert.equal(
    classify([...physical("0-j16", "0-j17", "1-j17"), wilds[0]]),
    null,
  );
  assert.equal(classify([...physical("0-j17"), ...wilds]), null);
  assert.equal(classify([...physical("0-j16"), wilds[0]]), null);
  // A non-heart level card is never a wild.
  assert.equal(classify(physical("0-s2", "0-s7")), null);
  const t = table();
  t.players[0].cards = [...ambiguous, ...cards([17])];
  act(t, "play", { cards: ambiguous.map((c) => c.id) });
  assert.equal(t.lastPlay.combo.type, "bomb");
});

test("炸弹4..8张优先于点数，同花顺夹在5/6张炸之间，天王炸最大", () => {
  let prev = classify(cards([17]));
  for (const count of [4, 5, 6, 7, 8]) {
    const c = classify(cards(Array(count).fill(3)));
    assert.equal(c.type, "bomb");
    assert.equal(c.count, count);
    assert.ok(beats(c, prev));
    prev = c;
  }
  const flush = classify(physical("0-s10", "0-s11", "0-s12", "0-s13", "0-s14"));
  assert.equal(flush.type, "straightFlush");
  assert.ok(beats(flush, classify(cards(Array(5).fill(2)))));
  assert.ok(beats(classify(cards(Array(6).fill(3))), flush));
  const rocket = classify(physical("0-j16", "1-j16", "0-j17", "1-j17"));
  assert.equal(rocket.type, "rocket");
  for (const c of [prev, flush, classify(cards(Array(8).fill(2)))]) {
    assert.ok(beats(rocket, c));
    assert.equal(beats(c, rocket), false);
  }
  assert.equal(beats(rocket, rocket), false);
  const lowerFlush = classify(physical("0-d3", "0-d4", "0-d5", "0-d6", "0-d7"));
  assert.ok(beats(flush, lowerFlush));
  assert.equal(beats(flush, flush), false);
  assert.ok(
    legalMoves(physical("0-j16", "1-j16", "0-j17", "1-j17"), prev).some(
      (c) => c.type === "rocket",
    ),
  );
});

test("非法长度、循环、王顺子、不同牌型、重复或他人手牌均原子拒绝", () => {
  for (const rs of [
    [],
    [3, 4],
    [3, 4, 5, 6],
    [3, 4, 5, 6, 7, 8],
    [12, 13, 14, 2, 3],
    [13, 14, 16, 17, 2],
    [3, 3, 4, 4],
    [3, 3, 3, 5, 5, 5],
    [3, 3, 3, 4],
    [3, 3, 4, 4, 5, 5, 6, 6],
  ]) {
    const cs = cards(rs);
    assert.equal(classify(cs), null, rs.join(","));
    const t = table();
    t.players[0].cards = cs;
    const before = JSON.stringify(t.view(t.players[0].id));
    assert.throws(() => playAll(t));
    assert.equal(JSON.stringify(t.view(t.players[0].id)), before);
  }
  assert.equal(classify(null), null);
  assert.equal(classify([{ id: "bad", suit: "s", rank: 15 }]), null);
  assert.equal(classify(Array(4).fill(physical("0-s3")[0])), null);
  assert.equal(
    classify([0, 1, 2].map((i) => ({ id: String(i), rank: 3, suit: "s" }))),
    null,
  );
  assert.equal(beats(classify(cards([5, 5])), classify(cards([4]))), false);
  const t = table(),
    p = t.players[0];
  const bad = [
    null,
    { type: "pass" },
    { type: "bid" },
    { type: "play", cards: "x" },
    { type: "play", cards: [null] },
    { type: "play", cards: [p.cards[0].id, p.cards[0].id] },
    { type: "play", cards: [t.players[1].cards[0].id] },
    { type: "play", cards: Array(9).fill("x") },
  ];
  for (const input of bad) {
    const before = JSON.stringify(t.view(p.id));
    assert.throws(() => t.action(p.id, input));
    assert.equal(JSON.stringify(t.view(p.id)), before);
  }
  assert.equal(t.legal(t.players[1].id), null);
  assert.throws(() => t.action(t.players[1].id, { type: "assist" }));
});

test("轮次：三人不出后领出、跳过出完者、接风转给搭档、对手可先压牌", () => {
  const t = table();
  act(t, "play", { cards: [t.players[0].cards[0].id] });
  for (let i = 1; i <= 3; i++) {
    assert.equal(t.turn, i);
    act(t, "pass");
  }
  assert.equal(t.turn, 0);
  assert.equal(t.lastPlay, null);
  assert.equal(t.passes, 0);
  t.players[0].cards = cards([3]);
  t.players[1].cards = cards([4, 8]);
  t.players[2].cards = cards([6, 9]);
  t.players[3].cards = cards([5, 10]);
  playAll(t);
  assert.deepEqual(t.finishOrder, [0]);
  for (let i = 1; i <= 3; i++) {
    assert.equal(t.turn, i);
    act(t, "pass");
  }
  assert.equal(t.turn, 2);
  assert.equal(t.lastPlay, null);
  assert.match(t.history[0].text, /接风/);
  act(t, "play", { cards: [t.players[2].cards[0].id] });
  act(t, "pass");
  assert.equal(t.turn, 1); // finished seat 0 is skipped
  act(t, "pass");
  assert.equal(t.turn, 2);
  // A second fixture checks that playing out does not immediately grant partner the lead.
  const u = table();
  u.players[0].cards = cards([3]);
  u.players[1].cards = cards([4, 8]);
  playAll(u);
  act(u, "play", { cards: [u.players[1].cards[0].id] });
  act(u, "pass");
  act(u, "pass");
  assert.equal(u.turn, 1);
  assert.equal(u.lastPlay, null);
});

test("名次实际推进至第三人出完，第四名推定；搭档也出完时接风到下个有牌者", () => {
  const t = table();
  t.players.forEach((p, i) => {
    p.cards = cards(i === 3 ? [6, 9] : [i + 3]);
  });
  playAll(t);
  playAll(t); // seats 0 and 1 finish
  assert.deepEqual(t.finishOrder, [0, 1]);
  act(t, "pass");
  act(t, "pass");
  assert.equal(t.turn, 3); // seat 1's partner
  act(t, "play", { cards: [t.players[3].cards[0].id] });
  act(t, "pass");
  assert.equal(t.turn, 3);
  playAll(t);
  assert.equal(t.stage, "showdown");
  assert.deepEqual(t.finishOrder, [0, 1, 3, 2]);
  assert.equal(t.upgrade, 1);
  assert.equal(t.players[2].cards.length, 1);
  const u = table();
  u.players.forEach((p, i) => {
    p.cards = cards([i + 3]);
  });
  playAll(u);
  act(u, "pass");
  playAll(u); // 0 and 2 have finished
  act(u, "pass");
  act(u, "pass");
  assert.equal(u.turn, 3); // both leader and partner out; clockwise remaining seat
});

for (const [order, expected] of [
  [[0, 2, 1, 3], 3],
  [[0, 1, 2, 3], 2],
  [[0, 1, 3, 2], 1],
  [[3, 1, 0, 2], 3],
  [[1, 0, 3, 2], 2],
  [[1, 2, 0, 3], 1],
]) {
  test(`名次${order}升级${expected}：整数零和结算、封顶和幂等`, () => {
    const t = table();
    t.finishOrder = order;
    const { team, upgrade } = upgradeFor(order);
    assert.equal(upgrade, expected);
    t.finish();
    assert.equal(t.winningTeam, team);
    assert.equal(t.score, expected * 10);
    assert.deepEqual(
      t.result.map((r) => r.net),
      t.players.map((p) => (p.seat % 2 === team ? 1 : -1) * expected * 10),
    );
    assert.deepEqual(
      t.result.map((r) => r.place),
      t.players.map((p) => order.indexOf(p.seat) + 1),
    );
    assert.equal(t.teamLevels[team], 2 + expected);
    assert.equal(t.teamLevels[1 - team], 2);
    assert.equal(t.turn, -1);
    assert.equal(t.deadline, null);
    assert.ok(
      t.view(t.players[0].id).players.every((p) => p.cards.every(Boolean)),
    );
    balanced(t, 4000);
    const stacks = t.players.map((p) => p.stack);
    t.finish();
    assert.deepEqual(
      t.players.map((p) => p.stack),
      stacks,
    );
    assert.throws(() => act(t, "assist"));
  });
}

test("输家封顶、实收均分，奇数给前座赢家，零余额不透支", () => {
  for (const [order, stacks, expected] of [
    [
      [0, 2, 1, 3],
      [100, 3, 100, 100],
      [117, 0, 116, 70],
    ],
    [
      [1, 3, 0, 2],
      [0, 100, 1, 100],
      [0, 101, 0, 100],
    ],
    [
      [0, 1, 2, 3],
      [100, 0, 100, 0],
      [100, 0, 100, 0],
    ],
  ]) {
    const t = table();
    t.players.forEach((p, i) => {
      p.stack = stacks[i];
    });
    t.finishOrder = order;
    t.finish();
    assert.deepEqual(
      t.players.map((p) => p.stack),
      expected,
    );
    balanced(
      t,
      stacks.reduce((a, b) => a + b, 0),
    );
    assert.equal(
      t.result.reduce((n, r) => n + r.net, 0),
      0,
    );
  }
  assert.throws(() => upgradeFor([0, 1, 2]));
  assert.throws(() => upgradeFor([0, 0, 2, 3]));
});

test("跨手级牌跟随上手赢家的队伍，级别封顶A，A获胜仍可继续；头游先出", () => {
  const t = table();
  assert.equal(t.level, 2);
  for (const [order, levels, nextLevel] of [
    [[0, 2, 1, 3], [5, 2], 5],
    [[1, 0, 3, 2], [5, 4], 4],
    [[0, 2, 1, 3], [8, 4], 8],
    [[0, 2, 1, 3], [11, 4], 11],
    [[0, 2, 1, 3], [14, 4], 14],
    [[2, 0, 1, 3], [14, 4], 14],
  ]) {
    t.finishOrder = order;
    t.finish();
    assert.deepEqual(t.teamLevels, levels);
    t.start();
    assert.equal(t.level, nextLevel);
    assert.equal(t.players[t.turn].seat, order[0]);
    assert.equal(t.finishOrder.length, 0);
    accounted(t);
  }
});

test("四席门槛、最小筹码、超时默认、离桌保留和补位保持固定队伍", () => {
  const t = new GuandanTable({ stack: 9, actionTimeout: 50 });
  for (let i = 0; i < 3; i++) t.addPlayer(String(i));
  assert.throws(() => t.start());
  t.addPlayer("3");
  assert.throws(() => t.start());
  assert.throws(() => t.addPlayer("4"));
  t.players.forEach((p) => {
    p.stack = 100;
  });
  t.players[1].connected = false;
  assert.throws(() => t.start());
  t.players[1].connected = true;
  t.start();
  assert.throws(() => t.start());
  assert.throws(() => t.addPlayer("midhand"));
  assert.ok(t.deadline >= Date.now());
  const smallest = t.players[0].cards[0].id;
  t.automaticAction(t.players[0].id, false);
  assert.equal(t.lastPlay.cards[0].id, smallest);
  t.automaticAction(t.players[1].id, false);
  assert.equal(t.passes, 1);
  const partnerId = t.players[2].id;
  t.remove(t.players[0].id);
  t.prune();
  assert.equal(t.players.length, 4);
  for (let steps = 0; t.playing; steps++) {
    assert.ok(steps < 432);
    t.automaticAction(t.players[t.turn].id, true);
  }
  t.prune();
  assert.equal(t.players.length, 3);
  assert.equal(t.players.find((p) => p.id === partnerId).seat, 2);
  assert.throws(() => t.start());
  const replacement = t.addPlayer("补位");
  assert.equal(replacement.seat, 0);
  replacement.stack = 100; // Same explicit rebuy used for the original seats.
  assert.equal(
    t.view(partnerId).players.find((p) => p.id === partnerId).team,
    0,
  );
  t.start();
  accounted(t);
});

test("250局随机机器人/安全超时/随机合法动作：每步108张完整，整数筹码守恒且整手终止", () => {
  const t = table(100);
  let total = 400;
  for (let round = 0; round < 250; round++) {
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
      // Each successful play removes >=1 card and at most three passes precede
      // the next play, so no legal policy can exceed 4*108 actions.
      assert.ok(++steps <= 432, `round ${round} failed to terminate`);
      const p = t.players[t.turn];
      if (round % 3 === 0) {
        const moves = legalMoves(p.cards, t.lastPlay?.combo, t.level);
        if (t.lastPlay && (!moves.length || randomInt(3) === 0)) act(t, "pass");
        else act(t, "play", { cards: moves[randomInt(moves.length)].cards });
      } else t.automaticAction(p.id, round % 3 === 1 || p.bot);
      accounted(t);
      balanced(t, total);
      if (t.playing)
        assert.ok(
          t
            .view(t.players[0].id)
            .players.slice(1)
            .every((p) => p.cards.every((c) => c === null)),
        );
    }
    assert.equal(t.finishOrder.length, 4);
    assert.equal(new Set(t.finishOrder).size, 4);
    assert.equal(t.players.filter((p) => !p.cards.length).length, 3);
    assert.equal(
      t.result.reduce((n, r) => n + r.net, 0),
      0,
    );
    assert.equal(t.result.filter((r) => r.won).length, 2);
  }
});

test("服务端实出4–8张炸弹、同花顺及天王炸，弱炸与普通顺子不能越级", () => {
  const flush = physical("0-s3", "0-s4", "0-s5", "0-s6", "0-s7");
  const rocket = physical("0-j16", "1-j16", "0-j17", "1-j17");
  const chain = [
    ...[4, 5].map((n) => cards(Array(n).fill(14))),
    flush,
    ...[6, 7, 8].map((n) => cards(Array(n).fill(3))),
    rocket,
  ];
  let previous = classify(cards([17]));
  for (const selected of chain) {
    const t = table();
    t.players[0].cards = [...selected, ...physical("1-d10")];
    t.lastPlay = { playerIndex: 3, combo: previous };
    act(t, "play", { cards: selected.map((c) => c.id) });
    assert.ok(beats(t.lastPlay.combo, previous));
    assert.equal(t.turn, 1);
    previous = t.lastPlay.combo;
  }
  const t = table();
  t.lastPlay = { playerIndex: 3, combo: classify(flush) };
  for (const selected of [
    cards(Array(5).fill(2)),
    cards([10, 11, 12, 13, 14]),
  ]) {
    t.players[0].cards = selected;
    const before = JSON.stringify(t.view(t.players[0].id));
    assert.throws(() => playAll(t));
    assert.equal(JSON.stringify(t.view(t.players[0].id)), before);
  }
});

test("逢人配歧义：自由领出选择较高主体，应牌选择最高可用同型解释", () => {
  const selected = [...cards([3, 3, 4, 4]), ...physical("0-h2", "1-h2")];
  assert.equal(classify(selected).type, "pairStraight");
  assert.equal(classify(selected).main, 5);
  const t = table();
  t.players[0].cards = [...selected, ...physical("0-j17")];
  t.lastPlay = { playerIndex: 3, combo: classify(cards([2, 2, 2, 3, 3, 3])) };
  act(t, "play", { cards: selected.map((c) => c.id) });
  assert.equal(t.lastPlay.combo.type, "plate");
  assert.equal(t.lastPlay.combo.main, 4);
});
