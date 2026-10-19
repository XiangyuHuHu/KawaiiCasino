import { randomInt, randomUUID } from "node:crypto";

export const combinationNames = {
  single: "单张",
  pair: "对子",
  triple: "三张",
  triplePair: "三带二",
  straight: "顺子",
  pairStraight: "三连对",
  plate: "钢板",
  bomb: "炸弹",
  straightFlush: "同花顺",
  rocket: "天王炸",
};
const suits = ["s", "h", "d", "c"];
const ranks = Array.from({ length: 13 }, (_, i) => i + 2);
export const rankValue = (rank, level = 2) => (rank === level ? 15 : rank);
export const isWild = (card, level) => card.rank === level && card.suit === "h";
const sortCards = (cards, level) =>
  cards.sort(
    (a, b) =>
      rankValue(a.rank, level) - rankValue(b.rank, level) ||
      a.id.localeCompare(b.id),
  );

export function deck() {
  const cards = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of suits)
      for (const rank of ranks)
        cards.push({ id: `${copy}-${suit}${rank}`, rank, suit });
    for (const rank of [16, 17])
      cards.push({ id: `${copy}-j${rank}`, rank, suit: "j" });
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
const power = (c) =>
  c.type === "rocket"
    ? 100
    : c.type === "straightFlush"
      ? 55
      : c.type === "bomb"
        ? c.count * 10
        : 0;
const strongest = (a, b) =>
  power(b) - power(a) || b.main - a.main || a.type.localeCompare(b.type);
export function beats(move, previous) {
  if (!move) return false;
  if (!previous) return true;
  const a = power(move),
    b = power(previous);
  if (a !== b) return a > b;
  return (
    move.type === previous.type &&
    move.count === previous.count &&
    move.main > previous.main
  );
}

// Rank/suit templates keep detection and bot move generation consistent, including
// both physical heart-level wilds. Sequences use printed ranks, not lifted level ranks.
const templateCache = new Map();
function templates(level) {
  if (templateCache.has(level)) return templateCache.get(level);
  const out = [];
  const add = (type, main, needs, suit = null) =>
    out.push({
      type,
      main,
      needs,
      suit,
      count: needs.reduce((n, [, copies]) => n + copies, 0),
      name: combinationNames[type],
    });
  for (const rank of [...ranks, 16, 17]) {
    for (let copies = 1; copies <= (rank >= 16 ? 2 : 8); copies++) {
      const type = [null, "single", "pair", "triple"][copies] || "bomb";
      add(type, rankValue(rank, level), [[rank, copies]]);
    }
  }
  for (const triple of ranks)
    for (const pair of [...ranks, 16, 17])
      if (triple !== pair)
        add("triplePair", rankValue(triple, level), [
          [triple, 3],
          [pair, 2],
        ]);
  for (const [type, length, copies] of [
    ["straight", 5, 1],
    ["pairStraight", 3, 2],
    ["plate", 2, 3],
  ]) {
    const sequences = [
      [14, ...Array.from({ length: length - 1 }, (_, i) => i + 2)],
    ];
    for (let start = 2; start + length - 1 <= 14; start++)
      sequences.push(Array.from({ length }, (_, i) => start + i));
    for (const seq of sequences) {
      const needs = seq.map((rank) => [rank, copies]);
      const main = seq.at(-1);
      add(type, main, needs);
      if (type === "straight")
        for (const suit of suits) add("straightFlush", main, needs, suit);
    }
  }
  add("rocket", 17, [
    [16, 2],
    [17, 2],
  ]);
  out.sort(strongest);
  templateCache.set(level, out);
  return out;
}
function validCards(cards) {
  if (!Array.isArray(cards) || !cards.length || cards.length > 108)
    return false;
  const ids = new Set(),
    physical = new Map();
  for (const c of cards) {
    if (
      !c ||
      typeof c.id !== "string" ||
      ids.has(c.id) ||
      !(
        (ranks.includes(c.rank) && suits.includes(c.suit)) ||
        ([16, 17].includes(c.rank) && c.suit === "j")
      )
    )
      return false;
    ids.add(c.id);
    const key = `${c.rank}:${c.suit}`;
    physical.set(key, (physical.get(key) || 0) + 1);
    if (physical.get(key) > 2) return false;
  }
  return true;
}
const comboOf = ({ type, main, count, name }) => ({ type, main, count, name });
function selectionFor(template, natural, wilds) {
  const selected = [];
  let deficit = 0;
  for (const [rank, count] of template.needs) {
    const matches =
      natural
        .get(rank)
        ?.filter((c) => !template.suit || c.suit === template.suit) || [];
    const take = matches.slice(0, count);
    selected.push(...take);
    const missing = count - take.length;
    if (rank >= 16 && missing) return null; // Wilds can never become jokers.
    deficit += missing;
    if (deficit > wilds.length) return null;
  }
  return [...selected, ...wilds.slice(0, deficit)];
}
function splitCards(cards, level) {
  const natural = new Map(),
    wilds = [];
  for (const c of cards) {
    if (isWild(c, level)) wilds.push(c);
    else {
      if (!natural.has(c.rank)) natural.set(c.rank, []);
      natural.get(c.rank).push(c);
    }
  }
  return { natural, wilds };
}
export function combinations(cards, level = 2) {
  if (!ranks.includes(level) || !validCards(cards) || cards.length > 8)
    return [];
  const { natural, wilds } = splitCards(cards, level);
  return templates(level)
    .filter((t) => {
      if (t.count !== cards.length) return false;
      const selected = selectionFor(t, natural, wilds);
      return (
        selected?.length === cards.length &&
        new Set(selected.map((c) => c.id)).size === cards.length
      );
    })
    .map(comboOf);
}
export const classify = (cards, level = 2) =>
  combinations(cards, level)[0] || null;

