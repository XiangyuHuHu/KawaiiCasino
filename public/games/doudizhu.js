let selection = new Set(),
  selectionKey = "";
export const selectedCards = () => [...selection];
export function toggleCard(button) {
  const id = button.dataset.ddzCard;
  if (selection.has(id)) selection.delete(id);
  else selection.add(id);
  button.classList.toggle("selected", selection.has(id));
  button.setAttribute("aria-pressed", String(selection.has(id)));
}

export function renderDoudizhu(state, { $, card, avatar, esc, fmt, online }) {
  const key = `${state.code}:${state.hand}:${state.version}`;
  if (key !== selectionKey) {
    selection.clear();
    selectionKey = key;
  }
  const playing = !["waiting", "showdown"].includes(state.stage);
  const me = state.players.find((p) => p.id === state.me);
  const last = state.lastPlay;
  const turnName = esc(state.players[state.turn]?.name || "牌友");
  $("#board-area").innerHTML =
    `<div class="board-status">${state.stage === "bidding" ? `轮到 ${turnName} 叫分 · 当前 ${state.bid} 分 · 重发 ${state.redeals}/3` : state.landlord >= 0 ? `${esc(state.players[state.landlord].name)} · ${state.bid} 分地主 · 炸弹 ${state.bombs} / 王炸 ${state.rockets}` : "3 人齐坐 · 底分 10"}</div><div class="ddz-bottom"><span>底牌</span>${state.bottom.length ? state.bottom.map((c) => card(c)).join("") : card(null, true).repeat(3)}</div><div class="ddz-last">${last ? `<div>${esc(last.name)} · ${esc(last.combo.name)}${state.passes ? " · 已有一人不出" : ""}</div><div class="ddz-cards">${last.cards.map((c) => card(c)).join("")}</div>` : `<div>${state.stage === "playing" ? `${turnName} 自由领出` : "叫分后地主先出牌"}</div>`}</div>${state.result.length ? `<div class="result-banner"><b>${state.result.find((r) => r.won)?.role}获胜${state.spring ? ` · ${state.spring}` : ""} · 每份 ${fmt(state.score)}</b><br>${state.result.map((r) => `${esc(r.name)} ${r.net >= 0 ? "+" : ""}${fmt(r.net)}`).join(" · ")}</div>` : ""}`;
  $("#seats").innerHTML = state.players
    .map((p, index) => {
      const mine = p.id === state.me;
      const result = state.result.find((r) => r.id === p.id);
      return `<article class="bj-seat ddz-seat ${mine ? "me" : ""} ${state.turn === index ? "current" : ""}"><div class="bj-player"><span class="avatar">${avatar(p.avatar)}</span><div><div class="seat-name">${esc(p.name)}${mine ? " · 你" : ""}${p.bot ? " · BOT" : ""}</div><div class="seat-stack">${p.role} · ◈ ${fmt(p.stack)} · 剩 ${p.remaining} 张</div><small>${p.left ? "已离桌 · 自动行动" : !p.connected ? "暂时离线" : state.turn === index ? "正在行动…" : esc(p.action)}${result ? ` · 净 ${result.net >= 0 ? "+" : ""}${fmt(result.net)}` : ""}</small></div></div><div class="ddz-cards ddz-hand">${mine ? p.cards.map((c) => `<button type="button" class="ddz-card ${selection.has(c.id) ? "selected" : ""}" data-ddz-card="${esc(c.id)}" aria-label="选择 ${esc({ 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2", 16: "小王", 17: "大王" }[c.rank] || c.rank)} ${esc(c.suit)}" aria-pressed="${selection.has(c.id)}" ${!online || state.stage !== "playing" ? "disabled" : ""}>${card(c)}</button>`).join("") : state.stage === "showdown" ? p.cards.map((c) => card(c)).join("") : p.remaining ? `${card(null)}<span class="ddz-count">× ${p.remaining}</span>` : ""}</div></article>`;
    })
    .join("");
  const area = $("#action-area");
  area.classList.toggle("playing", playing);
  if (!online) {
    area.innerHTML =
      '<div class="reconnect-banner">连接暂时断开，正在重新连接到牌桌…</div>';
  } else if (state.legal) {
    const buttons =
      state.stage === "bidding"
        ? state.legal.bids
            .map(
              (n) =>
                `<button class="${n ? "primary" : "secondary"}" data-action="bid" data-bid="${n}">${n ? `叫 ${n} 分` : "不叫"}</button>`,
            )
            .join("")
        : `<button class="primary" data-action="play">出牌</button><button class="secondary" data-action="pass" ${state.legal.canPass ? "" : "disabled"}>不出</button>`;
    area.innerHTML = `<div class="turn-info"><span class="timer" id="turn-timer">35</span><div>轮到你${state.stage === "bidding" ? "叫分" : "出牌"}<div class="hand-hint">${state.stage === "bidding" ? "超时不叫" : "点选手牌后出牌 · 超时不出，领出时出最小单张"}</div></div></div><div class="action-buttons">${buttons}<button class="secondary" data-action="assist">帮我一步</button></div>`;
  } else {
    area.innerHTML = `<div><div class="action-title">${state.stage === "showdown" ? "本手已结算，搭伴再来。" : playing ? `${turnName} 正在${state.stage === "bidding" ? "叫分" : "出牌"}` : "三人齐坐，好运开局。"}</div><div class="action-subtitle">${playing ? "轮到你时，可选牌出牌或使用「帮我一步」。" : me.stack < state.baseStake ? "筹码不足 10，请补充筹码。" : "恰好 3 人 · 可添加两位练习伙伴 · 底分 10"}</div></div>${playing ? '<span class="timer" id="turn-timer">35</span>' : ""}`;
  }
}
