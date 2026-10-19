import { randomInt, randomUUID } from "node:crypto";

export const combinationNames = {
  single: "单张",
  pair: "对子",
  triple: "三张",
  tripleSingle: "三带一",
  triplePair: "三带二",
  straight: "顺子",
  pairStraight: "连对",
  plane: "飞机",
  planeSingle: "飞机带单",
  planePair: "飞机带对",
  fourSingle: "四带二单",
  fourPair: "四带两对",
  bomb: "炸弹",
  rocket: "王炸",
};

export function deck() {
  const cards = [];
  for (const suit of ["s", "h", "d", "c"])
    for (let rank = 3; rank <= 15; rank++)
      cards.push({ id: `${suit}${rank}`, rank, suit });
  cards.push(
    { id: "j16", rank: 16, suit: "j" },
    { id: "j17", rank: 17, suit: "j" },
  );
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
const sortCards = (cards) =>
  cards.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
const consecutive = (ranks) =>
  ranks.at(-1) <= 14 && ranks.every((r, i) => !i || r === ranks[i - 1] + 1);
function groups(cards) {
  const map = new Map();
  for (const c of cards) {
    if (!map.has(c.rank)) map.set(c.rank, []);
    map.get(c.rank).push(c);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

// A selection can have more than one airplane interpretation. Keep all of them
// so a legal response is not rejected merely because the first parsing differs.
export function combinations(cards) {
  if (!Array.isArray(cards) || !cards.length || cards.length > 20) return [];
  if (
    cards.some(
      (c) => !c || !Number.isInteger(c.rank) || c.rank < 3 || c.rank > 17,
    )
  )
    return [];
  const g = groups(cards),
    n = cards.length,
    out = [];
  if (g.some(([r, cs]) => cs.length > (r >= 16 ? 1 : 4))) return [];
  const add = (type, main, length = 1) =>
    out.push({ type, main, length, count: n, name: combinationNames[type] });
  const ofCount = (k) => g.filter(([, cs]) => cs.length === k).map(([r]) => r);
  if (n === 1) add("single", g[0][0]);
  if (n === 2 && g.length === 2 && g[0][0] === 16 && g[1][0] === 17)
    add("rocket", 17);
  if (g.length === 1) {
    if (n === 2) add("pair", g[0][0]);
    if (n === 3) add("triple", g[0][0]);
    if (n === 4) add("bomb", g[0][0]);
  }
  if (n === 4 && ofCount(3).length) add("tripleSingle", ofCount(3)[0]);
  if (n === 5 && ofCount(3).length && ofCount(2).length)
    add("triplePair", ofCount(3)[0]);
  if (n >= 5 && g.length === n && consecutive(g.map(([r]) => r)))
    add("straight", g.at(-1)[0], n);
  if (
    n >= 6 &&
    n % 2 === 0 &&
    ofCount(2).length === n / 2 &&
    consecutive(ofCount(2))
  )
    add("pairStraight", g.at(-1)[0], n / 2);
  if (ofCount(4).length === 1) {
    if (n === 6) add("fourSingle", ofCount(4)[0]);
    if (n === 8 && ofCount(2).length === 2) add("fourPair", ofCount(4)[0]);
  }
  for (const [type, size] of [
    ["plane", 3],
    ["planeSingle", 4],
    ["planePair", 5],
  ]) {
    const length = n / size;
    if (!Number.isInteger(length) || length < 2) continue;
    for (let start = 3; start + length - 1 <= 14; start++) {
      const core = g.filter(([r]) => r >= start && r < start + length);
      if (core.length !== length || core.some(([, cs]) => cs.length !== 3))
        continue;
      const wings = g.filter(([r]) => r < start || r >= start + length);
      if (type === "plane" && wings.length) continue;
      if (
        type === "planePair" &&
        (wings.length !== length || wings.some(([, cs]) => cs.length !== 2))
      )
        continue;
      add(type, start + length - 1, length);
    }
  }
  return out;
}
export const classify = (cards) => combinations(cards)[0] || null;
export function beats(move, previous) {
  if (!move) return false;
  if (!previous) return true;
  if (previous.type === "rocket") return false;
  if (move.type === "rocket") return true;
  if (move.type === "bomb" && previous.type !== "bomb") return true;
  return (
    move.type === previous.type &&
    move.length === previous.length &&
    move.count === previous.count &&
    move.main > previous.main
  );
}

// Construct low-rank representatives of every shape rather than enumerating
// 2^20 subsets. Wings never affect comparison, so one valid wing choice suffices.
export function legalMoves(cards, previous = null) {
  const g = groups(cards),
    moves = [],
    seen = new Set();
  const add = (cs) => {
    const key = cs
      .map((c) => c.id)
      .sort()
      .join(",");
    if (seen.has(key)) return;
    seen.add(key);
    const combo = combinations(cs).find((c) => beats(c, previous));
    if (combo) moves.push({ cards: cs.map((c) => c.id), ...combo });
  };
  const attach = (core, count, pairs) => {
    const ranks = new Set(core.map((c) => c.rank));
    const rest = g.filter(([r]) => !ranks.has(r));
    const wings = pairs
      ? rest
          .filter(([, cs]) => cs.length >= 2)
          .slice(0, count)
          .flatMap(([, cs]) => cs.slice(0, 2))
      : rest.flatMap(([, cs]) => cs).slice(0, count);
    if (wings.length === count * (pairs ? 2 : 1)) add([...core, ...wings]);
  };
  for (const [, cs] of g) {
    for (let k = 1; k <= cs.length; k++) add(cs.slice(0, k));
    if (cs.length >= 3) {
      attach(cs.slice(0, 3), 1, false);
      attach(cs.slice(0, 3), 1, true);
    }
    if (cs.length === 4) {
      attach(cs, 2, false);
      attach(cs, 2, true);
    }
  }
  for (const [copies, minimum] of [
    [1, 5],
    [2, 3],
    [3, 2],
  ]) {
    for (let start = 3; start <= 14; start++) {
      const core = [];
      for (let rank = start; rank <= 14; rank++) {
        const cs = g.find(([r]) => r === rank)?.[1];
        if (!cs || cs.length < copies) break;
        core.push(...cs.slice(0, copies));
        const length = rank - start + 1;
        if (length < minimum) continue;
        add([...core]);
        if (copies === 3) {
          attach(core, length, false);
          attach(core, length, true);
        }
      }
    }
  }
  const jokers = cards.filter((c) => c.rank >= 16);
  if (jokers.length === 2) add(jokers);
  return moves.sort(
    (a, b) =>
      Number(["bomb", "rocket"].includes(a.type)) -
        Number(["bomb", "rocket"].includes(b.type)) ||
      b.count - a.count ||
      a.main - b.main,
  );
}

export class DoudizhuTable {
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
    this.bottom = [];
    this.played = [];
    this.landlord = -1;
    this.bid = 0;
    this.bombs = 0;
    this.rockets = 0;
    this.spring = null;
    this.score = 0;
    this.lastPlay = null;
    this.passes = 0;
    this.nextFirstBidder = randomInt(3);
  }
  get playing() {
    return !["waiting", "showdown"].includes(this.stage);
  }
  get pot() {
    return (
      this.score || this.baseStake * this.bid * 2 ** (this.bombs + this.rockets)
    );
  }
  log(text) {
    this.history.unshift({ text, time: Date.now(), hand: this.hand });
    this.history = this.history.slice(0, 100);
  }
  addPlayer(name, options = {}) {
    if (this.players.length >= 3)
      throw new Error("斗地主恰好需要 3 位玩家，牌桌已满");
    const p = {
      id: randomUUID(),
      name,
      stack: this.buyIn,
      connected: true,
      bot: false,
      avatar: this.players.length,
      cards: [],
      inHand: false,
      action: "等待入局",
      ...options,
    };
    this.players.push(p);
    this.version++;
    return p;
  }
  start() {
    if (this.playing) throw new Error("这一手还没结束");
    if (
      this.players.length !== 3 ||
      this.players.some(
        (p) => !p.connected || p.left || p.stack < this.baseStake,
      )
    )
      throw new Error(
        "需要恰好 3 位在线玩家，每人至少 10 筹码；不足请补充筹码",
      );
    this.hand++;
    this.version++;
    this.redeals = 0;
    this.result = [];
    this.firstBidder = this.nextFirstBidder;
    this.nextFirstBidder = (this.nextFirstBidder + 1) % 3;
    this.deal();
  }
  deal() {
    const cards = deck();
    for (const p of this.players) {
      p.cards = sortCards(cards.splice(0, 17));
      p.inHand = true;
      p.action = "等待叫分";
      p.bid = null;
      p.playCount = 0;
    }
    this.bottom = cards;
    this.played = [];
    this.landlord = -1;
    this.bid = 0;
    this.bidCount = 0;
    this.bombs = 0;
    this.rockets = 0;
    this.spring = null;
    this.score = 0;
    this.lastPlay = null;
    this.passes = 0;
    this.stage = "bidding";
    this.setTurn(this.firstBidder);
    this.log(
      `第 ${this.hand} 手${this.redeals ? ` · 重发 ${this.redeals}` : ""} · ${this.players[this.turn].name} 先叫分`,
    );
  }
  setTurn(index) {
    this.turn = index;
    this.deadline = this.players[index].left
      ? Date.now()
      : Date.now() + this.actionTimeout;
  }
  legal(id) {
    if (!this.playing || this.players[this.turn]?.id !== id) return null;
    if (this.stage === "bidding")
      return {
        actions: ["bid", "assist"],
        bids: [0, 1, 2, 3].filter((n) => !n || n > this.bid),
      };
    return {
      actions: ["play", ...(this.lastPlay ? ["pass"] : []), "assist"],
      canPass: !!this.lastPlay,
    };
  }
  action(id, input) {
    const legal = this.legal(id);
    if (!legal) throw new Error("还没轮到你行动");
    if (!legal.actions.includes(input.type))
      throw new Error("当前不能执行此操作");
    if (input.type === "assist") return this.automaticAction(id, true);
    const p = this.players[this.turn];
    if (input.type === "bid") {
      if (!Number.isInteger(input.amount) || !legal.bids.includes(input.amount))
        throw new Error("叫分必须为不叫或比当前更高的 1 / 2 / 3 分");
      p.bid = input.amount;
      p.action = input.amount ? `叫 ${input.amount} 分` : "不叫";
      this.bidCount++;
      if (input.amount) {
        this.bid = input.amount;
        this.landlord = this.turn;
      }
      this.log(`${p.name} · ${p.action}`);
      this.version++;
      if (this.bid === 3 || this.bidCount === 3) {
        if (this.landlord >= 0) return this.beginPlay();
        if (this.redeals < 3) {
          this.redeals++;
          this.firstBidder = (this.firstBidder + 1) % 3;
          return this.deal();
        }
        this.landlord = this.firstBidder;
        this.bid = 1;
        this.log("连续不叫达到上限，首叫者强制 1 分地主");
        return this.beginPlay();
      }
      return this.setTurn((this.turn + 1) % 3);
    }
    if (input.type === "pass") {
      p.action = "不出";
      this.passes++;
      this.log(`${p.name} · 不出`);
      this.version++;
      if (this.passes === 2) {
        const leader = this.lastPlay.playerIndex;
        this.lastPlay = null;
        this.passes = 0;
        return this.setTurn(leader);
      }
      return this.setTurn((this.turn + 1) % 3);
    }
    if (
      !Array.isArray(input.cards) ||
      !input.cards.length ||
      input.cards.length > 20 ||
      input.cards.some((id) => typeof id !== "string") ||
      new Set(input.cards).size !== input.cards.length
    )
      throw new Error("请选择不重复的手牌");
    const selected = input.cards.map((id) => p.cards.find((c) => c.id === id));
    if (selected.some((c) => !c)) throw new Error("只能打出自己的手牌");
    const combo = combinations(selected).find((c) =>
      beats(c, this.lastPlay?.combo),
    );
    if (!combo) throw new Error("牌型无效或不能压过上一手");
    const ids = new Set(input.cards);
    p.cards = p.cards.filter((c) => !ids.has(c.id));
    this.played.push(...selected);
    p.playCount++;
    p.action = combo.name;
    this.lastPlay = {
      playerIndex: this.turn,
      name: p.name,
      cards: sortCards(selected),
      combo,
    };
    this.passes = 0;
    if (combo.type === "bomb") this.bombs++;
    if (combo.type === "rocket") this.rockets++;
    this.log(
      `${p.name} · ${combo.name}（${selected.map((c) => ({ 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2", 16: "小王", 17: "大王" })[c.rank] || c.rank).join(" ")}）`,
    );
    this.version++;
    if (!p.cards.length) return this.finish(this.turn);
    this.setTurn((this.turn + 1) % 3);
  }
  beginPlay() {
    const p = this.players[this.landlord];
    this.landlordId = p.id;
    p.cards = sortCards([...p.cards, ...this.bottom]);
    p.action = "地主先出";
    this.stage = "playing";
    this.setTurn(this.landlord);
    this.log(`${p.name} 成为 ${this.bid} 分地主 · 底牌公开`);
  }
  finish(winner) {
    if (this.stage !== "playing") return;
    const landlordWins = winner === this.landlord;
    const farmers = this.players
      .map((p, i) => i)
      .filter((i) => i !== this.landlord);
    this.spring =
      landlordWins && farmers.every((i) => this.players[i].playCount === 0)
        ? "春天"
        : !landlordWins && this.players[this.landlord].playCount === 1
          ? "反春"
          : null;
    this.score =
      this.baseStake *
      this.bid *
      2 ** (this.bombs + this.rockets + (this.spring ? 1 : 0));
    const net = [0, 0, 0],
      landlord = this.players[this.landlord];
    if (landlordWins) {
      for (const i of farmers) {
        const paid = Math.min(this.score, this.players[i].stack);
        net[i] -= paid;
        net[this.landlord] += paid;
      }
    } else {
      const paid = Math.min(this.score * 2, landlord.stack);
      net[this.landlord] = -paid;
      farmers.forEach((i, order) => {
        net[i] = Math.floor(paid / 2) + (order === 0 ? paid % 2 : 0);
      });
    }
    this.result = this.players.map((p, i) => {
      p.stack += net[i];
      const won = landlordWins === (i === this.landlord);
      p.action = won ? "获胜" : "落败";
      return {
        id: p.id,
        name: p.name,
        net: net[i],
        won,
        role: i === this.landlord ? "地主" : "农民",
      };
    });
    this.stage = "showdown";
    this.turn = -1;
    this.deadline = null;
    this.log(
      `${landlordWins ? "地主" : "农民"}获胜${this.spring ? ` · ${this.spring}` : ""} · 每份 ${this.score} · 按余额封顶结算`,
    );
  }
  automaticAction(id, bot) {
    if (!this.legal(id)) return;
    const p = this.players[this.turn];
    if (this.stage === "bidding") {
      const strength =
        p.cards.filter((c) => c.rank >= 15).length +
        groups(p.cards).filter(([, cs]) => cs.length === 4).length * 2;
      const bid = bot ? Math.min(3, Math.floor(strength / 2)) : 0;
      return this.action(id, { type: "bid", amount: bid > this.bid ? bid : 0 });
    }
    if (!bot)
      return this.action(
        id,
        this.lastPlay
          ? { type: "pass" }
          : { type: "play", cards: [p.cards[0].id] },
      );
    const moves = legalMoves(p.cards, this.lastPlay?.combo);
    const finish = moves.find((m) => m.count === p.cards.length);
    const teammate =
      this.lastPlay &&
      this.turn !== this.landlord &&
      this.lastPlay.playerIndex !== this.landlord;
    const move = finish || (!teammate && moves[0]);
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
    this.landlord = this.players.findIndex((p) => p.id === this.landlordId);
  }
  view(id) {
    const revealed = this.stage === "showdown";
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
      landlord: this.landlord,
      bid: this.bid,
      firstBidder: this.firstBidder,
      redeals: this.redeals || 0,
      bombs: this.bombs,
      rockets: this.rockets,
      spring: this.spring,
      score: this.score,
      lastPlay: this.lastPlay,
      passes: this.passes,
      bottom: this.bottom.map((c) => (this.stage === "bidding" ? null : c)),
      history: this.history,
      result: this.result,
      players: this.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        stack: p.stack,
        connected: p.connected,
        bot: p.bot,
        avatar: p.avatar,
        left: !!p.left,
        inHand: p.inHand,
        action: p.action,
        bid: p.bid,
        role: revealed
          ? this.result.find((r) => r.id === p.id)?.role || "待定"
          : this.landlord < 0
            ? "待定"
            : i === this.landlord
              ? "地主"
              : "农民",
        remaining: p.cards.length,
        cards: p.cards.map((c) => (revealed || p.id === id ? c : null)),
      })),
    };
  }
}
