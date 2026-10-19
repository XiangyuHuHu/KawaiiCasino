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
const pipPositions = {
  1: [[16, 22]],
  2: [
    [16, 12],
    [16, 32],
  ],
  3: [
    [8, 10],
    [16, 22],
    [24, 34],
  ],
  4: [
    [9, 12],
    [23, 12],
    [9, 32],
    [23, 32],
  ],
  5: [
    [9, 10],
    [23, 10],
    [16, 22],
    [9, 34],
    [23, 34],
  ],
  6: [
    [9, 10],
    [23, 10],
    [9, 22],
    [23, 22],
    [9, 34],
    [23, 34],
  ],
  7: [
    [16, 7],
    [9, 17],
    [23, 17],
    [9, 27],
    [23, 27],
    [9, 37],
    [23, 37],
  ],
  8: [
    [9, 7],
    [23, 7],
    [9, 17],
    [23, 17],
    [9, 27],
    [23, 27],
    [9, 37],
    [23, 37],
  ],
  9: [
    [8, 10],
    [16, 10],
    [24, 10],
    [8, 22],
    [16, 22],
    [24, 22],
    [8, 34],
    [16, 34],
    [24, 34],
  ],
};
function tile(t) {
  if (!t)
    return '<span class="mj-tile back" aria-label="未公开的麻将"><span class="mj-back-emblem">✥</span></span>';
  let face;
  if (t.suit === "wan")
    face = `<span class="mj-wan-number">${"一二三四五六七八九"[t.rank - 1]}</span><span class="mj-wan-mark">萬</span>`;
  else {
    const marks = pipPositions[t.rank]
      .map(([x, y], i) =>
        t.suit === "tong"
          ? `<circle cx="${x}" cy="${y}" r="${t.rank === 1 ? 8 : 3.2}" fill="none" stroke="${["#27674f", "#a83d40", "#31557b"][i % 3]}" stroke-width="${t.rank === 1 ? 2.7 : 1.8}"/><circle cx="${x}" cy="${y}" r="${t.rank === 1 ? 3.5 : 0.8}" fill="#a94b46"/>`
          : `<g transform="translate(${x},${y})"><rect x="-2" y="-4" width="4" height="8" rx="1" fill="${i % 3 === 1 ? "#b3473f" : "#2a7152"}"/><path d="M-3 -2h6M-3 2h6" stroke="#8ab180" stroke-width="1"/></g>`,
      )
      .join("");
    const bird =
      '<path d="M7 34 15 25 13 17 20 13 24 18 20 22 19 30 12 34Z" fill="#2b7758"/><path d="m20 14 5-4 1 5-4 2M14 26 5 29 8 35 17 29" fill="#ac443f"/><circle cx="21" cy="16" r="1" fill="#fff7dd"/><path d="m18 30 3 7M12 33l-2 5M7 39h18" fill="none" stroke="#8a6d47" stroke-width="1.4"/>';
    face = `<svg class="mj-face" viewBox="0 0 32 44" aria-hidden="true">${t.suit === "tiao" && t.rank === 1 ? bird : marks}</svg>`;
  }
  return `<span class="mj-tile ${t.suit}" aria-label="${t.rank}${suits[t.suit]}"><span class="mj-corner">${t.rank}</span>${face}</span>`;
}

function renderRecords(state, { $, esc }) {
  const panel = $("#mahjong-records");
  const scrollTop = panel.scrollTop;
  const open = panel.querySelector("details")?.open;
  const records = state.discardHistory || [];
  const groups = new Map(
    state.players.map((p) => [p.id, { name: p.name, records: [] }]),
  );
  for (const record of records) {
    if (!groups.has(record.playerId))
      groups.set(record.playerId, { name: record.name, records: [] });
    groups.get(record.playerId).records.push(record);
  }
  const claim = (record) =>
    ({ pong: "碰", kong: "杠", hu: "胡" })[record.claimType];
  panel.innerHTML = `<div class="mj-record-title"><b>出牌记录</b><small>第 ${state.hand} 手 · ${records.length} 次出牌</small></div><p class="mj-record-note">按玩家归类，数字为出牌顺序。碰、杠、胡后仍保留。</p><div class="mj-river-groups">${[...groups].map(([id, group]) => `<div class="mj-record-group"><div class="mj-record-name">${esc(group.name)}${id === state.me ? " · 你" : ""}<small>${group.records.length} 张</small></div><div class="mj-tiles">${group.records.length ? group.records.map((record) => `<span class="mj-discard ${record.sequence === records.length ? "recent" : ""} ${claim(record) ? "claimed" : ""}" data-sequence="${record.sequence}" title="第 ${record.sequence} 次 · ${esc(record.name)}${claim(record) ? ` · ${esc(record.claimedBy)} ${claim(record)}` : ""}">${tile(record.tile)}<small class="mj-sequence">${record.sequence}</small>${claim(record) ? `<em class="mj-claim-badge">${claim(record)}</em>` : ""}</span>`).join("") : '<span class="mj-no-discard">尚未出牌</span>'}</div></div>`).join("")}</div><details class="mj-chronology"><summary>按时间查看完整记录</summary><ol>${[
    ...records,
  ]
    .reverse()
    .map(
      (record) =>
        `<li><span>#${record.sequence}</span> ${esc(record.name)} · ${record.tile.rank}${suits[record.tile.suit]}${claim(record) ? ` → ${esc(record.claimedBy)} ${claim(record)}` : ""}</li>`,
    )
    .join("")}</ol></details>`;
  panel.querySelector("details").open = !!open;
  panel.scrollTop = scrollTop;
}
export function renderMahjong(state, { $, avatar, esc, fmt, online }) {
  renderRecords(state, { $, esc });
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
    `<div class="board-status">简化四川麻将 · 底分 ${state.baseStake} · 牌墙 ${state.wallRemaining} 张${state.dealer >= 0 ? ` · ${esc(state.players[state.dealer]?.name)} 坐庄` : ""}</div><div class="mj-last">${last ? `${esc(last.name)} 打出${last.claimed ? "（已碰杠）" : ""} ${tile(last.tile)}` : "定缺后庄家先打 · 不吃牌"}</div>${state.stage === "claim" ? `<div class="hand-hint">${turn} 正在抢牌 · 胡优先 · 超时过</div>` : ""}${state.result.length ? `<div class="result-banner"><b>${title}</b>${outcome.winningTile ? ` ${tile(outcome.winningTile)}` : ""}<br>${state.result.map((r) => `${esc(r.name)} ${r.net >= 0 ? "+" : ""}${fmt(r.net)}`).join(" · ")}</div>` : ""}`;
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
