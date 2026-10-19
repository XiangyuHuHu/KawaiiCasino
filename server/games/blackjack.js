import { randomInt, randomUUID } from "node:crypto";

// Betting varies by bankroll and personality; this does not predict the next cards.
export function botBet(stack, minBet, style, choice = randomInt(4)) {
  const fractions = [
    [0.005, 0.0075, 0.01, 0.015],
    [0.01, 0.015, 0.02, 0.025],
    [0.015, 0.02, 0.03, 0.04],
  ];
  const fraction = fractions[style % 3][choice % 4];
  return Math.min(
    stack,
    Math.max(minBet, Math.floor((stack * fraction) / minBet) * minBet),
  );
}

export function handValue(cards) {
  let total = 0,
    aces = 0;
  for (const { rank } of cards) {
    if (rank === 14) {
      total += 11;
      aces++;
    } else total += Math.min(rank, 10);
  }
  while (total > 21 && aces) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

function shuffle(cards) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
export function shoe() {
  const cards = [];
  for (let deck = 0; deck < 6; deck++)
    for (const suit of ["s", "h", "d", "c"])
      for (let rank = 2; rank <= 14; rank++) cards.push({ rank, suit });
  return shuffle(cards);
}
const natural = (h) =>
  !h.split && h.cards.length === 2 && handValue(h.cards).total === 21;
const newHand = (bet, cards = [], split = false) => ({
  cards,
  bet,
  split,
  done: false,
  settled: false,
  payout: 0,
  outcome: null,
});

export class BlackjackTable {
  constructor({ stack = 10000, actionTimeout = 35000 } = {}) {
    this.buyIn = stack;
    this.actionTimeout = actionTimeout;
    this.minBet = 10;
    this.players = [];
    this.cards = shoe();
    this.discards = [];
    this.dealerCards = [];
    this.stage = "waiting";
    this.turn = -1;
    this.activeHand = 0;
    this.deadline = null;
    this.hand = 0;
    this.version = 0;
    this.history = [];
    this.result = [];
    // Stakes enter the house when paid; payouts leave it. May be negative.
    this.houseNet = 0;
    this.roundHouseNet = 0;
  }
  get playing() {
    return !["waiting", "showdown"].includes(this.stage);
  }
  get pot() {
    return this.players.reduce(
      (sum, p) => sum + p.hands.reduce((n, h) => n + h.bet, 0),
      0,
    );
  }
  log(text) {
    this.history.unshift({ text, time: Date.now(), hand: this.hand });
    this.history = this.history.slice(0, 100);
  }
  addPlayer(name, options = {}) {
    if (this.players.length >= 5) throw new Error("牌桌已满，最多 5 位玩家");
    const p = {
      id: randomUUID(),
      name,
      stack: this.buyIn,
      connected: true,
      bot: false,
      avatar: this.players.length % 8,
      inHand: false,
      hands: [],
      action: "等待入局",
      ...options,
    };
    this.players.push(p);
    this.version++;
    return p;
  }
  start() {
    if (this.playing) throw new Error("这一手还没结束");
    const eligible = (p) => p.connected && !p.left && p.stack >= this.minBet;
    if (!this.players.some(eligible))
      throw new Error("至少需要一位有 10 筹码的在线玩家");
    if (this.cards.length < 312 * 0.25) {
      this.cards = shoe();
      this.discards = [];
    } else {
      this.discards.push(
        ...this.dealerCards,
        ...this.players.flatMap((p) => p.hands.flatMap((h) => h.cards)),
      );
    }
    this.hand++;
    this.version++;
    this.result = [];
    this.dealerCards = [];
    this.roundHouseNet = 0;
    this.stage = "betting";
    for (const p of this.players) {
      p.inHand = eligible(p);
      p.hands = [];
      p.action = p.inHand ? "等待下注" : "等待下一手";
    }
    this.log(`第 ${this.hand} 手开始 · 最低下注 ${this.minBet}`);
    this.advanceBetting();
  }
  setTurn(index, hand = 0) {
    this.turn = index;
    this.activeHand = hand;
    this.deadline = Date.now() + this.actionTimeout;
  }
  legal(id) {
    const p = this.players[this.turn];
    if (!this.playing || !p || p.id !== id) return null;
    if (this.stage === "betting")
      return { actions: ["bet"], min: this.minBet, max: p.stack };
    const h = p.hands[this.activeHand];
    if (!h || h.done) return null;
    const actions = ["hit", "stand"];
    if (h.cards.length === 2 && p.stack >= h.bet) {
      actions.push("double");
      if (p.hands.length === 1 && h.cards[0].rank === h.cards[1].rank)
        actions.push("split");
    }
    return { actions, handIndex: this.activeHand };
  }
  pay(p, amount) {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > p.stack)
      throw new Error("筹码不足或下注金额无效");
    p.stack -= amount;
    this.houseNet += amount;
    this.roundHouseNet += amount;
  }
  draw() {
    // Extremely long split rounds can exhaust the shoe before the next cut.
    // Recycle only previous rounds' discards, never cards in the current round.
    if (!this.cards.length) this.cards = shuffle(this.discards.splice(0));
    const card = this.cards.pop();
    if (!card) throw new Error("牌鞋已空");
    return card;
  }
  action(id, input) {
    return this.act(id, input.type, input.amount);
  }
  act(id, type, amount) {
    const legal = this.legal(id);
    if (!legal) throw new Error("还没轮到你行动");
    if (!legal.actions.includes(type)) throw new Error("当前不能执行此操作");
    const p = this.players[this.turn];
    if (type === "bet") {
      if (
        !Number.isSafeInteger(amount) ||
        amount < legal.min ||
        amount > legal.max
      )
        throw new Error("下注金额无效，至少 10 且不能超过筹码");
      this.pay(p, amount);
      p.hands = [newHand(amount)];
      p.action = `下注 ${amount}`;
    } else {
      const h = p.hands[this.activeHand];
      if (type === "split") {
        this.pay(p, h.bet);
        const ace = h.cards[0].rank === 14;
        p.hands = [
          newHand(h.bet, [h.cards[0], this.draw()], true),
          newHand(h.bet, [h.cards[1], this.draw()], true),
        ];
        for (const split of p.hands)
          split.done = ace || handValue(split.cards).total === 21;
      } else {
        if (type === "double") {
          this.pay(p, h.bet);
          h.bet *= 2;
        }
        if (type === "hit" || type === "double") h.cards.push(this.draw());
        const total = handValue(h.cards).total;
        h.done = type !== "hit" || total >= 21;
        if (total > 21) this.settle(p, h, "bust", 0);
      }
      p.action = { hit: "要牌", stand: "停牌", double: "加倍", split: "分牌" }[
        type
      ];
    }
    this.log(`${p.name} · ${p.action}`);
    this.version++;
    if (this.stage === "betting") this.advanceBetting();
    else this.advancePlay();
  }
  advanceBetting() {
    const index = this.players.findIndex(
      (p) => p.inHand && !p.hands.length && !p.left,
    );
    if (index >= 0) return this.setTurn(index);
    const active = this.players.filter((p) => p.hands.length);
    if (!active.length) return this.finish();
    // Two passes around the table, dealer last on each pass (second is hole card).
    for (let pass = 0; pass < 2; pass++) {
      for (const p of active) p.hands[0].cards.push(this.draw());
      this.dealerCards.push(this.draw());
    }
    this.stage = "playing";
    for (const p of active) if (natural(p.hands[0])) p.hands[0].done = true;
    if (handValue(this.dealerCards).total === 21) return this.finish();
    this.advancePlay();
  }
  advancePlay() {
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      for (let j = 0; j < p.hands.length; j++) {
        const h = p.hands[j];
        if (p.left) h.done = true;
        if (!h.done) return this.setTurn(i, j);
      }
    }
    this.finish();
  }
  settle(p, h, outcome, payout) {
    if (h.settled) return;
    h.done = true;
    h.settled = true;
    h.outcome = outcome;
    h.payout = payout;
    p.stack += payout;
    this.houseNet -= payout;
    this.roundHouseNet -= payout;
    this.result.push({
      id: p.id,
      name: p.name,
      handIndex: p.hands.indexOf(h),
      bet: h.bet,
      payout,
      net: payout - h.bet,
      outcome,
    });
  }
  finish() {
    const hands = this.players.flatMap((p) => p.hands);
    // No extra draws needed if all hands busted or have natural blackjack.
    if (hands.some((h) => !h.settled && !natural(h)))
      while (handValue(this.dealerCards).total < 17)
        this.dealerCards.push(this.draw());
    const dealer = handValue(this.dealerCards).total;
    const dealerNatural = this.dealerCards.length === 2 && dealer === 21;
    for (const p of this.players)
      for (const h of p.hands) {
        if (h.settled) continue;
        const total = handValue(h.cards).total;
        if (total > 21) this.settle(p, h, "bust", 0);
        else if (natural(h) && !dealerNatural)
          this.settle(p, h, "blackjack", h.bet + Math.floor(h.bet * 1.5));
        else if (dealerNatural && !natural(h)) this.settle(p, h, "lose", 0);
        else if (total === dealer) this.settle(p, h, "push", h.bet);
        else if (dealer > 21 || total > dealer)
          this.settle(p, h, "win", h.bet * 2);
        else this.settle(p, h, "lose", 0);
      }
    this.stage = "showdown";
    this.turn = -1;
    this.deadline = null;
    this.log(`本手结算 · 庄家净盈亏 ${this.roundHouseNet}`);
  }
  automaticAction(id, bot) {
    const legal = this.legal(id);
    if (!legal) return;
    if (this.stage === "betting")
      return this.act(
        id,
        "bet",
        bot
          ? botBet(legal.max, this.minBet, this.players[this.turn].avatar)
          : this.minBet,
      );
    if (!bot) return this.act(id, "stand");
    const p = this.players[this.turn],
      h = p.hands[this.activeHand];
    const { total, soft } = handValue(h.cards);
    const rank = this.dealerCards[0].rank;
    const up = rank === 14 ? 11 : Math.min(10, rank);
    let type = "stand";
    if (legal.actions.includes("split") && [14, 8].includes(h.cards[0].rank))
      type = "split";
    else if (
      legal.actions.includes("double") &&
      ((!soft && total === 11) || (!soft && total === 10 && up < 10))
    )
      type = "double";
    else if (
      soft
        ? total < 18 || (total === 18 && up >= 9)
        : total < 12 ||
          (total === 12 && (up < 4 || up > 6)) ||
          (total < 17 && up >= 7)
    )
      type = "hit";
    this.act(id, type);
  }
  remove(id) {
    const p = this.players.find((p) => p.id === id);
    if (!p) return;
    p.left = true;
    p.connected = false;
    this.version++;
    if (this.stage === "betting") this.advanceBetting();
    else if (this.playing) this.advancePlay();
  }
  prune() {
    if (this.playing) return;
    for (const p of this.players)
      if (p.left) this.discards.push(...p.hands.flatMap((h) => h.cards));
    this.players = this.players.filter((p) => !p.left);
  }
  view(id) {
    const revealed = this.stage === "showdown";
    return {
      stage: this.stage,
      hand: this.hand,
      version: this.version,
      buyIn: this.buyIn,
      minBet: this.minBet,
      turn: this.turn,
      activeHand: this.activeHand,
      deadline: this.deadline,
      pot: this.pot,
      legal: this.legal(id),
      dealerCards: this.dealerCards.map((c, i) =>
        i === 1 && !revealed ? null : c,
      ),
      dealerValue:
        revealed && this.dealerCards.length
          ? handValue(this.dealerCards)
          : null,
      shoeRemaining: this.cards.length,
      exposedDiscards: this.discards.map((c) => ({ ...c })),
      houseNet: this.houseNet,
      roundHouseNet: this.roundHouseNet,
      history: this.history,
      result: this.result,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        stack: p.stack,
        avatar: p.avatar,
        connected: p.connected,
        bot: p.bot,
        left: !!p.left,
        inHand: p.inHand,
        action: p.action,
        hands: p.hands.map((h) => ({ ...h, value: handValue(h.cards) })),
      })),
    };
  }
}
