// Pure mathematical engine. No network, UI, or mutable global game state.
export function number(value, name, min = 0, max = 1e12) {
  if (
    value === "" ||
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  )
    throw new Error(`${name}必须是有效数字。`);
  const n = Number(value);
  if (n < min || n > max)
    throw new Error(`${name}必须在 ${min} 到 ${max} 之间。`);
  return n;
}
function integer(value, name, min, max) {
  const n = number(value, name, min, max);
  if (!Number.isInteger(n)) throw new Error(`${name}必须是整数。`);
  return n;
}
export function kelly(outcomes) {
  const derivative = (f) =>
    outcomes.reduce(
      (sum, { p, net }) => sum + (p ? (p * net) / (1 + f * net) : 0),
      0,
    );
  if (derivative(0) <= 0) return 0;
  let low = 0,
    high = 1 - 1e-12;
  if (derivative(high) >= 0) return 1;
  for (let i = 0; i < 70; i++) {
    const mid = (low + high) / 2;
    if (derivative(mid) > 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
const rouletteBets = {
  straight: [1, 35],
  split: [2, 17],
  street: [3, 11],
  corner: [4, 8],
  six: [6, 5],
  dozen: [12, 2],
  column: [12, 2],
  red: [18, 1],
  black: [18, 1],
  odd: [18, 1],
  even: [18, 1],
  low: [18, 1],
  high: [18, 1],
  basket: [5, 6],
};
export function roulette(input) {
  const pockets = { european: 37, american: 38, triple: 39 }[input.wheel];
  if (!pockets || !rouletteBets[input.bet])
    throw new Error("请选择有效的轮盘规则和投注类型。");
  const [covered, payout] = rouletteBets[input.bet];
  if (input.bet === "basket" && input.wheel !== "american")
    throw new Error("五数投注 0/00/1/2/3 只支持美式双零轮盘。");
  const bankroll = number(input.bankroll, "总筹码", 0.01);
  const stake = number(input.stake, "单局下注", 0.01, bankroll);
  const rounds = integer(input.rounds, "轮数", 1, 10000);
  const partage = Boolean(input.partage);
  if (partage && (pockets !== 37 || covered !== 18))
    throw new Error("零点退一半仅适用于欧式单零轮盘的 1:1 外围投注。");
  const win = covered / pockets;
  const halfLoss = partage ? 1 / pockets : 0;
  const loss = 1 - win - halfLoss;
  const outcomes = [
    { p: win, net: payout },
    { p: loss, net: -1 },
    { p: halfLoss, net: -0.5 },
  ];
  const unitEV = outcomes.reduce((s, x) => s + x.p * x.net, 0);
  const variance =
    outcomes.reduce((s, x) => s + x.p * x.net ** 2, 0) - unitEV ** 2;
  return {
    game: "roulette",
    method: "exact",
    win,
    loss,
    halfLoss,
    payout,
    pockets,
    covered,
    unitEV,
    ev: stake * unitEV,
    rounds,
    totalEV: rounds * stake * unitEV,
    sd: stake * Math.sqrt(rounds * variance),
    fullLossStreak: loss ** rounds,
    log10FullLossStreak: rounds * Math.log10(loss),
    stake,
    bankroll,
    exposure: stake / bankroll,
    kelly: kelly(outcomes),
    note: "多轮收益与标准差假设每轮独立、固定下注，且有资金完成全部轮次；不代表有限筹码破产概率。",
  };
}

export function parseRanks(text) {
  const tokens = String(text || "")
    .trim()
    .toUpperCase()
    .split(/[\s,，;；]+/)
    .filter(Boolean);
  return tokens.map((token) => {
    if (!/^(A|[2-9]|10|T|J|Q|K)$/.test(token))
      throw new Error(`无法识别21点牌值「${token}」，请用 A、2–10、J、Q、K。`);
    return token === "A"
      ? 1
      : ["10", "T", "J", "Q", "K"].includes(token)
        ? 10
        : Number(token);
  });
}
function addCard(total, soft, rank) {
  let t = total + (rank === 1 ? 11 : rank),
    a = soft + (rank === 1 ? 1 : 0);
  while (t > 21 && a > 0) {
    t -= 10;
    a--;
  }
  return [t, a];
}
export function handTotal(ranks) {
  return ranks.reduce(([t, a], r) => addCard(t, a, r), [0, 0]);
}
const zeroStats = () => ({ win: 0, push: 0, loss: 0, ev: 0 });
function accumulate(target, source, p) {
  for (const key of ["win", "push", "loss", "ev"])
    target[key] += source[key] * p;
}

// Exact finite-shoe recursion with a hidden dealer hole card. After a negative
// peek, player draws use the posterior conditional distribution, NOT c[r]/N.
export function blackjack(input) {
  const player = parseRanks(input.player),
    dealerCards = parseRanks(input.dealer),
    seen = parseRanks(input.seen);
  if (player.length < 2 || player.length > 12 || dealerCards.length !== 1)
    throw new Error("请输入2–12张自己的牌，以及1张庄家明牌。");
  const decks = integer(input.decks, "牌副数", 1, 8);
  const bankroll = number(input.bankroll, "总筹码（含本局已下注）", 0.01);
  const stake = number(input.stake, "本局原始下注", 0.01, bankroll);
  const payout = number(input.payout ?? 1.5, "自然21点净赔付", 1, 1.5);
  if (![1.2, 1.5].includes(payout))
    throw new Error("自然21点赔付只支持3:2或6:5。");
  const naturalPayout = input.payoutRounding
    ? Math.floor(stake * payout) / stake
    : payout;
  const up = dealerCards[0],
    finite = input.model !== "infinite",
    peek = Boolean(input.peek);
  const counts = Array.from(
    { length: 10 },
    (_, i) => decks * (i === 9 ? 16 : 4),
  );
  for (const r of [...player, up, ...seen]) {
    if (--counts[r - 1] < 0)
      throw new Error(
        `已知牌中点值${r === 1 ? "A" : r}超过整副牌数量；历史牌请勿重复包含当前牌。`,
      );
  }
  if (counts.reduce((a, b) => a + b, 0) < 24)
    throw new Error("剩余未知牌少于24张，当前引擎不支持可能耗尽的牌靴。");
  const excluded = peek ? (up === 1 ? 10 : up === 10 ? 1 : 0) : 0;
  const eligible = (r) => r !== excluded;
  const fixed = Array.from({ length: 10 }, (_, i) => (i === 9 ? 4 : 1) / 13);
  let states = 0;
  const guard = () => {
    if (++states > 1200000)
      throw new Error(
        "此牌面精确状态数超过120万，已停止以避免内存过大。可以手动选择无限牌靴模型，但那不是当前有限牌靴的精确概率。",
      );
  };
  const dealerMemo = new Map(),
    standMemo = new Map(),
    playerMemo = new Map();
  const keyFor = (t, a, c) => `${t},${a}|${finite ? c.join(",") : ""}`;
  // Distribution slots: bust, 17,18,19,20,21, natural blackjack.
  function dealerRun(t, a, c) {
    if (t > 21) return [1, 0, 0, 0, 0, 0, 0];
    if (t >= 17 && !(t === 17 && a > 0 && input.h17)) {
      const result = [0, 0, 0, 0, 0, 0, 0];
      result[t - 16] = 1;
      return result;
    }
    const key = keyFor(t, a, c);
    if (dealerMemo.has(key)) return dealerMemo.get(key);
    guard();
    const result = [0, 0, 0, 0, 0, 0, 0],
      n = c.reduce((s, x) => s + x, 0);
    if (finite && n === 0)
      throw new Error("此极端牌靴可能在庄家补牌时耗尽；当前不支持该场景。");
    for (let i = 0; i < 10; i++) {
      const p = finite ? c[i] / n : fixed[i];
      if (!p) continue;
      const next = finite ? c.slice() : c;
      if (finite) next[i]--;
      const [nt, na] = addCard(t, a, i + 1),
        d = dealerRun(nt, na, next);
      for (let j = 0; j < 7; j++) result[j] += p * d[j];
    }
    dealerMemo.set(key, result);
    return result;
  }
  function dealerDist(c) {
    const result = [0, 0, 0, 0, 0, 0, 0];
    const denominator = finite
      ? c.reduce((s, x, i) => s + (eligible(i + 1) ? x : 0), 0)
      : fixed.reduce((s, x, i) => s + (eligible(i + 1) ? x : 0), 0);
    if (denominator === 0)
      throw new Error("剩余牌与庄家已排除自然21点的条件矛盾。");
    for (let i = 0; i < 10; i++) {
      if (!eligible(i + 1)) continue;
      const p = (finite ? c[i] : fixed[i]) / denominator;
      if (!p) continue;
      if ((up === 1 && i === 9) || (up === 10 && i === 0)) {
        result[6] += p;
        continue;
      }
      const next = finite ? c.slice() : c;
      if (finite) next[i]--;
      const [t, a] = handTotal([up, i + 1]),
        d = dealerRun(t, a, next);
      for (let j = 0; j < 7; j++) result[j] += p * d[j];
    }
    return result;
  }
  function stand(t, a, c, natural = false) {
    if (t > 21) return { win: 0, push: 0, loss: 1, ev: -1 };
    const key = keyFor(t, a, c) + (natural ? "|BJ" : "");
    if (standMemo.has(key)) return standMemo.get(key);
    guard();
    const d = dealerDist(c),
      result = zeroStats();
    result.win = d[0];
    result.loss = d[6];
    if (natural) {
      result.win = 1 - d[6];
      result.push = d[6];
      result.loss = 0;
      result.ev = result.win * naturalPayout;
    } else {
      for (let j = 1; j <= 5; j++) {
        const dt = j + 16;
        if (t > dt) result.win += d[j];
        else if (t === dt) result.push += d[j];
        else result.loss += d[j];
      }
      result.ev = result.win - result.loss;
    }
    standMemo.set(key, result);
    return result;
  }
  function draw(t, a, c, double = false) {
    const result = zeroStats(),
      n = c.reduce((s, x) => s + x, 0),
      e = c.reduce((s, x, i) => s + (eligible(i + 1) ? x : 0), 0);
    if (finite && (n < 2 || e === 0))
      throw new Error(
        "此极端牌靴无法继续抽牌并保留庄家底牌；当前不支持该场景。",
      );
    for (let i = 0; i < 10; i++) {
      const p = finite
        ? (c[i] * (e - (eligible(i + 1) ? 1 : 0))) / (e * (n - 1))
        : fixed[i];
      if (!p) continue;
      const next = finite ? c.slice() : c;
      if (finite) next[i]--;
      const [nt, na] = addCard(t, a, i + 1);
      const child = double ? stand(nt, na, next) : optimal(nt, na, next);
      accumulate(result, child, p);
    }
    if (double) result.ev *= 2;
    return result;
  }
  function optimal(t, a, c) {
    if (t >= 21) return stand(t, a, c);
    const key = keyFor(t, a, c);
    if (playerMemo.has(key)) return playerMemo.get(key);
    guard();
    const s = stand(t, a, c),
      h = draw(t, a, c);
    const best = s.ev >= h.ev ? s : h;
    playerMemo.set(key, best);
    return best;
  }
  const [total, soft] = handTotal(player),
    natural =
      player.length === 2 && total === 21 && input.naturalEligible !== false;
  const actions = [
    {
      name: "停牌",
      id: "stand",
      ...stand(total, soft, counts, natural),
      committed: stake,
    },
  ];
  if (total < 21) {
    actions.push({
      name: "要牌",
      id: "hit",
      ...draw(total, soft, counts),
      committed: stake,
    });
    if (player.length === 2 && input.double && 2 * stake <= bankroll)
      actions.push({
        name: "加倍",
        id: "double",
        ...draw(total, soft, counts, true),
        committed: 2 * stake,
      });
    if (
      player.length === 2 &&
      input.surrender &&
      (peek || (up !== 1 && up !== 10))
    )
      actions.push({
        name: "晚投降",
        id: "surrender",
        win: 0,
        push: 0,
        loss: 1,
        ev: -0.5,
        committed: stake / 2,
      });
  }
  actions.sort((a, b) => b.ev - a.ev);
  const pair = player.length === 2 && player[0] === player[1];
  return {
    game: "blackjack",
    method: finite ? "exact" : "infinite",
    total,
    soft: soft > 0,
    natural,
    pair,
    actions,
    best: actions[0],
    stake,
    bankroll,
    exposure: actions[0].committed / bankroll,
    states,
    remaining: counts.reduce((a, b) => a + b, 0),
    peek,
    excluded,
    note: "已下注局面的动作比较；净收益相对于本局原始下注。要牌后的后续动作按最优要牌/停牌递归。当前不计算分牌、保险、提前投降和特殊奖励；对子时不能视为完整最优策略。",
  };
}

export function parseCards(text) {
  const value = String(text || "").trim();
  if (!value) return [];
  const normalized = value
    .replace(/♠/g, "s")
    .replace(/♥/g, "h")
    .replace(/♦/g, "d")
    .replace(/♣/g, "c");
  return normalized
    .split(/[\s,，;；]+/)
    .filter(Boolean)
    .map((token) => {
      const match = token.match(/^(10|[2-9TJQKA])([shdc])$/i);
      if (!match)
        throw new Error(
          `无法识别「${token}」，请用 As Kh 10d 这样的牌面格式。`,
        );
      const r =
        match[1].toUpperCase() === "10"
          ? 10
          : "23456789TJQKA".indexOf(match[1].toUpperCase()) + 2;
      return (r - 2) * 4 + "shdc".indexOf(match[2].toLowerCase());
    });
}
export function cardText(card) {
  return "23456789TJQKA"[Math.floor(card / 4)] + "♠♥♦♣"[card % 4];
}
function straightHigh(ranks) {
  const set = new Set(ranks);
  if (set.has(14)) set.add(1);
  for (let high = 14; high >= 5; high--)
    if ([0, 1, 2, 3, 4].every((d) => set.has(high - d))) return high;
  return 0;
}
function score(category, kickers) {
  let result = category;
  for (let i = 0; i < 5; i++) result = result * 15 + (kickers[i] || 0);
  return result;
}
export function evaluate(cards) {
  if (cards.length < 5 || cards.length > 7)
    throw new Error("评估手牌需要5–7张牌。");
  const ranks = cards.map((c) => Math.floor(c / 4) + 2).sort((a, b) => b - a);
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  let flush = null;
  for (let suit = 0; suit < 4; suit++) {
    const suited = cards
      .filter((c) => c % 4 === suit)
      .map((c) => Math.floor(c / 4) + 2)
      .sort((a, b) => b - a);
    if (suited.length >= 5) flush = suited;
  }
  if (flush && straightHigh(flush)) return score(8, [straightHigh(flush)]);
  if (groups[0][1] === 4)
    return score(7, [
      groups[0][0],
      ...ranks.filter((r) => r !== groups[0][0]).slice(0, 1),
    ]);
  const trips = groups.filter((g) => g[1] >= 3).map((g) => g[0]),
    pairs = groups.filter((g) => g[1] >= 2).map((g) => g[0]);
  if (trips.length && pairs.some((p) => p !== trips[0]))
    return score(6, [
      trips[0],
      Math.max(...pairs.filter((p) => p !== trips[0])),
    ]);
  if (flush) return score(5, flush.slice(0, 5));
  const straight = straightHigh(ranks);
  if (straight) return score(4, [straight]);
  if (trips.length)
    return score(3, [
      trips[0],
      ...ranks.filter((r) => r !== trips[0]).slice(0, 2),
    ]);
  if (pairs.length >= 2) {
    const p = pairs.sort((a, b) => b - a).slice(0, 2);
    return score(2, [...p, ...ranks.filter((r) => !p.includes(r)).slice(0, 1)]);
  }
  if (pairs.length)
    return score(1, [
      pairs[0],
      ...ranks.filter((r) => r !== pairs[0]).slice(0, 3),
    ]);
  return score(0, ranks.slice(0, 5));
}
export const handNames = [
  "高牌",
  "一对",
  "两对",
  "三条",
  "顺子",
  "同花",
  "葫芦",
  "四条",
  "同花顺",
];
export function handName(cards) {
  return handNames[Math.floor(evaluate(cards) / 15 ** 5)];
}
function combinations(n, k) {
  let x = 1;
  for (let i = 1; i <= k; i++) x *= (n - i + 1) / i;
  return Math.round(x);
}
function choose(items, count, callback, start = 0, selected = []) {
  if (!count) {
    callback(selected.slice());
    return;
  }
  for (let i = start; i <= items.length - count; i++) {
    selected.push(items[i]);
    choose(items, count - 1, callback, i + 1, selected);
    selected.pop();
  }
}
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
export function poker(input, progress = () => {}) {
  const hero = parseCards(input.hero),
    board = parseCards(input.board),
    dead = parseCards(input.dead);
  if (hero.length !== 2) throw new Error("德州扑克自己的手牌必须是2张。");
  if (![0, 3, 4, 5].includes(board.length))
    throw new Error("公共牌必须为0、3、4或5张。");
  const rawOpponents = Array.isArray(input.opponents)
    ? input.opponents
    : String(input.opponents || "?")
        .split(/[\n;；]+/)
        .map((s) => s.trim())
        .filter(Boolean);
  if (!rawOpponents.length || rawOpponents.length > 7)
    throw new Error("请输入1–7位对手，每行一个。");
  const opponents = rawOpponents.map((s) => (s === "?" ? null : parseCards(s)));
  if (opponents.some((o) => o && o.length !== 2))
    throw new Error("每位对手输入2张已知牌，或输入 ? 表示所有合法组合等概率。");
  const known = [
    ...hero,
    ...board,
    ...dead,
    ...opponents.flatMap((o) => o || []),
  ];
  if (new Set(known).size !== known.length)
    throw new Error("存在重复牌；自己的牌、公共牌、对手牌和死牌不能重复。");
  const bankroll = number(input.bankroll, "可用筹码", 0.01);
  const pot = number(input.pot, "当前可争夺底池", 0.01);
  const call = number(input.call, "跟注金额", 0, bankroll);
  const rakeRate = number(input.rake ?? 0, "抽水百分比", 0, 20) / 100;
  const rakeCap = number(input.rakeCap ?? 0, "抽水上限", 0);
  const samples = integer(input.samples ?? 50000, "模拟次数", 1000, 1000000);
  const seed = integer(input.seed ?? 20261012, "随机种子", 0, 4294967295);
  const deck = Array.from({ length: 52 }, (_, i) => i).filter(
    (c) => !known.includes(c),
  );
  const missingBoard = 5 - board.length,
    unknown = opponents.filter((o) => !o).length;
  if (deck.length < missingBoard + unknown * 2)
    throw new Error("剩余牌不足以完成此牌局。");
  let scenarios = 1,
    available = deck.length;
  for (let i = 0; i < unknown; i++) {
    scenarios *= combinations(available, 2);
    available -= 2;
  }
  scenarios *= combinations(available, missingBoard);
  const exact = scenarios <= 150000;
  let wins = 0,
    ties = 0,
    losses = 0,
    shareSum = 0,
    shareSquares = 0,
    n = 0;
  const histogram = Array(9).fill(0),
    shareCounts = new Map();
  function showdown(opp, tail) {
    const fullBoard = [...board, ...tail],
      heroScore = evaluate([...hero, ...fullBoard]);
    const scores = opp.map((hand) => evaluate([...hand, ...fullBoard]));
    const top = Math.max(heroScore, ...scores),
      equal = scores.filter((s) => s === heroScore).length;
    const share = heroScore === top ? 1 / (1 + equal) : 0;
    if (share === 1) wins++;
    else if (share > 0) ties++;
    else losses++;
    shareSum += share;
    shareSquares += share * share;
    n++;
    shareCounts.set(share, (shareCounts.get(share) || 0) + 1);
    histogram[Math.floor(heroScore / 15 ** 5)]++;
  }
  function enumerateOpp(index, remaining, assigned) {
    if (index === opponents.length) {
      choose(remaining, missingBoard, (tail) => showdown(assigned, tail));
      return;
    }
    if (opponents[index]) {
      enumerateOpp(index + 1, remaining, [...assigned, opponents[index]]);
      return;
    }
    choose(remaining, 2, (hand) =>
      enumerateOpp(
        index + 1,
        remaining.filter((c) => !hand.includes(c)),
        [...assigned, hand],
      ),
    );
  }
  if (exact) {
    enumerateOpp(0, deck, []);
    progress(1);
  } else {
    const random = seededRandom(seed),
      count = unknown * 2 + missingBoard;
    for (let i = 0; i < samples; i++) {
      const shuffled = deck.slice();
      for (let j = 0; j < count; j++) {
        const k = j + Math.floor(random() * (shuffled.length - j));
        [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
      }
      let cursor = 0;
      const opp = opponents.map((o) => {
        if (o) return o;
        const hand = shuffled.slice(cursor, cursor + 2);
        cursor += 2;
        return hand;
      });
      showdown(opp, shuffled.slice(cursor, cursor + missingBoard));
      if (i % 5000 === 0) progress(i / samples);
    }
    progress(1);
  }
  const equity = shareSum / n;
  // Distribution-free Hoeffding bound for iid pot-share observations in [0,1].
  // This bounds numerical sampling error, not opponent-model misspecification.
  const radius = exact ? 0 : Math.sqrt(Math.log(40) / (2 * n));
  const interval = [Math.max(0, equity - radius), Math.min(1, equity + radius)];
  const finalPot = pot + call,
    rake = Math.min(finalPot * rakeRate, rakeCap),
    distributable = finalPot - rake;
  const threshold = call / distributable,
    ev = equity * distributable - call;
  const evInterval = interval.map((p) => p * distributable - call);
  const outcomes = [...shareCounts].map(([share, count]) => ({
    p: count / n,
    net: call > 0 ? (share * distributable - call) / call : 0,
  }));
  const fullKelly = call > 0 ? kelly(outcomes) : 0;
  const decision =
    call === 0
      ? "过牌可免费继续"
      : Math.abs(ev) < 1e-10 && exact
        ? "跟注与弃牌期望相同"
        : interval[0] > threshold
          ? "跟注为正期望"
          : interval[1] < threshold
            ? "弃牌优于跟注"
            : "误差范围内无法区分";
  return {
    game: "poker",
    method: exact ? "exact" : "montecarlo",
    win: wins / n,
    tie: ties / n,
    loss: losses / n,
    equity,
    interval,
    radius,
    ev,
    evInterval,
    threshold,
    decision,
    rake,
    finalPot,
    distributable,
    pot,
    call,
    bankroll,
    samples: n,
    scenarios,
    seed,
    unknown,
    opponents: opponents.length,
    exposure: call / bankroll,
    kelly: fullKelly,
    quarterKellyBudget: (fullKelly * bankroll) / 4,
    histogram: histogram.map((count, category) => ({
      name: handNames[category],
      p: count / n,
    })),
    note: "跟注EV仅适用于跟注后无后续下注、无弃牌、无边池的摊牌模型。? 对手为均匀随机范围，不能代替真实跟注/加注范围；不计算诈唬、位置、ICM或隐含赔率。四分之一凯利额度仅为同分布重复投注的资金参考，不是德扑加注建议。",
  };
}
