import { redNumbers, betNames } from "../calculator/roulette-rules.js";
function wheel(state) {
  const n = state.pockets.length,
    selected = state.number === null ? -1 : state.pockets.indexOf(state.number),
    rotation = selected < 0 ? 0 : (-360 * (selected + 0.5)) / n;
  const point = (angle, r) => [
    120 + Math.cos(angle) * r,
    120 + Math.sin(angle) * r,
  ];
  const pockets = state.pockets
    .map((number, i) => {
      const start = (i * 2 * Math.PI) / n - Math.PI / 2,
        end = ((i + 1) * 2 * Math.PI) / n - Math.PI / 2;
      const a = point(start, 110),
        b = point(end, 110),
        c = point((start + end) / 2, 94);
      const color = number.startsWith("0")
        ? "#347d62"
        : redNumbers.has(Number(number))
          ? "#b34d66"
          : "#292336";
      return `<path d="M120 120L${a.join(" ")}A110 110 0 0 1 ${b.join(" ")}Z" fill="${color}" stroke="#cdb68e66" stroke-width=".6"/><text x="${c[0]}" y="${c[1]}" fill="#fff6df" font-size="7" text-anchor="middle" dominant-baseline="central" transform="rotate(${((start + end) * 90) / Math.PI + 90} ${c[0]} ${c[1]})">${number}</text>`;
    })
    .join("");
  return `<svg class="roulette-wheel" viewBox="0 0 240 240" role="img" aria-label="${n}格等概率轮盘${state.number !== null ? `，结果${state.number}` : ""}"><circle cx="120" cy="120" r="116" fill="#3c2d3e" stroke="#e3ca99" stroke-width="3"/><g transform="rotate(${rotation} 120 120)">${pockets}</g><circle cx="120" cy="120" r="66" fill="#291d35" stroke="#d2b57b" stroke-width="2"/><text x="120" y="110" text-anchor="middle" fill="#bfa5d2" font-size="10">${state.number === null ? "PLACE YOUR BET" : "RESULT"}</text><text x="120" y="142" text-anchor="middle" fill="#f1d998" font-size="34" font-weight="700">${state.number ?? "◈"}</text><path d="M112 2h16l-8 17Z" fill="#f5df9f"/></svg>`;
}
export function renderRoulette(state, { $, avatar, esc, fmt, online }) {
  const names = { european: "欧式单零", american: "美式双零", triple: "三零" };
  $("#board-area").innerHTML =
    `<div class="board-status">${names[state.wheel]} · ${state.pockets.length} 格等概率${state.partage ? " · 零点外围退半" : ""}</div>${wheel(state)}<div class="hand-hint">${state.number === null ? "下注确认后锁定，最后一位下注后统一转盘。" : `本局落点 ${state.number} · 庄家净盈亏 ${fmt(state.roundHouseNet)}`}</div>${state.result.length ? `<div class="result-banner">${state.result.map((r) => `${esc(r.name)} ${r.net >= 0 ? "+" : ""}${fmt(r.net)}`).join(" · ")}</div>` : ""}`;
  $("#seats").innerHTML = state.players
    .map(
      (p, i) =>
        `<article class="bj-seat rl-seat ${p.id === state.me ? "me" : ""} ${state.turn === i ? "current" : ""}"><div class="bj-player"><span class="avatar">${avatar(p.avatar)}</span><div><div class="seat-name">${esc(p.name)}${p.id === state.me ? " · 你" : ""}${p.bot ? " · BOT" : ""}</div><div class="seat-stack">◈ ${fmt(p.stack)}</div><small>${p.bet ? `${esc(p.bet.name)} · ${fmt(p.bet.amount)}` : esc(p.action)}</small></div></div></article>`,
    )
    .join("");
  const area = $("#action-area"),
    bet = $("#roulette-bet-select")?.value || "red",
    numbers = $("#roulette-numbers")?.value || "17",
    amount = $("#bet-amount")?.value || "100";
  area.classList.toggle("playing", state.stage === "betting");
  if (!online) area.innerHTML = '<div class="reconnect-banner">正在重连…</div>';
  else if (state.legal) {
    area.innerHTML = `<div class="turn-info"><span class="timer" id="turn-timer">35</span><div>轮到你下注<div class="hand-hint">单号填号码；分注等填空格分隔的号码；十二数／列注填1、2或3。</div></div></div><div class="roulette-controls"><select id="roulette-bet-select" aria-label="轮盘投注类型">${Object.entries(
      betNames,
    )
      .filter(([key]) => key !== "basket" || state.wheel === "american")
      .map(([key, name]) => `<option value="${key}">${name}</option>`)
      .join(
        "",
      )}</select><input id="roulette-numbers" aria-label="轮盘投注号码" placeholder="例如 17 / 1 2 / 1 2 3" value="${esc(numbers)}"><input id="bet-amount" aria-label="轮盘下注金额" type="number" min="${state.legal.min}" max="${state.legal.max}" step="10" value="${Math.min(Number(amount) || 100, state.legal.max)}"><button class="primary" data-action="bet">确认下注</button><button class="secondary" data-action="skip">本局跳过</button></div>`;
    $("#roulette-bet-select").value = Object.hasOwn(betNames, bet)
      ? bet
      : "red";
    $("#roulette-numbers").disabled = [
      "red",
      "black",
      "odd",
      "even",
      "low",
      "high",
      "basket",
    ].includes($("#roulette-bet-select").value);
  } else
    area.innerHTML = `<div><div class="action-title">${state.stage === "showdown" ? "这一转，已经结算。" : "其他牌友正在下注"}</div><div class="action-subtitle">${state.stage === "showdown" ? "房主点击「再转一局」继续。" : "没有下注时超时自动跳过，已下注金额仍参与结算。"}</div></div>`;
}
