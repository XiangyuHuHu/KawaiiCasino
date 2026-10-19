const outcomes = {
  win: "获胜",
  lose: "落败",
  blackjack: "黑杰克",
  push: "平局",
  bust: "爆牌",
};

export function renderBlackjack(state, { $, card, avatar, esc, fmt, online }) {
  const me = state.players.find((p) => p.id === state.me);
  const host = state.hostId === state.me;
  const playing = !["waiting", "showdown"].includes(state.stage);
  $("#board-area").innerHTML =
    `<div class="board-status">自动庄家 · 软 17 停牌${state.dealerValue ? ` · ${state.dealerValue.total} 点` : ""}</div><div class="community-cards">${state.dealerCards.length ? state.dealerCards.map((c) => card(c)).join("") : card(null, true) + card(null, true)}</div><div class="hand-hint">庄家累计净盈亏 ${fmt(state.houseNet)} · 本手 ${fmt(state.roundHouseNet)}</div>`;
  $("#seats").innerHTML = state.players
    .map(
      (p, index) =>
        `<article class="bj-seat ${p.id === state.me ? "me" : ""} ${state.turn === index ? "current" : ""}"><div class="bj-player"><span class="avatar">${avatar(p.avatar)}</span><div><div class="seat-name">${esc(p.name)}${p.id === state.me ? " · 你" : ""}${p.bot ? " · BOT" : ""}</div><div class="seat-stack">◈ ${fmt(p.stack)}</div><small>${p.left ? "已离桌" : !p.connected ? "暂时离线" : esc(p.action)}</small></div></div><div class="bj-hands">${p.hands.map((h, hi) => `<div class="bj-hand ${state.turn === index && state.activeHand === hi ? "active" : ""}"><div class="bj-cards">${h.cards.map((c) => card(c)).join("")}</div><div>${h.split ? `第 ${hi + 1} 手 · ` : ""}${h.cards.length ? `${h.value.soft ? "软 " : ""}${h.value.total} 点 · ` : ""}下注 ${fmt(h.bet)}</div>${h.settled ? `<div class="bj-outcome">${outcomes[h.outcome]} · 返还 ${fmt(h.payout)} · 净 ${h.payout - h.bet >= 0 ? "+" : ""}${fmt(h.payout - h.bet)}</div>` : ""}</div>`).join("") || '<div class="hand-hint">等待下注</div>'}</div></article>`,
    )
    .join("");
  const area = $("#action-area");
  const previousAmount = $("#bet-amount")?.value;
  area.classList.toggle("playing", playing);
  if (!online) {
    area.innerHTML =
      '<div class="reconnect-banner">连接暂时断开，正在重新连接到牌桌…</div>';
  } else if (state.legal) {
    const l = state.legal;
    const buttons = l.actions.includes("bet")
      ? `<div class="raise-control"><input id="bet-amount" aria-label="21点下注金额" type="number" min="${l.min}" max="${l.max}" step="1" value="${Math.min(100, l.max)}"><button class="primary" data-action="bet">下注</button></div>`
      : [
          ["hit", "要牌"],
          ["stand", "停牌"],
          ["double", "加倍"],
          ["split", "分牌"],
        ]
          .map(
            ([action, label]) =>
              `<button class="${action === "stand" ? "secondary" : "primary"}" data-action="${action}" ${l.actions.includes(action) ? "" : "disabled"}>${label}</button>`,
          )
          .join("");
    area.innerHTML = `<div class="turn-info"><span class="timer" id="turn-timer">35</span><div>轮到你${state.stage === "betting" ? `下注 · 最低 ${state.minBet}` : `行动 · 第 ${state.activeHand + 1} 手`}<div class="hand-hint">${state.stage === "betting" ? "超时自动下最低注" : "超时自动停牌"}</div></div></div><div class="action-buttons">${buttons}</div>`;
    if (
      $("#bet-amount") &&
      Number(previousAmount) >= l.min &&
      Number(previousAmount) <= l.max
    )
      $("#bet-amount").value = previousAmount;
  } else {
    const title =
      state.stage === "showdown"
        ? "本手已结算，好运下一手。"
        : playing
          ? `${esc(state.players[state.turn]?.name || "牌友")} 正在${state.stage === "betting" ? "下注" : "行动"}`
          : "庄家已就位，随时开局。";
    const sub =
      state.stage === "showdown"
        ? host
          ? "点击「再来一手」继续。"
          : "等待房主开始下一手。"
        : me.stack < state.minBet
          ? "筹码不足，可在本手结束后补充。"
          : "1–5 人 · 黑杰克赔 3:2 · 支持要牌、停牌、加倍与分牌。";
    area.innerHTML = `<div><div class="action-title">${title}</div><div class="action-subtitle">${sub}</div></div>${playing ? '<span class="timer" id="turn-timer">35</span>' : ""}`;
  }
}
