import test from "node:test";
import assert from "node:assert/strict";
import {
  roulette,
  blackjack,
  poker,
  parseRanks,
  handTotal,
  parseCards,
  evaluate,
  handName,
  kelly,
  seededRandom,
} from "../public/calculator/engine.js";

const close = (actual, expected, epsilon = 1e-10) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} ≠ ${expected} (±${epsilon})`,
  );
const spin = (changes) =>
  roulette({
    wheel: "european",
    bet: "red",
    bankroll: 1000,
    stake: 10,
    rounds: 100,
    ...changes,
  });
const bj = (changes) =>
  blackjack({
    player: "10 6",
    dealer: "10",
    decks: 6,
    bankroll: 1000,
    stake: 10,
    peek: true,
    double: true,
    payout: 1.5,
    ...changes,
  });
const hold = (changes) =>
  poker({
    hero: "As Ks",
    board: "Qs Js Ts 2h 3d",
    opponents: "?",
    bankroll: 1000,
    pot: 100,
    call: 20,
    samples: 10000,
    seed: 123,
    ...changes,
  });

test("roulette: all standard European bets have the exact 1/37 edge", () => {
  for (const bet of [
    "straight",
    "split",
    "street",
    "corner",
    "six",
    "dozen",
    "column",
    "red",
    "black",
    "odd",
    "even",
    "low",
    "high",
  ]) {
    const r = spin({ bet });
    close(r.unitEV, -1 / 37);
    assert.equal(r.kelly, 0);
    close(r.win + r.loss + r.halfLoss, 1);
  }
});
test("roulette: American, triple-zero, basket, and La Partage edges", () => {
  close(spin({ wheel: "american" }).unitEV, -2 / 38);
  close(spin({ wheel: "triple" }).unitEV, -3 / 39);
  close(spin({ wheel: "american", bet: "basket" }).unitEV, -3 / 38);
  const r = spin({ partage: true });
  close(r.unitEV, -1 / 74);
  close(r.halfLoss, 1 / 37);
  close(r.loss, 18 / 37);
});
test("roulette rejects invalid rule combinations and insufficient chips", () => {
  assert.throws(() => spin({ partage: true, bet: "straight" }));
  assert.throws(() => spin({ bet: "basket" }));
  assert.throws(() => spin({ stake: 1001 }));
  assert.throws(() => spin({ rounds: 1.5 }));
  assert.throws(() => spin({ bankroll: "" }));
});
test("roulette repeated-spin moments use independent fixed wagers", () => {
  const r = spin({ rounds: 4 });
  close(r.totalEV, -40 / 37);
  close(r.fullLossStreak, (19 / 37) ** 4);
  close(r.sd ** 2, 4 * 100 * (1 - (1 / 37) ** 2));
  const extreme = spin({ rounds: 10000 });
  assert.equal(extreme.fullLossStreak, 0); // Float underflow, log probability remains valid.
  close(extreme.log10FullLossStreak, 10000 * Math.log10(19 / 37));
});
test("generalized Kelly includes fractional-loss and split-pot outcomes", () => {
  close(
    kelly([
      { p: 0.6, net: 1 },
      { p: 0.4, net: -1 },
    ]),
    0.2,
  );
  close(
    kelly([
      { p: 0.4, net: 2 },
      { p: 0.6, net: -1 },
    ]),
    0.1,
  );
  assert.equal(
    kelly([
      { p: 18 / 37, net: 1 },
      { p: 19 / 37, net: -1 },
    ]),
    0,
  );
  assert.equal(kelly([{ p: 1, net: 2 }]), 1);
});
test("blackjack parses ranks and handles multiple aces", () => {
  assert.deepEqual(handTotal(parseRanks("A A 9")), [21, 1]);
  assert.deepEqual(handTotal(parseRanks("A A 10")), [12, 0]);
  assert.deepEqual(handTotal(parseRanks("A 7 5")), [13, 0]);
  assert.throws(() => parseRanks("11 2"));
  assert.throws(() => parseRanks("As Kh"));
});
// Independent oracle: Michael Shackleford's published composition-dependent
// tables, rounded to 6 decimals. References are in README.md.
test("blackjack finite recursion matches published six-deck S17 EVs", () => {
  const fixtures = [
    {
      player: "10 6",
      dealer: "10",
      expected: { stand: -0.540954, hit: -0.534676, double: -1.069351 },
    },
    {
      player: "A 2",
      dealer: "A",
      expected: { stand: -0.666224, hit: -0.059413, double: -0.619513 },
    },
    {
      player: "6 5",
      dealer: "6",
      expected: { stand: -0.150826, hit: 0.341332, double: 0.682665 },
    },
    {
      player: "8 8",
      dealer: "10",
      expected: { stand: -0.536853, hit: -0.535361, double: -1.070722 },
    },
  ];
  for (const { player, dealer, expected } of fixtures) {
    const r = bj({ player, dealer });
    for (const a of r.actions) {
      close(a.ev, expected[a.id], 5.1e-7);
      close(a.win + a.push + a.loss, 1);
    }
  }
});
test("blackjack finite recursion matches published single-deck S17 EVs", () => {
  const r = bj({ decks: 1 });
  const expected = { stand: -0.542952, hit: -0.506929, double: -1.013859 };
  // Published double value differs by 5.15e-7; check within its displayed
  // 1e-6 precision and independently verify the full recursion below.
  r.actions.forEach((a) => close(a.ev, expected[a.id], 1e-6));
});
test("blackjack double matches independent hole-first full tree enumeration", () => {
  // Uses explicit hole-card branches then player draw then dealer draw,
  // rather than the production engine's marginalized posterior formula.
  const shoe = [4, 4, 4, 4, 4, 3, 4, 4, 4, 14]; // 10,6 player and 10 up removed.
  function points(cards) {
    let sum = cards.reduce((s, r) => s + r, 0);
    if (cards.includes(1) && sum + 10 <= 21) sum += 10;
    return sum;
  }
  function dealer(cards, counts, playerTotal) {
    const t = points(cards);
    if (t > 21) return 1;
    if (t >= 17) return playerTotal > t ? 1 : playerTotal === t ? 0 : -1;
    const n = counts.reduce((s, x) => s + x, 0);
    let ev = 0;
    for (let i = 0; i < 10; i++)
      if (counts[i]) {
        const next = counts.slice();
        next[i]--;
        ev += (counts[i] / n) * dealer([...cards, i + 1], next, playerTotal);
      }
    return ev;
  }
  const holeCount = shoe.reduce((s, x, i) => s + (i === 0 ? 0 : x), 0);
  let ev = 0;
  for (let h = 1; h < 10; h++) {
    const afterHole = shoe.slice();
    afterHole[h]--;
    const n = afterHole.reduce((s, x) => s + x, 0);
    for (let draw = 0; draw < 10; draw++)
      if (afterHole[draw]) {
        const afterDraw = afterHole.slice();
        afterDraw[draw]--;
        const t = points([10, 6, draw + 1]);
        ev +=
          (((shoe[h] / holeCount) * afterHole[draw]) / n) *
          (t > 21 ? -2 : 2 * dealer([10, h + 1], afterDraw, t));
      }
  }
  close(bj({ decks: 1 }).actions.find((a) => a.id === "double").ev, ev, 1e-12);
});
test("blackjack infinite-deck stand/hit agrees with published total-dependent table", () => {
  const r = bj({ model: "infinite" });
  close(r.actions.find((a) => a.id === "stand").ev, -0.54043, 5.1e-7);
  close(r.actions.find((a) => a.id === "hit").ev, -0.539826, 5.1e-7);
});
test("blackjack natural payout and hole-card blackjack conditioning", () => {
  close(bj({ player: "A K", dealer: "A" }).best.ev, 1.5);
  close(bj({ player: "A K", dealer: "A", payout: 1.2 }).best.ev, 1.2);
  const r = bj({ player: "A K", dealer: "A", peek: false });
  close(r.best.push, 95 / 309);
  close(r.best.ev, (1 - 95 / 309) * 1.5);
  assert.equal(r.actions.length, 1);
  const three = bj({ player: "7 7 7", dealer: "10", peek: false });
  assert.equal(three.natural, false);
  assert.ok(three.best.loss > 0);
});
test("blackjack surrender is late, fixed half-loss, and only initial two cards", () => {
  const r = bj({ surrender: true });
  assert.equal(r.best.id, "surrender");
  close(r.best.ev, -0.5);
  assert.equal(
    bj({ surrender: true, peek: false }).actions.some(
      (a) => a.id === "surrender",
    ),
    false,
  );
  assert.equal(
    bj({ surrender: true, player: "5 5 6" }).actions.some(
      (a) => a.id === "surrender",
    ),
    false,
  );
});
test("blackjack excludes unaffordable doubles and reports pair limitation", () => {
  assert.equal(
    bj({ bankroll: 15 }).actions.some((a) => a.id === "double"),
    false,
  );
  assert.equal(bj({ player: "8 8" }).pair, true);
  assert.throws(() => bj({ decks: 1, seen: "A A A A A" }));
  assert.throws(() => bj({ dealer: "A 2" }));
});
test("blackjack H17 and removed cards change the actual model", () => {
  const s = bj({ player: "A 7", dealer: "6" }),
    h = bj({ player: "A 7", dealer: "6", h17: true });
  assert.notEqual(s.best.ev, h.best.ev);
  assert.notEqual(bj({ seen: "2 3 4 5 6" }).best.ev, bj({}).best.ev);
});
test("poker parser accepts tens and suit symbols and rejects malformed cards", () => {
  assert.deepEqual(parseCards("10s A♥ Kd Q♣"), parseCards("Ts Ah Kd Qc"));
  assert.throws(() => parseCards("1s"));
  assert.throws(() => parseCards("AA"));
});
test("poker compares all categories and full tiebreakers", () => {
  const ascending = [
    "As Jd 9h 6c 3d",
    "As Ad Jh 6c 3d",
    "As Ad Jh Jc 3d",
    "As Ad Ah 6c 3d",
    "As 2d 3h 4c 5d",
    "As Js 9s 6s 3s",
    "As Ad Ah 6c 6d",
    "As Ad Ah Ac 3d",
    "As 2s 3s 4s 5s",
  ];
  ascending
    .slice(1)
    .forEach((hand, i) =>
      assert.ok(
        evaluate(parseCards(hand)) > evaluate(parseCards(ascending[i])),
      ),
    );
  assert.ok(
    evaluate(parseCards("6s 5h 4d 3c 2s")) >
      evaluate(parseCards("As 2d 3h 4c 5d")),
  );
  assert.ok(
    evaluate(parseCards("As Ad Kh Qc 9d")) >
      evaluate(parseCards("As Ad Kh Qc 8d")),
  );
  assert.equal(handName(parseCards("As Ad Ah Ks Kd Kh 2c")), "葫芦");
  assert.ok(
    evaluate(parseCards("As Ad Ah Ks Kd Kh 2c")) >
      evaluate(parseCards("Ks Kd Kh Qs Qd As 2c")),
  );
});
test("poker ignores the sixth/seventh kicker and handles board-only ties", () => {
  const a = parseCards("As Ks Qs Js Ts 2h 3d"),
    b = parseCards("As Ks Qs Js Ts 9h 8d");
  assert.equal(evaluate(a), evaluate(b));
  const r = hold({ hero: "2h 3d", board: "As Ks Qs Js Ts", opponents: "?" });
  close(r.tie, 1);
  close(r.equity, 0.5);
  close(r.win, 0);
  close(r.ev, 40);
});
test("poker exact river vs unknown opponent enumerates all 990 hands", () => {
  const r = hold({});
  assert.equal(r.method, "exact");
  assert.equal(r.samples, 990);
  close(r.equity, 1);
  close(r.ev, 100);
  close(r.threshold, 1 / 6);
  close(r.win + r.tie + r.loss, 1);
});
test("poker known opponent/flop exactly enumerates 990 runouts", () => {
  const r = hold({ board: "Qs Js 2d", opponents: "Qh Qd" });
  assert.equal(r.samples, 990);
  assert.equal(r.method, "exact");
  close(r.win + r.tie + r.loss, 1);
  close(
    r.histogram.reduce((sum, h) => sum + h.p, 0),
    1,
  );
});
test("poker accounts for capped rake and correct pot definition", () => {
  const r = hold({ rake: 5, rakeCap: 3 });
  close(r.rake, 3);
  close(r.ev, 97);
  close(r.threshold, 20 / 117);
  close(hold({ rake: 5, rakeCap: 0 }).rake, 0);
  close(hold({ call: 0 }).ev, 100);
  assert.equal(hold({ call: 0 }).decision, "过牌可免费继续");
});
test("poker multiway split counts fractional equity, not tie as a full win", () => {
  const r = hold({
    hero: "2h 3d",
    board: "As Ks Qs Js Ts",
    opponents: "9h 8d; 7h 6d",
  });
  close(r.equity, 1 / 3);
  close(r.tie, 1);
  close(r.ev, 20);
  assert.equal(r.samples, 1);
});
test("poker Monte Carlo is reproducible, collision-free, with bounded pot shares", () => {
  const options = {
    hero: "2h 3d",
    board: "As Ks Qs Js Ts",
    opponents: "?; ?",
    samples: 10000,
  };
  const a = hold(options),
    b = hold(options);
  assert.equal(a.method, "montecarlo");
  assert.deepEqual(a, b);
  close(a.equity, 1 / 3, 1e-12);
  close(a.tie, 1);
  close(a.radius, Math.sqrt(Math.log(40) / 20000));
});
test("poker card-removal, bankroll, and malformed board validation", () => {
  assert.throws(() => hold({ hero: "As As" }));
  assert.throws(() => hold({ dead: "As" }));
  assert.throws(() => hold({ opponents: "As Ah" }));
  assert.throws(() => hold({ board: "Qs Js" }));
  assert.throws(() => hold({ call: 1001 }));
  assert.throws(() => hold({ opponents: "Qh" }));
  assert.equal(hold({ dead: "9h" }).samples, 946);
});

// Exhaustively verifies the standard 2,598,960 five-card hands against the
// combinatorial category totals. This is independent of individual examples.
test("poker exhaustive five-card category frequencies match combinatorics", () => {
  const counts = Array(9).fill(0);
  for (let a = 0; a < 48; a++)
    for (let b = a + 1; b < 49; b++)
      for (let c = b + 1; c < 50; c++)
        for (let d = c + 1; d < 51; d++)
          for (let e = d + 1; e < 52; e++) {
            counts[Math.floor(evaluate([a, b, c, d, e]) / 15 ** 5)]++;
          }
  assert.deepEqual(
    counts,
    [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40],
  );
});
test("poker seven-card evaluation equals maximum of every five-card subset", () => {
  const random = seededRandom(814721);
  for (let trial = 0; trial < 1000; trial++) {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let j = 0; j < 7; j++) {
      const k = j + Math.floor(random() * (52 - j));
      [deck[j], deck[k]] = [deck[k], deck[j]];
    }
    const seven = deck.slice(0, 7);
    let best = 0;
    for (let a = 0; a < 3; a++)
      for (let b = a + 1; b < 4; b++)
        for (let c = b + 1; c < 5; c++)
          for (let d = c + 1; d < 6; d++)
            for (let e = d + 1; e < 7; e++)
              best = Math.max(
                best,
                evaluate([seven[a], seven[b], seven[c], seven[d], seven[e]]),
              );
    assert.equal(evaluate(seven), best);
  }
});
