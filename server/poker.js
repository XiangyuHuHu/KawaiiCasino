import { randomInt, randomUUID } from "node:crypto";

export const HAND_NAMES = [
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
export function deck() {
  const cards = [];
  for (const suit of ["s", "h", "d", "c"])
    for (let rank = 2; rank <= 14; rank++) cards.push({ rank, suit });
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
const value = (parts) => parts.reduce((score, rank) => score * 15 + rank, 0);
function five(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const groups = [...new Set(ranks)]
    .map((r) => [ranks.filter((x) => x === r).length, r])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const unique = [...new Set(ranks)];
  const straight =
    unique.length === 5 &&
    (ranks[0] - ranks[4] === 4
      ? ranks[0]
      : ranks.join() === "14,5,4,3,2"
        ? 5
        : 0);
  let result;
  if (flush && straight) result = [8, straight];
  else if (groups[0][0] === 4) result = [7, groups[0][1], groups[1][1]];
  else if (groups[0][0] === 3 && groups[1][0] === 2)
    result = [6, groups[0][1], groups[1][1]];
  else if (flush) result = [5, ...ranks];
  else if (straight) result = [4, straight];
  else if (groups[0][0] === 3) result = [3, ...groups.map((g) => g[1])];
  else if (groups[0][0] === 2 && groups[1][0] === 2)
    result = [2, ...groups.map((g) => g[1])];
  else if (groups[0][0] === 2) result = [1, ...groups.map((g) => g[1])];
  else result = [0, ...ranks];
  return {
    category: result[0],
    name: HAND_NAMES[result[0]],
    score: value([...result, ...Array(6 - result.length).fill(0)]),
  };
}
export function evaluate(cards) {
  if (cards.length < 5 || cards.length > 7) throw new Error("需要 5 到 7 张牌");
  let best = { score: -1 };
  for (let a = 0; a < cards.length - 4; a++)
    for (let b = a + 1; b < cards.length - 3; b++)
      for (let c = b + 1; c < cards.length - 2; c++)
        for (let d = c + 1; d < cards.length - 1; d++)
          for (let e = d + 1; e < cards.length; e++) {
            const selected = [cards[a], cards[b], cards[c], cards[d], cards[e]];
            const result = five(selected);
            if (result.score > best.score)
              best = { ...result, cards: selected };
          }
  return best;
}

export class Table {
  constructor({ smallBlind = 50, stack = 10000 } = {}) {
    this.smallBlind = smallBlind;
    this.bigBlind = smallBlind * 2;
    this.buyIn = stack;
    this.players = [];
    this.dealer = -1;
    this.turn = -1;
    this.stage = "waiting";
    this.board = [];
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.hand = 0;
    this.version = 0;
    this.history = [];
    this.result = [];
    this.pots = [];
    this.deadline = null;
  }
  addPlayer(name, options = {}) {
    if (this.players.length >= 8) throw new Error("牌桌已满，最多 8 位玩家");
    const p = {
      id: randomUUID(),
      name,
      stack: this.buyIn,
      bet: 0,
      total: 0,
      cards: [],
      folded: false,
      inHand: false,
      connected: true,
      bot: false,
      avatar: this.players.length % 8,
      actedAtBet: null,
      action: "等待入局",
      ...options,
    };
    this.players.push(p);
    this.version++;
    return p;
  }
  get playing() {
    return !["waiting", "showdown"].includes(this.stage);
  }
  get live() {
    return this.players.filter((p) => p.inHand && !p.folded);
  }
  get pot() {
    return this.players.reduce((sum, p) => sum + p.total, 0);
  }
  log(text) {
    this.history.unshift({ text, time: Date.now(), hand: this.hand });
    this.history = this.history.slice(0, 100);
  }
  nextSeat(index, predicate) {
    for (let step = 1; step <= this.players.length; step++) {
      const i = (index + step) % this.players.length;
      if (predicate(this.players[i])) return i;
    }
    return -1;
  }
  pay(p, amount) {
    const n = Math.min(p.stack, amount);
    p.stack -= n;
    p.bet += n;
    p.total += n;
    return n;
  }
  start() {
    if (this.playing) throw new Error("这一手还没结束");
    const eligible = (p) => p.connected && p.stack > 0;
    if (this.players.filter(eligible).length < 2)
      throw new Error("至少需要两位有筹码的在线玩家");
    this.hand++;
    this.version++;
    this.board = [];
    this.result = [];
    this.pots = [];
    this.cards = deck();
    this.stage = "preflop";
    this.currentBet = this.bigBlind;
    this.minRaise = this.bigBlind;
    for (const p of this.players) {
      p.inHand = eligible(p);
      p.folded = false;
      p.bet = 0;
      p.total = 0;
      p.actedAtBet = null;
      p.cards = p.inHand ? [this.cards.pop(), this.cards.pop()] : [];
      p.action = p.inHand ? "思考中" : "等待下一手";
    }
    this.dealer = this.nextSeat(this.dealer, (p) => p.inHand);
    const sb =
      this.live.length === 2
        ? this.dealer
        : this.nextSeat(this.dealer, (p) => p.inHand);
    const bb = this.nextSeat(sb, (p) => p.inHand);
    this.sb = sb;
    this.bb = bb;
    this.pay(this.players[sb], this.smallBlind);
    this.players[sb].action = "小盲";
    this.pay(this.players[bb], this.bigBlind);
    this.players[bb].action = "大盲";
    this.log(
      `第 ${this.hand} 手开始 · 盲注 ${this.smallBlind}/${this.bigBlind}`,
    );
    this.advance(bb);
  }
  legal(id) {
    const p = this.players.find((p) => p.id === id);
    if (!p || !this.playing || this.players[this.turn]?.id !== id) return null;
    const call = Math.max(0, this.currentBet - p.bet);
    return {
      call: Math.min(call, p.stack),
      toCall: call,
      min: this.currentBet + this.minRaise,
      max: p.bet + p.stack,
      canRaise:
        p.stack > call &&
        (p.actedAtBet === null ||
          this.currentBet - p.actedAtBet >= this.minRaise),
    };
  }
  act(id, type, amount) {
    const legal = this.legal(id);
    if (!legal) throw new Error("还没轮到你行动");
    const p = this.players[this.turn];
    if (type === "fold") {
      p.folded = true;
      p.action = "已弃牌";
    } else if (type === "check") {
      if (legal.toCall) throw new Error("需要跟注或弃牌");
      p.action = "过牌";
    } else if (type === "call") {
      const paid = this.pay(p, legal.toCall);
      p.action = p.stack ? `跟注 ${paid}` : "全下";
    } else if (type === "raise" || type === "allin") {
      const target = type === "allin" ? legal.max : amount;
      if (
        !Number.isSafeInteger(target) ||
        target <= p.bet ||
        target > legal.max
      )
        throw new Error("下注金额无效");
      if (target <= this.currentBet) {
        if (target !== legal.max) throw new Error("请选择跟注");
        this.pay(p, target - p.bet);
        p.action = "全下";
      } else {
        if (!legal.canRaise) throw new Error("不足额全下没有重新开放加注");
        if (target < legal.min && target !== legal.max)
          throw new Error(`至少加注到 ${legal.min}`);
        const increase = target - this.currentBet;
        this.pay(p, target - p.bet);
        this.currentBet = target;
        if (increase >= this.minRaise) this.minRaise = increase;
        p.action = p.stack ? `加注至 ${target}` : "全下";
      }
    } else throw new Error("未知操作");
    p.actedAtBet = this.currentBet;
    this.log(`${p.name} · ${p.action}`);
    this.version++;
    this.advance(this.turn);
  }
  advance(from) {
    if (this.live.length === 1) return this.finish(false);
    const actionable = this.live.filter((p) => p.stack > 0);
    const needs = (p) =>
      p.inHand &&
      !p.folded &&
      p.stack > 0 &&
      (p.actedAtBet === null || p.bet < this.currentBet);
    // A lone player cannot bet against an all-in player; allow an outstanding call first.
    const pending =
      actionable.length > 1
        ? this.players.some(needs)
        : actionable.some((p) => p.bet < this.currentBet);
    if (pending) {
      this.turn = this.nextSeat(from, needs);
      this.deadline = Date.now() + 35000;
      if (this.players[this.turn].left)
        this.act(this.players[this.turn].id, "fold");
      return;
    }
    if (this.stage === "river") return this.finish(true);
    for (const p of this.players) {
      p.bet = 0;
      p.actedAtBet = null;
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.cards.pop(); // burn card
    const count = this.stage === "preflop" ? 3 : 1;
    for (let i = 0; i < count; i++) this.board.push(this.cards.pop());
    this.stage = { preflop: "flop", flop: "turn", turn: "river" }[this.stage];
    this.log(
      `发出${{ flop: "翻牌", turn: "转牌", river: "河牌" }[this.stage]}`,
    );
    if (actionable.length <= 1) return this.advance(this.dealer);
    this.turn = this.nextSeat(this.dealer, needs);
    this.deadline = Date.now() + 35000;
    if (this.players[this.turn].left)
      this.act(this.players[this.turn].id, "fold");
  }
  finish(showdown) {
    const scores = new Map(
      this.live.map((p) => [
        p.id,
        showdown
          ? evaluate([...p.cards, ...this.board])
          : { score: 0, name: "其余玩家弃牌" },
      ]),
    );
    const levels = [
      ...new Set(this.players.map((p) => p.total).filter(Boolean)),
    ].sort((a, b) => a - b);
    const awards = new Map();
    let previous = 0;
    for (const level of levels) {
      const contributors = this.players.filter((p) => p.total >= level);
      const amount = (level - previous) * contributors.length;
      previous = level;
      // Uncalled excess belongs to its contributor, including a player who left.
      if (contributors.length === 1) {
        const p = contributors[0];
        p.stack += amount;
        this.pots.push({ amount, winners: [p.id], refund: true });
        continue;
      }
      const eligible = contributors.filter((p) => scores.has(p.id));
      if (!eligible.length) throw new Error("底池没有符合资格的玩家");
      const highest = Math.max(...eligible.map((p) => scores.get(p.id).score));
      const winners = eligible.filter(
        (p) => scores.get(p.id).score === highest,
      );
      // Odd chips go clockwise from the button.
      winners.sort(
        (a, b) =>
          ((this.players.indexOf(a) - this.dealer - 1 + this.players.length) %
            this.players.length) -
          ((this.players.indexOf(b) - this.dealer - 1 + this.players.length) %
            this.players.length),
      );
      winners.forEach((p, i) => {
        const win =
          Math.floor(amount / winners.length) +
          (i < amount % winners.length ? 1 : 0);
        p.stack += win;
        awards.set(p.id, (awards.get(p.id) || 0) + win);
      });
      this.pots.push({ amount, winners: winners.map((p) => p.id) });
    }
    this.result = [...awards].map(([id, amount]) => ({
      id,
      name: this.players.find((p) => p.id === id).name,
      amount,
      handName: scores.get(id).name,
    }));
    this.showCards = showdown;
    this.stage = "showdown";
    this.turn = -1;
    this.deadline = null;
    this.log(
      this.result
        .map((r) => `${r.name} 赢得 ${r.amount} · ${r.handName}`)
        .join(" / "),
    );
  }
  remove(id) {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) return;
    const p = this.players[i];
    p.connected = false;
    p.left = true;
    if (this.playing && p.inHand && !p.folded && p.stack > 0) {
      p.action = "离桌待弃牌";
      this.log(`${p.name} 离开牌桌`);
      // Fold on the player's turn, preserving existing side-pot eligibility until then.
      if (i === this.turn) this.act(p.id, "fold");
    }
    this.version++;
  }
  prune() {
    if (this.playing) return;
    const dealerId = this.players[this.dealer]?.id;
    this.players = this.players.filter((p) => !p.left);
    this.dealer = this.players.findIndex((p) => p.id === dealerId);
  }
  view(id) {
    return {
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      buyIn: this.buyIn,
      dealer: this.dealer,
      sb: this.sb,
      bb: this.bb,
      turn: this.turn,
      stage: this.stage,
      hand: this.hand,
      version: this.version,
      board: this.board,
      currentBet: this.currentBet,
      pot: this.pot,
      result: this.result,
      pots: this.pots,
      history: this.history,
      deadline: this.deadline,
      legal: this.legal(id),
      myHand:
        this.players.find((p) => p.id === id)?.cards.length === 2 &&
        this.board.length >= 3
          ? evaluate([
              ...this.players.find((p) => p.id === id).cards,
              ...this.board,
            ]).name
          : null,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        stack: p.stack,
        bet: p.bet,
        total: p.total,
        folded: p.folded,
        inHand: p.inHand,
        connected: p.connected,
        bot: p.bot,
        avatar: p.avatar,
        action: p.action,
        left: !!p.left,
        cards:
          p.id === id ||
          (this.stage === "showdown" && this.showCards && p.inHand && !p.folded)
            ? p.cards
            : p.cards.map(() => null),
      })),
    };
  }
}
