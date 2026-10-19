let selection = new Set(),
  selectionKey = "";
export const selectedGuandanCards = () => [...selection];
export function toggleGuandanCard(button) {
  const id = button.dataset.gdCard;
  if (selection.has(id)) selection.delete(id);
  else selection.add(id);
  button.classList.toggle("selected", selection.has(id));
  button.setAttribute("aria-pressed", String(selection.has(id)));
}
const rankName = (rank) =>
  ({ 11: "J", 12: "Q", 13: "K", 14: "A", 16: "小王", 17: "大王" })[rank] ||
  rank;
export function renderGuandan(state, { $, card, avatar, esc, fmt, online }) {
  const key = `${state.code}:${state.hand}:${state.version}`;
  if (selectionKey !== key) {
    selection.clear();
    selectionKey = key;
  }
  const playing = state.stage === "playing";
  const me = state.players.find((p) => p.id === state.me);
  const turnName = esc(state.players[state.turn]?.name || "牌友");
  const last = state.lastPlay;
  $("#board-area").innerHTML =
    `<div class="board-status">本手打 ${rankName(state.level)} · ♥${rankName(state.level)} 逢人配 · 底分 ${state.baseStake}</div><div class="gd-levels">1 队（1 / 3 座）· ${rankName(state.teamLevels[0])} 级<br>2 队（2 / 4 座）· ${rankName(state.teamLevels[1])} 级</div><div class="ddz-last">${last ? `<div>${esc(last.name)} · ${esc(last.combo.name)}${state.passes ? ` · ${state.passes} 人不出` : ""}</div><div class="ddz-cards">${last.cards.map((c) => card(c)).join("")}</div>` : `<div>${playing ? `${turnName} 自由领出` : "四人齐坐 · 固定搭档"}</div>`}</div><div class="gd-order">名次：${state.finishOrder.length ? state.finishOrder.map((p) => `${p.place}. ${esc(p.name)}（${p.team + 1}队）`).join(" → ") : "等待出完"}</div>${state.result.length ? `<div class="result-banner"><b>${state.winningTeam + 1} 队获胜 · 升 ${state.upgrade} 级 · 每份 ${fmt(state.score)}</b><br>${state.result.map((r) => `${esc(r.name)} ${r.net >= 0 ? "+" : ""}${fmt(r.net)}`).join(" · ")}<br>余额封顶 · 实收均分</div>` : ""}`;
  $("#seats").innerHTML = state.players
    .map((p, index) => {
      const mine = p.id === state.me;
      const result = state.result.find((r) => r.id === p.id);
      return `<article class="bj-seat ddz-seat gd-seat ${mine ? "me" : ""} ${state.turn === index ? "current" : ""}"><div class="bj-player"><span class="avatar">${avatar(p.avatar)}</span><div><div class="seat-name">${esc(p.name)}${mine ? " · 你" : ""}${p.bot ? " · BOT" : ""}</div><div class="seat-stack">${p.seat + 1} 号座 · ${p.team + 1} 队 · ◈ ${fmt(p.stack)} · 剩 ${p.remaining} 张</div><small>${p.left ? "已离桌 · 自动行动" : !p.connected ? "暂时离线" : state.turn === index ? "正在出牌…" : esc(p.action)}${result ? ` · 净 ${result.net >= 0 ? "+" : ""}${fmt(result.net)}` : ""}</small></div></div><div class="ddz-cards ddz-hand">${mine ? p.cards.map((c) => `<button type="button" class="ddz-card gd-card ${selection.has(c.id) ? "selected" : ""} ${c.rank === state.level && c.suit === "h" ? "gd-wild" : ""}" data-gd-card="${esc(c.id)}" aria-label="选择 ${rankName(c.rank)} ${esc(c.suit)}${c.rank === state.level && c.suit === "h" ? " 逢人配" : ""}" aria-pressed="${selection.has(c.id)}" ${!online || !playing || !state.legal ? "disabled" : ""}>${card(c)}</button>`).join("") : state.stage === "showdown" ? p.cards.map((c) => card(c)).join("") : p.remaining ? `${card(null)}<span class="ddz-count">× ${p.remaining}</span>` : ""}</div></article>`;
    })
    .join("");
  const area = $("#action-area");
  area.classList.toggle("playing", playing);
  if (!online)
    area.innerHTML =
      '<div class="reconnect-banner">连接暂时断开，正在重新连接到牌桌…</div>';
  else if (state.legal)
    area.innerHTML = `<div class="turn-info"><span class="timer" id="turn-timer">35</span><div>轮到你出牌<div class="hand-hint">点击选牌 · 自动配牌 · 超时不出，领出打最小单张</div></div></div><div class="action-buttons"><button class="primary" data-action="play">出牌</button><button class="secondary" data-action="pass" ${state.legal.canPass ? "" : "disabled"}>不出</button><button class="secondary" data-action="assist">帮我一步</button></div>`;
  else
    area.innerHTML = `<div><div class="action-title">${state.stage === "showdown" ? "本手已结算，搭档再来。" : playing ? `${turnName} 正在出牌` : "四人两队，一起升级。"}</div><div class="action-subtitle">${playing ? (me.place ? `你已获得第 ${me.place} 名，等待其余牌友。` : "轮到你时可点选手牌，或使用「帮我一步」。") : me.stack < state.baseStake ? "筹码不足 10，请补充筹码。" : "恰好 4 人 · 可添加三位练习伙伴 · 底分 10"}</div></div>${playing ? '<span class="timer" id="turn-timer">35</span>' : ""}`;
}
