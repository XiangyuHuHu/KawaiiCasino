import { randomInt, randomUUID } from "node:crypto";
import {
  rouletteNumbers,
  resolveBet,
} from "../../public/calculator/roulette-rules.js";
import { botBet } from "./blackjack.js";

export class RouletteTable {
  constructor({
    stack = 10000,
    actionTimeout = 35000,
    wheel = "european",
    partage = false,
  } = {}) {
    this.pockets = rouletteNumbers(wheel);
    this.wheel = wheel;
    this.partage = !!partage && wheel === "european";
    this.buyIn = stack;
    this.actionTimeout = actionTimeout;
    this.minBet = 10;
    this.players = [];
    this.stage = "waiting";
    this.turn = -1;
    this.deadline = null;
    this.hand = 0;
    this.version = 0;
    this.history = [];
    this.result = [];
    this.number = null;
    this.houseNet = 0;
    this.roundHouseNet = 0;
  }
  get playing() {
    return this.stage === "betting";
  }
  get pot() {
    return this.players.reduce((sum, p) => sum + (p.bet?.amount || 0), 0);
  }
  log(text) {
    this.history.unshift({ text, time: Date.now(), hand: this.hand });
    this.history = this.history.slice(0, 100);
  }
  addPlayer(name, options = {}) {
    if (this.players.length >= 8) throw new Error("最多8位玩家");
    const p = {
      id: randomUUID(),
      name,
      stack: this.buyIn,
      bot: false,
      connected: true,
      avatar: this.players.length % 8,
      left: false,
      inHand: false,
      bet: null,
      done: false,
      action: "等待入局",
      ...options,
    };
    this.players.push(p);
    this.version++;
    return p;
  }
  start() {
    if (this.playing) throw new Error("这一局还没结束");
    if (
      !this.players.some(
        (p) => p.connected && !p.left && p.stack >= this.minBet,
      )
    )
      throw new Error("至少需要一位有10筹码的玩家");
    this.hand++;
    this.version++;
    this.number = null;
    this.result = [];
    this.roundHouseNet = 0;
    this.stage = "betting";
    for (const p of this.players) {
      p.inHand = p.connected && !p.left && p.stack >= this.minBet;
      p.bet = null;
      p.done = !p.inHand;
      p.action = p.inHand ? "等待下注" : "等待下一局";
    }
    this.log(`第${this.hand}局轮盘开始`);
    this.advance();
  }
  legal(id) {
    const p = this.players[this.turn];
    return this.playing && p?.id === id
      ? {
          actions: ["bet", "skip"],
          min: this.minBet,
          max: Math.min(p.stack, 1000000),
        }
      : null;
  }
  advance() {
    const index = this.players.findIndex((p) => p.inHand && !p.done && !p.left);
    if (index < 0) return this.finish();
    this.turn = index;
    this.deadline = Date.now() + this.actionTimeout;
  }
  action(id, input) {
    const l = this.legal(id);
    if (!l) throw new Error("还没轮到你下注");
    const p = this.players[this.turn];
    if (input.type === "bet") {
      const amount = input.amount;
      if (!Number.isSafeInteger(amount) || amount < l.min || amount > l.max)
        throw new Error("下注金额无效或筹码不足");
      const bet = resolveBet(this.wheel, input.bet, input.numbers);
      const half = this.partage && bet.payout === 1;
      if (half && amount % 2) throw new Error("零点退半的外围投注需要偶数筹码");
      p.bet = { ...bet, amount, partage: half };
      p.stack -= amount;
      this.houseNet += amount;
      this.roundHouseNet += amount;
      p.action = `下注${amount} · ${bet.name}`;
    } else if (input.type === "skip") p.action = "本局不下注";
    else throw new Error("无效的轮盘操作");
    p.done = true;
    this.version++;
    this.log(`${p.name} · ${p.action}`);
    this.advance();
  }
  finish() {
    this.number = this.pockets[randomInt(this.pockets.length)];
    this.result = this.players
      .filter((p) => p.inHand)
      .map((p) => {
        const bet = p.bet;
        const won = !!bet?.numbers.includes(this.number);
        const payout = bet
          ? won
            ? bet.amount * (bet.payout + 1)
            : this.number === "0" && bet.partage
              ? bet.amount / 2
              : 0
          : 0;
        p.stack += payout;
        this.houseNet -= payout;
        this.roundHouseNet -= payout;
        const net = payout - (bet?.amount || 0);
        p.action = bet
          ? won
            ? "命中"
            : payout
              ? "零点退半"
              : "未命中"
          : "未下注";
        return {
          id: p.id,
          name: p.name,
          won,
          payout,
          net,
          bet: bet?.amount || 0,
        };
      });
    this.stage = "showdown";
    this.turn = -1;
    this.deadline = null;
    this.log(`轮盘结果 ${this.number} · 庄家净盈亏 ${this.roundHouseNet}`);
  }
  automaticAction(id, bot) {
    const l = this.legal(id);
    if (!l) return;
    if (!bot) return this.action(id, { type: "skip" });
    const p = this.players[this.turn],
      kinds = ["red", "black", "odd", "even", "low", "high", "straight"];
    const bet = kinds[randomInt(kinds.length)];
    return this.action(id, {
      type: "bet",
      bet,
      numbers: this.pockets[randomInt(this.pockets.length)],
      amount: botBet(l.max, this.minBet, p.avatar),
    });
  }
  remove(id) {
    const p = this.players.find((p) => p.id === id);
    if (!p) return;
    p.left = true;
    p.connected = false;
    this.version++;
    if (this.playing && this.players[this.turn] === p) {
      p.done = true;
      this.advance();
    }
  }
  prune() {
    if (!this.playing) this.players = this.players.filter((p) => !p.left);
  }
  view(id) {
    return {
      stage: this.stage,
      hand: this.hand,
      version: this.version,
      buyIn: this.buyIn,
      minBet: this.minBet,
      wheel: this.wheel,
      partage: this.partage,
      pockets: this.pockets,
      number: this.number,
      turn: this.turn,
      deadline: this.deadline,
      pot: this.pot,
      legal: this.legal(id),
      history: this.history,
      result: this.result,
      houseNet: this.houseNet,
      roundHouseNet: this.roundHouseNet,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        stack: p.stack,
        connected: p.connected,
        bot: p.bot,
        avatar: p.avatar,
        left: p.left,
        inHand: p.inHand,
        bet: p.bet,
        action: p.action,
      })),
    };
  }
}
