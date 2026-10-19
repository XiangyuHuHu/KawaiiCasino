import { GuandanTable } from "./guandan.js";
import { MahjongTable } from "./mahjong.js";
import { PokerTable } from "./poker.js";
import { BlackjackTable } from "./blackjack.js";
import { DoudizhuTable } from "./doudizhu.js";
import { RouletteTable } from "./roulette.js";

// Register future games here; the room service only uses the engine contract.
export const games = new Map([
  [
    "roulette",
    {
      Engine: RouletteTable,
      name: "轮盘",
      minPlayers: 1,
      maxPlayers: 8,
      bots: true,
      practiceBots: 3,
      blurb: "单零／双零／三零，支持号码及外围投注。各格等概率，结果独立。",
    },
  ],
  [
    "poker",
    {
      Engine: PokerTable,
      name: "德州扑克",
      minPlayers: 2,
      maxPlayers: 8,
      bots: true,
      practiceBots: 3,
      blurb: "2–8 人无限注。对手底牌在有资格摊牌前隐藏。",
    },
  ],
  [
    "blackjack",
    {
      Engine: BlackjackTable,
      name: "21点",
      minPlayers: 1,
      maxPlayers: 5,
      bots: true,
      practiceBots: 4,
      blurb:
        "6 副牌，软 17 停牌，黑杰克 3:2 向下取整。可加倍、分牌一次；无保险、无投降。",
    },
  ],
  [
    "doudizhu",
    {
      Engine: DoudizhuTable,
      name: "斗地主",
      minPlayers: 3,
      maxPlayers: 3,
      bots: true,
      practiceBots: 2,
      blurb: "经典牌型，叫分 1–3，有春天/反春。无加倍、抢地主、癞子。",
    },
  ],
  [
    "mahjong",
    {
      Engine: MahjongTable,
      name: "麻将",
      minPlayers: 4,
      maxPlayers: 4,
      bots: true,
      practiceBots: 3,
      blurb:
        "简化四川：定缺、无吃、截胡，第一位胡牌结束，七对，番封顶 3。无血战、刮风下雨、查叫。",
    },
  ],
  [
    "guandan",
    {
      Engine: GuandanTable,
      name: "掼蛋",
      minPlayers: 4,
      maxPlayers: 4,
      bots: true,
      practiceBots: 3,
      blurb:
        "0/2 对 1/3，逢人配，炸弹升级，搭档接风。无进贡；级别到 A 后继续。",
    },
  ],
]);

export function gameMetadata(type) {
  const game = games.get(type);
  if (!game) throw new Error("未知游戏类型");
  const { Engine, ...metadata } = game;
  return { gameType: type, ...metadata };
}
