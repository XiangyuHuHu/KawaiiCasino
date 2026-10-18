const suits = { wan: "万", tiao: "条", tong: "筒" };
const meldNames = {
  pong: "碰",
  kong: "明杠",
  addedKong: "加杠",
  concealedKong: "暗杠",
};
let selection = null,
  selectionKey = "";
export const selectedTile = () => selection;
export function toggleTile(button) {
  selection =
    selection === button.dataset.mjTile ? null : button.dataset.mjTile;
  for (const b of document.querySelectorAll("[data-mj-tile]")) {
    b.classList.toggle("selected", b.dataset.mjTile === selection);
    b.setAttribute("aria-pressed", String(b.dataset.mjTile === selection));
  }
}
function tile(t) {
  return t
    ? `<span class="mj-tile ${t.suit}" aria-label="${t.rank}${suits[t.suit]}"><b>${t.rank}</b><span>${suits[t.suit]}</span></span>`
    : '<span class="mj-tile back" aria-label="未公开的麻将">✧</span>';
}
export function renderMahjong(state, { $, avatar, esc, fmt, online }) {
  const key = `${state.code}:${state.hand}:${state.version}`;
  if (key !== selectionKey) {
    selection = null;
    selectionKey = key;
  }
  const playing = !["waiting", "showdown"].includes(state.stage);
  const turn = esc(state.players[state.turn]?.name || "牌友"),
    last = state.lastDiscard,
    outcome = state.outcome;
  const title = outcome
    ? outcome.draw
      ? "流局 · 无支付"
      : `${esc(outcome.winnerName)} ${outcome.selfDraw ? "自摸" : "点炮胡"} · ${outcome.patterns.map((p) => esc(p.name)).join("、")} · ${outcome.multiplier}倍${outcome.selfDraw ? " · 自摸加底 10" : ""}`
    : "";
  $("#board-area").innerHTML =
    `<div class="board-status">简化四川麻将 · 底分 ${state.baseStake} · 牌墙 ${state.wallRemaining} 张${state.dealer >= 0 ? ` · ${esc(state.players[state.dealer]?.name)} 坐庄` : ""}</div><div class="mj-last">${last ? `${esc(last.name)} 打出${last.claimed ? "（已碰杠）" : ""} ${tile(last.tile)}` : "定缺后庄家先打 · 不吃牌"}</div>${state.stage === "claim" ? `<div class="hand-hint">${turn} 正在抢牌 · 胡优先 · 超时过</div>` : ""}${state.result.length ? `<div class="result-banner"><b>${title}</b>${outcome.winningTile ? ` ${tile(outcome.winningTile)}` : ""}<br>${state.result.map((r) => `${esc(r.name)} ${r.net >= 0 ? "+" : ""}${fmt(r.net)}`).join(" · ")}</div>` : ""}<details class="mj-river"><summary>牌河 · ${state.discards.length} 张</summary><div class="mj-tiles">${state.discards.map(tile).join("")}</div></details>`;
  $("#seats").innerHTML = state.players
    .map((p, index) => {
      const mine = p.id === state.me;
      return `<article class="bj-seat mj-seat ${mine ? "me" : ""} ${state.turn === index ? "current" : ""}"><div class="bj-player"><span class="avatar">${avatar(p.avatar)}</span><div><div class="seat-name">${esc(p.name)}${mine ? " · 你" : ""}${p.bot ? " · BOT" : ""}${state.dealer === index ? " · 庄" : ""}</div><div class="seat-stack">◈ ${fmt(p.stack)} · ${p.voidSuit ? `缺${suits[p.voidSuit]}` : "待定缺"} · ${p.remaining} 张</div><small>${p.left ? "离桌 · 自动行动" : !p.connected ? "暂时离线" : esc(p.action)}</small></div></div><div class="mj-melds">${p.melds.map((m) => `<div><small>${meldNames[m.type]}</small><div class="mj-tiles">${m.tiles.map(tile).join("")}</div></div>`).join("")}</div><div class="mj-tiles mj-hand">${mine ? p.tiles.map((t) => `<button class="mj-select ${selection === t.id ? "selected" : ""} ${t.suit === p.voidSuit ? "void-tile" : ""}" data-mj-tile="${esc(t.id)}" aria-label="选择 ${t.rank}${suits[t.suit]}" aria-pressed="${selection === t.id}" ${!online || !playing || state.stage === "void" ? "disabled" : ""}>${tile(t)}</button>`).join("") : state.stage === "showdown" ? p.tiles.map(tile).join("") : p.remaining ? `${tile(null)}<span>× ${p.remaining}</span>` : ""}</div></article>`;
    })
    .join("");
  const area = $("#action-area"),
    l = state.legal;
  area.classList.toggle("playing", playing);
  if (!online) {
    area.innerHTML =
      '<div class="reconnect-banner">连接暂时断开，正在重新连接到牌桌…</div>';
    return;
  }
  if (l) {
    const labels = {
      hu: "胡",
      pong: "碰",
      kong: "杠",
      pass: "过",
      discard: "出牌",
      concealedKong: "暗杠",
      addedKong: "加杠",
    };
    const buttons =
      state.stage === "void"
        ? Object.entries(suits)
            .map(
              ([s, n]) =>
                `<button class="primary" data-action="void" data-suit="${s}">缺${n}</button>`,
            )
            .join("")
        : Object.entries(labels)
            .filter(([a]) => l.actions.includes(a))
            .map(
              ([a, n]) =>
                `<button class="${a === "pass" ? "secondary" : "primary"}" data-action="${a}">${n}</button>`,
            )
            .join("");
    area.innerHTML = `<div class="turn-info"><span class="timer" id="turn-timer">35</span><div>轮到你${state.stage === "void" ? "定缺" : state.stage === "claim" ? "抢牌" : "出牌"}<div class="hand-hint">${state.stage === "void" ? "超时选择张数最少的花色" : state.stage === "claim" ? "胡优先 · 最长 8 秒 · 超时过" : "选一张牌再出牌或杠 · 有缺先打缺 · 超时出最小合法牌"}</div></div></div><div class="action-buttons">${buttons}<button class="secondary" data-action="assist">帮我一步</button></div>`;
  } else {
    area.innerHTML = `<div><div class="action-title">${state.stage === "showdown" ? "本手已结算，围坐再来。" : playing ? `${turn} 正在${state.stage === "void" ? "定缺" : state.stage === "claim" ? "抢牌" : "行动"}` : "四人齐坐，好运开局。"}</div><div class="action-subtitle">${playing ? "轮到你可点选手牌，或使用「帮我一步」。" : "恰好 4 人 · 每人至少 10 筹码 · 可添加三位练习伙伴"}</div></div>${playing ? '<span class="timer" id="turn-timer">35</span>' : ""}`;
  }
}
