import { PokerTable } from "./poker.js";
import { BlackjackTable } from "./blackjack.js";

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
]);

export function gameMetadata(type) {
  const game = games.get(type);
  if (!game) throw new Error("未知游戏类型");
  const { Engine, ...metadata } = game;
  return { gameType: type, ...metadata };
}
