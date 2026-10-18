import { GuandanTable } from "./guandan.js";
import { MahjongTable } from "./mahjong.js";
import { PokerTable } from "./poker.js";
import { BlackjackTable } from "./blackjack.js";
import { DoudizhuTable } from "./doudizhu.js";

// Register future games here; the room service only uses the engine contract.
export const games = new Map([
  [
    "poker",
    {
      Engine: PokerTable,
      name: "德州扑克",
      minPlayers: 2,
      maxPlayers: 8,
      bots: true,
      practiceBots: 3,
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
    },
  ],
]);

export function gameMetadata(type) {
  const game = games.get(type);
  if (!game) throw new Error("未知游戏类型");
  const { Engine, ...metadata } = game;
  return { gameType: type, ...metadata };
}