export function legalMoves(cards, previous = null, level = 2) {
  if (!ranks.includes(level) || !validCards(cards)) return [];
  const { natural, wilds } = splitCards(cards, level),
    moves = [],
    seen = new Set();
  for (const t of templates(level)) {
    if (!beats(t, previous) || t.count > cards.length) continue;
    const selected = selectionFor(t, natural, wilds);
    if (!selected) continue;
    const key = selected
      .map((c) => c.id)
      .sort()
      .join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    moves.push({ ...comboOf(t), cards: selected.map((c) => c.id) });
  }
  return moves.sort(
    (a, b) => power(a) - power(b) || b.count - a.count || a.main - b.main,
  );
}

export function upgradeFor(order) {
  if (
    order.length !== 4 ||
    new Set(order).size !== 4 ||
    order.some((s) => ![0, 1, 2, 3].includes(s))
  )
    throw new Error("需要完整的四席名次");
  const team = order[0] % 2;
  const partnerPlace =
    order.findIndex((seat, i) => i > 0 && seat % 2 === team) + 1;
  return { team, upgrade: 5 - partnerPlace };
}

// Deterministic disjoint grouping of this player's own cards. A heuristic,
// not a globally minimal partition or a search of opponents' hidden cards.
export function planHand(cards, level = 2, style = "balanced") {
  let remaining = [...cards];
  const groups = [];
  for (let step = 0; remaining.length && step < 27; step++) {
    const moves = legalMoves(remaining, null, level);
    const protectedCards = new Set(
      moves
        .filter((m) => ["bomb", "rocket", "straightFlush"].includes(m.type))
        .flatMap((m) => m.cards),
    );
    const merit = (move) => {
      const special = ["bomb", "rocket", "straightFlush"].includes(move.type);
      const chain = ["straight", "pairStraight", "plate"].includes(move.type);
      const split = special
        ? 0
        : move.cards.filter((id) => protectedCards.has(id)).length;
      return (
        move.count * 10 -
        move.main * 0.05 +
        (style === "protect" && special ? 200 : 0) +
        (style === "chains" && chain ? 60 : 0) -
        split * (style === "protect" ? 30 : 8)
      );
    };
    const move = moves.sort(
      (a, b) => merit(b) - merit(a) || a.main - b.main,
    )[0];
    if (!move) throw new Error("手牌无法整理");
    groups.push(move);
    const used = new Set(move.cards);
    remaining = remaining.filter((c) => !used.has(c.id));
  }
  return groups;
}

