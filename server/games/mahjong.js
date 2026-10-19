import { randomInt, randomUUID } from "node:crypto";

export const suits = ["wan", "tiao", "tong"];
export const suitNames = { wan: "万", tiao: "条", tong: "筒" };
const key = (t) => suits.indexOf(t.suit) * 9 + t.rank - 1;
const same = (a, b) => a.suit === b.suit && a.rank === b.rank;
const sort = (tiles) =>
  tiles.sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id));
export function deck() {
  const tiles = [];
  for (const suit of suits)
    for (let rank = 1; rank <= 9; rank++)
      for (let copy = 0; copy < 4; copy++)
        tiles.push({ id: `${suit}${rank}-${copy}`, suit, rank });
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}
function sets(counts, sequences = true) {
  const i = counts.findIndex((n) => n > 0);
  if (i < 0) return true;
  if (counts[i] >= 3) {
    counts[i] -= 3;
    const ok = sets(counts, sequences);
    counts[i] += 3;
    if (ok) return true;
  }
  if (sequences && i % 9 < 7 && counts[i + 1] && counts[i + 2]) {
    counts[i]--;
    counts[i + 1]--;
    counts[i + 2]--;
    const ok = sets(counts, sequences);
    counts[i]++;
    counts[i + 1]++;
    counts[i + 2]++;
    if (ok) return true;
  }
  return false;
}
// Return every relevant shape, since a hand may admit both sequences and triplets.
export function winningShape(tiles, melds = [], voidSuit = null) {
  if (
    !Array.isArray(tiles) ||
    !Array.isArray(melds) ||
    melds.length > 4 ||
    tiles.length !== 14 - melds.length * 3
  )
    return null;
  const all = [...tiles, ...melds.flatMap((m) => m.tiles || [])];
  const full = Array(27).fill(0);
  for (const t of all) {
    if (
      !t ||
      !suits.includes(t.suit) ||
      !Number.isInteger(t.rank) ||
      t.rank < 1 ||
      t.rank > 9 ||
      t.suit === voidSuit ||
      ++full[key(t)] > 4
    )
      return null;
  }
  for (const m of melds) {
    if (
      !["pong", "kong", "concealedKong", "addedKong"].includes(m.type) ||
      m.tiles.length !== (m.type === "pong" ? 3 : 4) ||
      !m.tiles.every((t) => same(t, m.tiles[0]))
    )
      return null;
  }
  const counts = Array(27).fill(0);
  for (const t of tiles) counts[key(t)]++;
  const sevenPairs = !melds.length && counts.every((n) => n % 2 === 0);
  let standard = false,
    allTriplets = false;
  for (let i = 0; i < 27; i++) {
    if (counts[i] < 2) continue;
    counts[i] -= 2;
    standard ||= sets(counts);
    allTriplets ||= sets(counts, false);
    counts[i] += 2;
  }
  return standard || sevenPairs ? { standard, sevenPairs, allTriplets } : null;
}
export const canWin = (tiles, melds = [], voidSuit = null) =>
  !!winningShape(tiles, melds, voidSuit);
export function scoreHand(
  tiles,
  melds = [],
  voidSuit = null,
  kongDraw = false,
) {
  const shape = winningShape(tiles, melds, voidSuit);
  if (!shape) return null;
  const patterns = [],
    add = (name, fan) => patterns.push({ name, fan });
  if (shape.allTriplets) add("对对胡", 1);
  if (
    new Set([...tiles, ...melds.flatMap((m) => m.tiles)].map((t) => t.suit))
      .size === 1
  )
    add("清一色", 2);
  if (shape.sevenPairs) add("七对", 2);
  const kongs = melds.filter((m) => m.type !== "pong").length;
  if (kongs) add("杠", kongs);
  if (kongDraw) add("杠上开花", 1);
  const rawFan = patterns.reduce((n, p) => n + p.fan, 0),
    fan = Math.min(3, rawFan);
  return {
    fan,
    rawFan,
    multiplier: 2 ** fan,
    patterns: patterns.length ? patterns : [{ name: "平胡", fan: 0 }],
  };
}
export function fewestSuit(tiles) {
  return [...suits].sort(
    (a, b) =>
      tiles.filter((t) => t.suit === a).length -
      tiles.filter((t) => t.suit === b).length,
  )[0];
}

