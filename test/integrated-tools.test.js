import test from "node:test";
import assert from "node:assert/strict";
import { RouletteTable } from "../server/games/roulette.js";
import {
  resolveBet,
  rouletteNumbers,
  betNames,
} from "../public/calculator/roulette-rules.js";
import { roulette, blackjack, poker } from "../public/calculator/engine.js";
import { buildLiveInput } from "../public/calculator/live-input.js";
import {
  GuandanTable,
  planHand,
  combinations,
} from "../server/games/guandan.js";

test("轮盘所有投注与迁移计算器的覆盖数、赔率、期望一致", () => {
  const examples = {
    straight: "17",
    split: "1 4",
    street: "1 2 3",
    corner: "1 2 4 5",
    six: "1 2 3 4 5 6",
    dozen: "2",
    column: "3",
  };
  for (const wheel of ["european", "american", "triple"]) {
    assert.equal(
      new Set(rouletteNumbers(wheel)).size,
      { european: 37, american: 38, triple: 39 }[wheel],
    );
    for (const kind of Object.keys(betNames)) {
      if (kind === "basket" && wheel !== "american") continue;
      const bet = resolveBet(wheel, kind, examples[kind]);
      const calc = roulette({
        wheel,
        bet: kind,
        bankroll: 10000,
        stake: 100,
        rounds: 1,
      });
      assert.equal(bet.numbers.length, calc.covered);
      assert.equal(bet.payout, calc.payout);
      const ev =
        rouletteNumbers(wheel).reduce(
          (sum, n) => sum + (bet.numbers.includes(n) ? 100 * bet.payout : -100),
          0,
        ) / calc.pockets;
      assert.ok(Math.abs(ev - calc.ev) < 1e-10);
    }
  }
  for (const [kind, numbers] of [
    ["split", "3 4"],
    ["corner", "2 3 5 7"],
    ["street", "2 3 4"],
    ["six", "2 3 4 5 6 7"],
    ["split", "1 1"],
  ])
    assert.throws(() => resolveBet("european", kind, numbers));
  assert.throws(() => resolveBet("triple", "basket"));
});

test("轮盘多人统一结果、35倍净赔、退半和庄家账本守恒", () => {
  for (const [number, partage] of [
    ["17", false],
    ["0", true],
    ["00", false],
  ]) {
    const t = new RouletteTable({
      stack: 1000,
      wheel: number === "00" ? "american" : "european",
      partage,
    });
    const a = t.addPlayer("a"),
      b = t.addPlayer("b");
    t.start();
    const version = t.version;
    assert.throws(() =>
      t.action(b.id, { type: "bet", bet: "red", amount: 100 }),
    );
    assert.equal(t.version, version);
    t.action(a.id, {
      type: "bet",
      bet: "straight",
      numbers: "17",
      amount: 100,
    });
    if (partage)
      assert.throws(() =>
        t.action(b.id, { type: "bet", bet: "red", amount: 101 }),
      );
    t.pockets = [number]; // Deterministic fixture; public requests cannot set pockets.
    t.action(b.id, { type: "bet", bet: "red", amount: 100 });
    assert.equal(t.stage, "showdown");
    assert.equal(t.number, number);
    assert.equal(a.stack, number === "17" ? 4500 : 900);
    assert.equal(b.stack, number === "0" ? 950 : 900);
    assert.equal(a.stack + b.stack + t.houseNet, 2000);
    assert.equal(t.view(a.id).number, t.view(b.id).number);
  }
});

test("轮盘跳过、加入下一局、机器人下注及多局账本", () => {
  const t = new RouletteTable({ stack: 1000 });
  const a = t.addPlayer("a");
  t.start();
  const b = t.addPlayer("b", { bot: true });
  assert.equal(t.legal(b.id), null);
  t.automaticAction(a.id, false);
  assert.equal(t.stage, "showdown");
  for (let round = 0; round < 15; round++) {
    t.start();
    while (t.playing) t.automaticAction(t.players[t.turn].id, true);
    assert.equal(
      t.players.reduce((sum, p) => sum + p.stack, 0) + t.houseNet,
      2000,
    );
  }
});

test("掼蛋三种组合整理：覆盖全部实体牌且每组合法，推荐不改变游戏状态", () => {
  for (let round = 0; round < 12; round++) {
    const t = new GuandanTable();
    for (let i = 0; i < 4; i++) t.addPlayer(String(i));
    t.start();
    const p = t.players[t.turn];
    const before = JSON.stringify(p.cards),
      version = t.version;
    for (const style of ["balanced", "protect", "chains"]) {
      const groups = planHand(p.cards, t.level, style),
        ids = groups.flatMap((g) => g.cards);
      assert.equal(new Set(ids).size, 27);
      assert.deepEqual(ids.toSorted(), p.cards.map((c) => c.id).toSorted());
      for (const g of groups)
        assert.ok(
          combinations(
            p.cards.filter((c) => g.cards.includes(c.id)),
            t.level,
          ).some((c) => c.type === g.type && c.main === g.main),
        );
    }
    const view = t.view(p.id);
    assert.ok(view.recommendation.options.length);
    assert.equal(t.version, version);
    assert.equal(JSON.stringify(p.cards), before);
    assert.ok(
      view.recommendation.options.every((m) =>
        m.cards.every((id) => p.cards.some((c) => c.id === id)),
      ),
    );
  }
});

test("局内德州输入不随隐藏底牌变化，支持满桌7位对手", () => {
  const state = {
    gameType: "poker",
    stage: "preflop",
    me: "a",
    board: [],
    pot: 30,
    players: [
      {
        id: "a",
        inHand: true,
        stack: 1000,
        cards: [
          { rank: 14, suit: "s" },
          { rank: 13, suit: "s" },
        ],
      },
      ...Array.from({ length: 7 }, (_, i) => ({
        id: String(i),
        inHand: true,
        stack: 1000,
        cards: [null, null],
      })),
    ],
  };
  const first = buildLiveInput(state);
  state.players[1].cards = [
    { rank: 2, suit: "s" },
    { rank: 3, suit: "s" },
  ];
  assert.deepEqual(buildLiveInput(state), first);
  assert.equal(first.input.opponents.length, 7);
  const r = poker({ ...first.input, samples: 1000 });
  assert.ok(r.equity >= 0 && r.equity <= 1);
});

test("局内21点只扣除公开牌，不读取暗牌；分牌21不按自然黑杰克赔付", () => {
  const c = (rank) => ({ rank, suit: "s" });
  const state = {
    gameType: "blackjack",
    stage: "playing",
    me: "a",
    turn: 0,
    activeHand: 0,
    dealerCards: [c(6), null],
    exposedDiscards: [c(2)],
    players: [
      {
        id: "a",
        stack: 900,
        hands: [{ cards: [c(14), c(13)], bet: 15, split: true }],
      },
      { id: "b", hands: [{ cards: [c(3), c(4)] }] },
    ],
  };
  const first = buildLiveInput(state, "infinite");
  assert.equal(first.input.seen, "2 3 4");
  assert.equal(first.input.naturalEligible, false);
  state.dealerCards[1] = c(14);
  state.shoe = [c(10)];
  assert.deepEqual(buildLiveInput(state, "infinite"), first);
  const ordinary = blackjack(first.input);
  assert.equal(ordinary.natural, false);
  assert.ok(ordinary.best.ev <= 1);
  const natural = blackjack({ ...first.input, naturalEligible: true });
  assert.equal(natural.natural, true);
  assert.equal(natural.best.ev, 22 / 15);
});