export class GuandanTable {
  constructor({ stack = 10000, actionTimeout = 35000 } = {}) {
    this.buyIn = stack;
    this.actionTimeout = actionTimeout;
    this.baseStake = 10;
    this.players = [];
    this.stage = "waiting";
    this.turn = -1;
    this.deadline = null;
    this.hand = 0;
    this.version = 0;
    this.history = [];
    this.result = [];
    this.played = [];
    this.lastPlay = null;
    this.passes = 0;
    this.teamLevels = [2, 2];
    this.level = 2;
    this.previousWinningTeam = null;
    this.nextLeaderSeat = 0;
    this.finishOrder = [];
    this.upgrade = 0;
    this.winningTeam = null;
    this.score = 0;
  }
  get playing() {
    return this.stage === "playing";
  }
  get pot() {
    return this.score;
  }
  log(text) {
    this.history.unshift({ text, time: Date.now(), hand: this.hand });
    this.history = this.history.slice(0, 100);
  }
  addPlayer(name, options = {}) {
    if (this.playing || this.players.length >= 4)
      throw new Error("掼蛋恰好需要 4 位玩家，开局后不可入座");
    const seat = [0, 1, 2, 3].find(
      (s) => !this.players.some((p) => p.seat === s),
    );
    const p = {
      id: randomUUID(),
      name,
      stack: this.buyIn,
      connected: true,
      bot: false,
      avatar: seat,
      cards: [],
      inHand: false,
      action: "等待入局",
      ...options,
      seat,
    };
    this.players.push(p);
    this.players.sort((a, b) => a.seat - b.seat);
    this.version++;
    return p;
  }
  start() {
    if (this.playing) throw new Error("这一手还没结束");
    if (
      this.players.length !== 4 ||
      this.players.some(
        (p) => !p.connected || p.left || p.stack < this.baseStake,
      )
    )
      throw new Error(
        "需要恰好 4 位在线玩家，每人至少 10 筹码；不足请补充筹码",
      );
    this.hand++;
    this.version++;
    this.level =
      this.previousWinningTeam === null
        ? 2
        : this.teamLevels[this.previousWinningTeam];
    this.result = [];
    this.finishOrder = [];
    this.upgrade = 0;
    this.winningTeam = null;
    this.score = 0;
    this.played = [];
    this.lastPlay = null;
    this.passes = 0;
    const cards = deck();
    for (const p of this.players) {
      p.cards = sortCards(cards.splice(0, 27), this.level);
      p.inHand = true;
      p.action = "等待出牌";
    }
    this.stage = "playing";
    this.setTurn(this.players.findIndex((p) => p.seat === this.nextLeaderSeat));
    this.log(`第 ${this.hand} 手 · 打 ${this.level} · 红桃级牌为逢人配`);
  }
  setTurn(index) {
    this.turn = index;
    this.deadline = this.players[index].left
      ? Date.now()
      : Date.now() + this.actionTimeout;
  }
  nextActive(index) {
    for (let step = 1; step <= 4; step++) {
      const next = (index + step) % 4;
      if (this.players[next].cards.length) return next;
    }
    throw new Error("没有可行动玩家");
  }
  legal(id) {
    if (!this.playing || this.players[this.turn]?.id !== id) return null;
    return {
      actions: ["play", ...(this.lastPlay ? ["pass"] : []), "assist"],
      canPass: !!this.lastPlay,
    };
  }
  action(id, input) {
    const legal = this.legal(id);
    if (!legal) throw new Error("还没轮到你行动");
    if (!input || !legal.actions.includes(input.type))
      throw new Error("当前不能执行此操作");
    if (input.type === "assist") return this.automaticAction(id, true);
    const p = this.players[this.turn];
    if (input.type === "pass") {
      p.action = "不出";
      this.passes++;
      this.version++;
      this.log(`${p.name} · 不出`);
      const leader = this.lastPlay.playerIndex;
      const needed =
        this.players.filter((p) => p.cards.length).length -
        Number(this.players[leader].cards.length > 0);
      if (this.passes >= needed) {
        let next = leader;
        if (!this.players[leader].cards.length) {
          const partner = this.players.findIndex(
            (p) => p.seat === (this.players[leader].seat + 2) % 4,
          );
          next = this.players[partner].cards.length
            ? partner
            : this.nextActive(leader);
          this.log(`${this.players[next].name} · 接风领出`);
        }
        this.lastPlay = null;
        this.passes = 0;
        return this.setTurn(next);
      }
      return this.setTurn(this.nextActive(this.turn));
    }
    if (
      !Array.isArray(input.cards) ||
      !input.cards.length ||
      input.cards.length > 8 ||
      input.cards.some((id) => typeof id !== "string") ||
      new Set(input.cards).size !== input.cards.length
    )
      throw new Error("请选择 1–8 张不重复的手牌");
    const selected = input.cards.map((id) => p.cards.find((c) => c.id === id));
    if (selected.some((c) => !c)) throw new Error("只能打出自己的手牌");
    const combo = combinations(selected, this.level).find((c) =>
      beats(c, this.lastPlay?.combo),
    );
    if (!combo) throw new Error("牌型无效或不能压过上一手");
    const ids = new Set(input.cards);
    p.cards = p.cards.filter((c) => !ids.has(c.id));
    this.played.push(...selected);
    p.action = combo.name;
    this.lastPlay = {
      playerIndex: this.turn,
      name: p.name,
      cards: sortCards(selected, this.level),
      combo,
    };
    this.passes = 0;
    this.version++;
    this.log(`${p.name} · ${combo.name}`);
    if (!p.cards.length) {
      this.finishOrder.push(p.seat);
      p.action = `第 ${this.finishOrder.length} 名`;
      this.log(`${p.name} · 第 ${this.finishOrder.length} 名出完`);
      if (this.finishOrder.length === 3) {
        this.finishOrder.push(this.players.find((p) => p.cards.length).seat);
        return this.finish();
      }
    }
    this.setTurn(this.nextActive(this.turn));
  }
  finish() {
    if (!this.playing) return;
    const { team, upgrade } = upgradeFor(this.finishOrder);
    this.winningTeam = team;
    this.upgrade = upgrade;
    this.score = this.baseStake * upgrade;
    const winners = this.players.filter((p) => p.seat % 2 === team);
    const net = new Map(this.players.map((p) => [p.id, 0]));
    let pool = 0;
    for (const p of this.players.filter((p) => p.seat % 2 !== team)) {
      const paid = Math.min(this.score, p.stack);
      net.set(p.id, -paid);
      pool += paid;
    }
    winners.forEach((p, i) =>
      net.set(p.id, Math.floor(pool / 2) + (i === 0 ? pool % 2 : 0)),
    );
    this.teamLevels[team] = Math.min(14, this.teamLevels[team] + upgrade);
    this.previousWinningTeam = team;
    this.nextLeaderSeat = this.finishOrder[0];
    this.result = this.players.map((p) => {
      p.stack += net.get(p.id);
      const place = this.finishOrder.indexOf(p.seat) + 1;
      p.action = `第 ${place} 名`;
      return {
        id: p.id,
        name: p.name,
        seat: p.seat,
        team: p.seat % 2,
        place,
        won: p.seat % 2 === team,
        net: net.get(p.id),
      };
    });
    this.stage = "showdown";
    this.turn = -1;
    this.deadline = null;
    this.log(
      `${team + 1} 队获胜 · 升 ${upgrade} 级 · 每人每份 ${this.score} · 余额封顶均分`,
    );
  }
  automaticAction(id, bot) {
    if (!this.legal(id)) return;
    const p = this.players[this.turn];
    if (!bot)
      return this.action(
        id,
        this.lastPlay
          ? { type: "pass" }
          : { type: "play", cards: [p.cards[0].id] },
      );
    const moves = legalMoves(p.cards, this.lastPlay?.combo, this.level);
    const finish = moves.find((m) => m.count === p.cards.length);
    const partnerLeads =
      this.lastPlay &&
      this.players[this.lastPlay.playerIndex].seat % 2 === p.seat % 2;
    const move = finish || (!partnerLeads && moves[0]);
    return this.action(
      id,
      move ? { type: "play", cards: move.cards } : { type: "pass" },
    );
  }
  remove(id) {
    const p = this.players.find((p) => p.id === id);
    if (!p) return;
    p.left = true;
    p.connected = false;
    this.version++;
    if (this.playing && this.players[this.turn] === p)
      this.automaticAction(id, false);
  }
  prune() {
    if (this.playing) return;
    this.players = this.players.filter((p) => !p.left);
  }
  view(id) {
    const revealed = this.stage === "showdown";
    const mine = this.players.find((p) => p.id === id);
    this.arrangementCache ||= new Map();
    const key = `${this.level}:${mine?.cards.map((c) => c.id).join(",")}`;
    if (mine && this.arrangementCache.get(id)?.key !== key)
      this.arrangementCache.set(id, {
        key,
        plans: Object.fromEntries(
          ["balanced", "protect", "chains"].map((style) => [
            style,
            planHand(mine.cards, this.level, style),
          ]),
        ),
      });
    const hints =
      mine && this.legal(id)
        ? legalMoves(mine.cards, this.lastPlay?.combo, this.level)
        : [];
    const finish = hints.find((m) => m.count === mine.cards.length);
    const partnerLeads =
      !!this.lastPlay &&
      mine &&
      this.players[this.lastPlay.playerIndex].seat % 2 === mine.seat % 2;
    return {
      stage: this.stage,
      hand: this.hand,
      version: this.version,
      buyIn: this.buyIn,
      baseStake: this.baseStake,
      turn: this.turn,
      deadline: this.deadline,
      pot: this.pot,
      legal: this.legal(id),
      arrangements: mine ? this.arrangementCache.get(id).plans : {},
      recommendation: {
        preferPass: !!(partnerLeads && !finish),
        reason:
          partnerLeads && !finish
            ? "搭档领出，建议保留手牌，不压搭档。"
            : "优先较长、较低的合法组合；推荐只读取你的手牌。",
        options: (finish
          ? [finish, ...hints.filter((m) => m !== finish)]
          : hints
        ).slice(0, 8),
      },
      teamLevels: [...this.teamLevels],
      level: this.level,
      winningTeam: this.winningTeam,
      upgrade: this.upgrade,
      score: this.score,
      finishOrder: this.finishOrder.map((seat, i) => {
        const p =
          this.result.find((p) => p.seat === seat) ||
          this.players.find((p) => p.seat === seat);
        return { seat, id: p.id, name: p.name, place: i + 1, team: seat % 2 };
      }),
      lastPlay: this.lastPlay,
      passes: this.passes,
      history: this.history,
      result: this.result,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        stack: p.stack,
        seat: p.seat,
        team: p.seat % 2,
        connected: p.connected,
        bot: p.bot,
        avatar: p.avatar,
        left: !!p.left,
        inHand: p.inHand,
        action: p.action,
        remaining: p.cards.length,
        place: this.finishOrder.indexOf(p.seat) + 1,
        cards: p.cards.map((c) => (revealed || p.id === id ? c : null)),
      })),
    };
  }
}