export class MahjongTable {
  constructor({ stack = 10000, actionTimeout = 35000 } = {}) {
    this.buyIn = stack;
    this.actionTimeout = actionTimeout;
    this.claimTimeout = Math.min(actionTimeout, 8000);
    this.baseStake = 10;
    this.players = [];
    this.stage = "waiting";
    this.turn = -1;
    this.deadline = null;
    this.hand = 0;
    this.version = 0;
    this.history = [];
    this.result = [];
    this.wall = [];
    this.discards = [];
    this.discardHistory = [];
    this.lastDiscard = null;
    this.dealer = -1;
    this.nextDealer = 0;
    this.claims = [];
    this.outcome = null;
    this.score = 0;
  }
  get playing() {
    return !["waiting", "showdown"].includes(this.stage);
  }
  get pot() {
    return this.score;
  }
  log(text) {
    this.history.unshift({ text, time: Date.now(), hand: this.hand });
    this.history = this.history.slice(0, 100);
  }
  addPlayer(name, options = {}) {
    if (this.players.length >= 4)
      throw new Error("麻将恰好需要 4 位玩家，牌桌已满");
    const p = {
      id: randomUUID(),
      name,
      stack: this.buyIn,
      connected: true,
      bot: false,
      avatar: this.players.length,
      inHand: false,
      tiles: [],
      melds: [],
      voidSuit: null,
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
    this.dealer = this.nextDealer % 4;
    this.wall = deck();
    this.discards = [];
    this.discardHistory = [];
    this.claims = [];
    this.lastDiscard = null;
    this.result = [];
    this.outcome = null;
    this.score = 0;
    for (const p of this.players) {
      p.tiles = [];
      p.melds = [];
      p.voidSuit = null;
      p.inHand = true;
      p.action = "等待定缺";
    }
    for (let i = 0; i < 13; i++)
      for (let j = 0; j < 4; j++)
        this.players[(this.dealer + j) % 4].tiles.push(this.wall.shift());
    this.players[this.dealer].tiles.push(this.wall.shift());
    for (const p of this.players) sort(p.tiles);
    this.hasDraw = true;
    this.kongDraw = false;
    this.stage = "void";
    this.setTurn(this.dealer);
    this.log(
      `第 ${this.hand} 手 · ${this.players[this.dealer].name} 坐庄 · 开始定缺`,
    );
  }
  setTurn(index) {
    this.turn = index;
    this.deadline =
      Date.now() +
      (this.players[index].left
        ? 0
        : this.stage === "claim"
          ? this.claimTimeout
          : this.actionTimeout);
  }
  discardable(p) {
    const missing = p.tiles.filter((t) => t.suit === p.voidSuit);
    return sort([...(missing.length ? missing : p.tiles)]);
  }
  kongOptions(p) {
    if (!this.hasDraw || !this.wall.length) return [];
    const options = [];
    for (const t of p.tiles) {
      if (t.suit === p.voidSuit) continue;
      const matching = p.tiles.filter((v) => same(v, t));
      if (matching.length === 4)
        options.push({ type: "concealedKong", tile: t.id });
      if (p.melds.some((m) => m.type === "pong" && same(m.tiles[0], t)))
        options.push({ type: "addedKong", tile: t.id });
    }
    return options;
  }
  legal(id) {
    if (!this.playing || this.players[this.turn]?.id !== id) return null;
    const p = this.players[this.turn];
    if (this.stage === "void") return { actions: ["void", "assist"], suits };
    if (this.stage === "claim")
      return { actions: [...this.claims[0].actions, "pass", "assist"] };
    const kongs = this.kongOptions(p),
      actions = ["discard", "assist"];
    if (this.hasDraw && canWin(p.tiles, p.melds, p.voidSuit))
      actions.push("hu");
    for (const o of kongs) if (!actions.includes(o.type)) actions.push(o.type);
    return { actions, discards: this.discardable(p).map((t) => t.id), kongs };
  }
  action(id, input) {
    const l = this.legal(id);
    if (!l) throw new Error("还没轮到你行动");
    if (!input || !l.actions.includes(input.type))
      throw new Error("当前不能执行此操作");
    if (input.type === "assist") return this.automaticAction(id, true);
    const p = this.players[this.turn],
      index = this.turn;
    if (input.type === "void") {
      if (!suits.includes(input.suit)) throw new Error("请选择万、条或筒定缺");
      p.voidSuit = input.suit;
      p.action = `缺${suitNames[input.suit]}`;
      this.log(`${p.name} · ${p.action}`);
      this.version++;
      const next = (index + 1) % 4;
      if (this.players[next].voidSuit === null) return this.setTurn(next);
      this.stage = "playing";
      return this.setTurn(this.dealer);
    }
    if (input.type === "hu") {
      this.version++;
      return this.finish(
        index,
        this.stage === "claim" ? this.lastDiscard.playerIndex : null,
      );
    }
    if (this.stage === "claim") {
      this.version++;
      if (input.type === "pass") {
        p.action = "过";
        this.claims.shift();
        return this.advanceClaim();
      }
      const tile = this.lastDiscard.tile;
      const count = input.type === "kong" ? 3 : 2;
      const chosen = p.tiles.filter((t) => same(t, tile)).slice(0, count);
      p.tiles = p.tiles.filter((t) => !chosen.includes(t));
      p.melds.push({
        type: input.type,
        tiles: [...chosen, tile],
        from: this.lastDiscard.playerIndex,
      });
      this.discards.pop();
      this.lastDiscard.claimed = true;
      const record = this.discardHistory.at(-1);
      if (record) {
        record.claimType = input.type;
        record.claimedBy = p.name;
      }
      this.claims = [];
      this.stage = "playing";
      p.action = input.type === "kong" ? "明杠" : "碰";
      this.log(`${p.name} · ${p.action}`);
      this.hasDraw = false;
      this.kongDraw = false;
      if (input.type === "kong") return this.draw(index, true);
      return this.setTurn(index);
    }
    if (input.type === "concealedKong" || input.type === "addedKong") {
      const option = l.kongs.find(
        (o) => o.type === input.type && o.tile === input.tile,
      );
      if (!option) throw new Error("请选择可杠的手牌");
      const tile = p.tiles.find((t) => t.id === input.tile);
      if (input.type === "concealedKong") {
        const chosen = p.tiles.filter((t) => same(t, tile));
        p.tiles = p.tiles.filter((t) => !chosen.includes(t));
        p.melds.push({ type: input.type, tiles: chosen });
      } else {
        p.tiles = p.tiles.filter((t) => t !== tile);
        const meld = p.melds.find(
          (m) => m.type === "pong" && same(m.tiles[0], tile),
        );
        meld.type = "addedKong";
        meld.tiles.push(tile);
      }
      p.action = input.type === "concealedKong" ? "暗杠" : "加杠";
      this.log(`${p.name} · ${p.action}`);
      this.version++;
      return this.draw(index, true);
    }
    if (!l.discards.includes(input.tile))
      throw new Error("只能打出自己的手牌，有缺门牌时必须先打缺门牌");
    const tile = p.tiles.find((t) => t.id === input.tile);
    p.tiles = p.tiles.filter((t) => t !== tile);
    this.discards.push(tile);
    this.lastDiscard = {
      tile,
      playerIndex: index,
      name: p.name,
      claimed: false,
    };
    this.discardHistory.push({
      sequence: this.discardHistory.length + 1,
      playerId: p.id,
      name: p.name,
      tile,
      claimType: null,
      claimedBy: null,
    });
    p.action = `打 ${tile.rank}${suitNames[tile.suit]}`;
    this.log(`${p.name} · ${p.action}`);
    this.version++;
    this.hasDraw = false;
    this.kongDraw = false;
    this.openClaims(index, tile);
  }
  openClaims(discarder, tile) {
    const wins = [],
      melds = [];
    for (let offset = 1; offset < 4; offset++) {
      const i = (discarder + offset) % 4,
        p = this.players[i];
      if (canWin([...p.tiles, tile], p.melds, p.voidSuit))
        wins.push({ index: i, actions: ["hu"] });
      const n = p.tiles.filter((t) => same(t, tile)).length;
      if (tile.suit !== p.voidSuit && n >= 2 && this.wall.length)
        melds.push({
          index: i,
          actions: ["pong", ...(n >= 3 ? ["kong"] : [])],
        });
    }
    this.claims = [...wins, ...melds];
    this.stage = "claim";
    this.advanceClaim();
  }
  advanceClaim() {
    if (!this.claims.length)
      return this.draw((this.lastDiscard.playerIndex + 1) % 4);
    this.setTurn(this.claims[0].index);
    // Claims do not wait for the general bot delay; humans retain their full window.
    const p = this.players[this.turn];
    if (p.bot || p.left) this.automaticAction(p.id, p.bot);
  }
  draw(index, replacement = false) {
    if (!this.wall.length) return this.finish();
    this.players[index].tiles.push(
      replacement ? this.wall.pop() : this.wall.shift(),
    );
    sort(this.players[index].tiles);
    this.stage = "playing";
    this.hasDraw = true;
    this.kongDraw = replacement;
    this.setTurn(index);
  }
  finish(winner = null, discarder = null) {
    if (!this.playing) return;
    const net = [0, 0, 0, 0];
    if (winner !== null) {
      const p = this.players[winner];
      const tiles =
        discarder === null ? p.tiles : [...p.tiles, this.lastDiscard.tile];
      const scoring = scoreHand(
        tiles,
        p.melds,
        p.voidSuit,
        discarder === null && this.kongDraw,
      );
      if (!scoring) throw new Error("当前手牌不能胡牌");
      this.score = this.baseStake * scoring.multiplier;
      const selfDraw = discarder === null;
      if (!selfDraw && this.discardHistory.at(-1)) {
        this.discardHistory.at(-1).claimType = "hu";
        this.discardHistory.at(-1).claimedBy = p.name;
      }
      const payment = this.score + (selfDraw ? this.baseStake : 0);
      for (let i = 0; i < 4; i++)
        if (i !== winner && (selfDraw || i === discarder)) {
          const paid = Math.min(payment, this.players[i].stack);
          net[i] -= paid;
          net[winner] += paid;
        }
      this.outcome = {
        winner,
        winnerId: p.id,
        winnerName: p.name,
        discarder,
        discarderId: discarder === null ? null : this.players[discarder].id,
        selfDraw,
        ...scoring,
        payment,
        winningTile: selfDraw ? null : this.lastDiscard.tile,
      };
      this.nextDealer = winner;
      this.log(
        `${p.name} · ${selfDraw ? "自摸" : "点炮胡"} · ${scoring.patterns.map((v) => v.name).join("、")} · ${scoring.multiplier}倍 · 按余额封顶结算`,
      );
    } else {
      this.outcome = { draw: true };
      this.nextDealer = (this.dealer + 1) % 4;
      this.log("流局 · 不查叫、不查花猪 · 无支付");
    }
    this.result = this.players.map((p, i) => {
      p.stack += net[i];
      p.action =
        winner === null
          ? "流局"
          : winner === i
            ? "胡牌"
            : discarder === i
              ? "点炮"
              : "本手结束";
      return { id: p.id, name: p.name, net: net[i], won: winner === i };
    });
    this.stage = "showdown";
    this.turn = -1;
    this.deadline = null;
    this.claims = [];
  }
  automaticAction(id, bot) {
    const l = this.legal(id);
    if (!l) return;
    const p = this.players[this.turn];
    if (this.stage === "void")
      return this.action(id, { type: "void", suit: fewestSuit(p.tiles) });
    if (this.stage === "claim")
      return this.action(id, {
        type: bot
          ? ["hu", "kong", "pong"].find((a) => l.actions.includes(a)) || "pass"
          : "pass",
      });
    if (bot && l.actions.includes("hu")) return this.action(id, { type: "hu" });
    if (bot && l.kongs.length) return this.action(id, l.kongs[0]);
    const candidates = this.discardable(p);
    // Keep pairs and nearby tiles. This heuristic only reads the bot's own hand.
    const utility = (t) =>
      p.tiles.filter((c) => same(t, c)).length * 3 +
      p.tiles.filter(
        (c) =>
          c.suit === t.suit &&
          Math.abs(c.rank - t.rank) <= 2 &&
          c.rank !== t.rank,
      ).length;
    const tile = bot
      ? [...candidates].sort(
          (a, b) => utility(a) - utility(b) || key(a) - key(b),
        )[0]
      : candidates[0];
    return this.action(id, { type: "discard", tile: tile.id });
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
    const nextId = this.players[this.nextDealer]?.id;
    const dealerId = this.players[this.dealer]?.id;
    this.players = this.players.filter((p) => !p.left);
    this.dealer = this.players.findIndex((p) => p.id === dealerId);
    if (this.outcome && !this.outcome.draw) {
      this.outcome.winner = this.players.findIndex(
        (p) => p.id === this.outcome.winnerId,
      );
      this.outcome.discarder = this.outcome.selfDraw
        ? null
        : this.players.findIndex((p) => p.id === this.outcome.discarderId);
    }
    this.nextDealer = Math.max(
      0,
      this.players.findIndex((p) => p.id === nextId),
    );
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
      dealer: this.dealer,
      wallRemaining: this.wall.length,
      discards: this.discards,
      discardHistory: this.discardHistory.map((record) => ({
        ...record,
        tile: { ...record.tile },
      })),
      lastDiscard: this.lastDiscard,
      outcome: this.outcome,
      score: this.score,
      result: this.result,
      history: this.history,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        stack: p.stack,
        connected: p.connected,
        bot: p.bot,
        avatar: p.avatar,
        left: !!p.left,
        inHand: p.inHand,
        action: p.action,
        voidSuit: p.voidSuit,
        remaining: p.tiles.length,
        tiles: p.tiles.map((t) => (revealed || p.id === id ? t : null)),
        melds: p.melds.map((m) => ({
          ...m,
          tiles: m.tiles.map((t) =>
            m.type !== "concealedKong" || revealed || p.id === id ? t : null,
          ),
        })),
      })),
    };
  }
}
