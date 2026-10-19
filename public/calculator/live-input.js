const rankText = (rank) =>
  ({ 11: "J", 12: "Q", 13: "K", 14: "A" })[rank] || String(rank);
const cardText = (card) => `${rankText(card.rank)}${card.suit}`;
const ranks = (cards) => cards.map((card) => rankText(card.rank)).join(" ");
export function buildLiveInput(state, model = "finite", rouletteBet = null) {
  if (!state) return null;
  const me = state.players.find((p) => p.id === state.me);
  if (!me) return null;
  if (state.gameType === "poker") {
    if (
      !me.inHand ||
      me.folded ||
      me.cards.length !== 2 ||
      me.cards.some((c) => !c) ||
      ["waiting", "showdown"].includes(state.stage)
    )
      return null;
    const opponents = state.players.filter(
      (p) => p.id !== me.id && p.inHand && !p.folded,
    );
    if (!opponents.length) return null;
    const input = {
      hero: me.cards.map(cardText).join(" "),
      board: state.board.map(cardText).join(" "),
      dead: "",
      opponents: opponents.map(() => "?"),
      bankroll: Math.max(me.stack, 1),
      pot: Math.max(state.pot, 0.01),
      call: state.legal?.call || 0,
      rake: 0,
      rakeCap: 0,
      samples: 3000,
      seed: 20261012,
    };
    const key = JSON.stringify({
      hero: input.hero,
      board: input.board,
      opponents: opponents.map((p) => p.id),
    });
    return {
      game: "poker",
      input,
      key,
      info: {
        sidePots:
          opponents.some((p) => p.stack === 0) ||
          me.stack === 0 ||
          (state.legal?.toCall || 0) > (state.legal?.call || 0),
        river: state.stage === "river",
      },
    };
  }
  if (state.gameType === "blackjack") {
    if (state.stage !== "playing" || !state.dealerCards[0]) return null;
    const index =
      state.players[state.turn]?.id === me.id
        ? state.activeHand
        : me.hands.findIndex((h) => !h.done && !h.settled);
    const hand = me.hands[index];
    if (!hand || hand.done || hand.settled || hand.cards.length < 2)
      return null;
    const seen = [
      ...(state.exposedDiscards || []),
      ...state.players.flatMap((p) =>
        p.hands.flatMap((h, i) =>
          p.id === me.id && i === index ? [] : h.cards,
        ),
      ),
    ];
    const input = {
      player: ranks(hand.cards),
      dealer: rankText(state.dealerCards[0].rank),
      seen: ranks(seen),
      decks: 6,
      bankroll: me.stack + hand.bet,
      stake: hand.bet,
      payout: 1.5,
      payoutRounding: true,
      naturalEligible: !hand.split,
      peek: true,
      h17: false,
      double: hand.cards.length === 2 && me.stack >= hand.bet,
      surrender: false,
      model,
    };
    return {
      game: "blackjack",
      input,
      key: JSON.stringify(input),
      info: {
        split: hand.split,
        pair:
          hand.cards.length === 2 && hand.cards[0].rank === hand.cards[1].rank,
        handIndex: index,
      },
    };
  }
  if (state.gameType === "roulette" && rouletteBet) {
    const input = {
      wheel: state.wheel,
      bet: rouletteBet.kind,
      bankroll: Math.max(rouletteBet.amount || 10, me.stack, 1),
      stake: rouletteBet.amount || 10,
      rounds: 1,
      partage: !!state.partage && rouletteBet.payout === 1,
    };
    return {
      game: "roulette",
      input,
      key: JSON.stringify(input),
      info: { settled: state.stage === "showdown" },
    };
  }
  return null;
}
