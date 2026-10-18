/* global io */
import {
  renderGuandan,
  selectedGuandanCards,
  toggleGuandanCard,
} from "./games/guandan.js";
import { renderMahjong, selectedTile, toggleTile } from "./games/mahjong.js";
import { renderBlackjack } from "./games/blackjack.js";
import { renderDoudizhu, selectedCards, toggleCard } from "./games/doudizhu.js";
const $ = (selector) => document.querySelector(selector);
const socket = io({ autoConnect: false });
let state = null,
  mode = "create",
  selectedAvatar = 0,
  tab = "chat",
  online = false,
  sound = false,
  inviteText = "",
  lastTurn = "";
const fmt = (n) => new Intl.NumberFormat("en-US").format(n);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const stages = {
  waiting: "等待开局",
  betting: "下注阶段",
  bidding: "叫分阶段",
  void: "定缺阶段",
  claim: "抢牌阶段",
  playing: "玩家行动",
  preflop: "翻牌前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
  showdown: "本手结束",
};
const palettes = [
  ["#b5a3ef", "#7961aa", "#eee2fb"],
  ["#91cdb3", "#4b9686", "#d8f4cd"],
  ["#e8a2bb", "#b36c96", "#ffe4df"],
  ["#e8c08b", "#a77d64", "#fff0c4"],
  ["#8cb8d9", "#5778a9", "#dcf2fa"],
  ["#c2a5d9", "#815597", "#f6daed"],
  ["#d3c592", "#8e9764", "#f2f3cc"],
  ["#dba491", "#a8676c", "#ffe7d0"],
];
function avatar(index = 0) {
  const [base, shade, light] = palettes[index % palettes.length];
  return `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" shape-rendering="crispEdges"><path fill="${shade}" d="M2 3h3V1h2v3h2V1h2v2h3v3h1v7h-2v2H3v-2H1V6h1z"/><path fill="${base}" d="M3 4h3V3h4v1h3v3h1v5h-2v2H4v-2H2V7h1z"/><path fill="${light}" d="M5 9h6v4H5zM3 3h2v3H3zm8 0h2v3h-2z"/><path fill="#35263e" d="M4 7h2v2H4zm6 0h2v2h-2zM7 10h2v1H7z"/><path fill="#e98eaa" d="M3 10h2v1H3zm8 0h2v1h-2z"/><path fill="#fff" d="M4 7h1v1H4zm6 0h1v1h-1z"/></svg>`;
}
function card(c, empty = false) {
  if (empty) return '<span class="card empty" aria-label="等待公共牌">♧</span>';
  if (!c) return '<span class="card back" aria-label="未公开的底牌">✧</span>';
  const rank =
    { 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2", 16: "小王", 17: "大王" }[
      c.rank
    ] || c.rank;
  const suit = { s: "♠", h: "♥", d: "♦", c: "♣", j: "★" }[c.suit];
  return `<span class="card ${["h", "d"].includes(c.suit) ? "red" : ""}" aria-label="${suit}${rank}"><span class="rank">${rank}</span><span class="suit">${suit}</span><span class="center-suit">${suit}</span><span class="card-corner">${rank}${suit}</span></span>`;
}
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 3300);
}
function stored() {
  try {
    return JSON.parse(sessionStorage.getItem("kawaii-session"));
  } catch {
    return null;
  }
}
function saveSession(value) {
  try {
    value
      ? sessionStorage.setItem("kawaii-session", JSON.stringify(value))
      : sessionStorage.removeItem("kawaii-session");
  } catch {
    /* private mode may disable storage */
  }
}
function rememberName(value) {
  try {
    localStorage.setItem("kawaii-name", value);
  } catch {
    /* optional */
  }
}
function getName() {
  try {
    return localStorage.getItem("kawaii-name") || "";
  } catch {
    return "";
  }
}
function request(event, data = {}) {
  return new Promise((resolve, reject) => {
    if (!socket.connected) return reject(new Error("连接已断开，正在尝试重连"));
    socket.timeout(6000).emit(event, data, (err, response) => {
      if (err) return reject(new Error("服务器响应超时，请检查连接"));
      if (!response?.ok)
        return reject(new Error(response?.error || "操作失败"));
      resolve(response);
    });
  });
}
async function command(event, data) {
  try {
    await request(event, data);
  } catch (err) {
    toast(err.message);
  }
}
function ping() {
  if (!sound) return;
  try {
    const audio = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audio.createOscillator(),
      gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 660;
    gain.gain.setValueAtTime(0.035, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.2);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.2);
    oscillator.onended = () => audio.close();
  } catch {
    /* sound is optional */
  }
}
function render() {
  $("#table-scene").dataset.version = state?.version || 0;
  const me = state?.players.find((p) => p.id === state.me);
  const host = state?.hostId === state?.me;
  const playing = state && !["waiting", "showdown"].includes(state.stage);
  const blackjack = state?.gameType === "blackjack";
  const doudizhu = state?.gameType === "doudizhu";
  const mahjong = state?.gameType === "mahjong";
  const guandan = state?.gameType === "guandan";
  const maxPlayers = state?.game?.maxPlayers || 8;
  $("#table-scene").classList.toggle("doudizhu", doudizhu || guandan);
  $("#table-scene").classList.toggle("mahjong", mahjong);
  $("#table-scene").classList.toggle("guandan", guandan);
  $("#table-scene").classList.toggle("blackjack", blackjack);
  $("#game-name").textContent = state?.game?.name || "游戏大厅";
  $(".game").setAttribute("aria-label", `${state?.game?.name || "游戏"}牌桌`);
  $("#connection-dot").classList.toggle("online", online);
  $("#connection-text").textContent = online ? "局域网已连接" : "正在重连…";
  $("#room-label").textContent = state
    ? `${state.game.name} · ${state.code}`
    : "朋友小局 · 开放入座";
  $("#invite-button").hidden = !state;
  $("#leave-button").hidden = !state;
  $("#hand-label").textContent = state
    ? `HAND #${String(state.hand).padStart(3, "0")} · NO RAKE, JUST FUN.`
    : "NO PRESSURE, JUST POKER.";
  $("#stage-label").textContent = state ? stages[state.stage] : "等待开局";
  $("#pot-value").textContent = fmt(state?.pot || 0);
  $("#pot-caption").textContent = mahjong
    ? "SCORE · 胡牌每份（加底前）"
    : doudizhu || guandan
      ? "SCORE · 当前每份分值"
      : blackjack
        ? "TOTAL BETS · 本手总下注"
        : "TOTAL POT · 总底池";
  $("#blind-caption").textContent =
    doudizhu || mahjong || guandan ? "底分" : blackjack ? "最低下注" : "盲注";
  $("#blind-value").textContent =
    doudizhu || mahjong || guandan
      ? fmt(state.baseStake)
      : blackjack
        ? fmt(state.minBet)
        : state
          ? `${fmt(state.smallBlind)} / ${fmt(state.bigBlind)}`
          : "50 / 100";
  $("#stack-value").textContent = me ? fmt(me.stack) : "—";
  $("#players-value").textContent =
    `${state?.players.filter((p) => p.connected && !p.left).length || 0} / ${maxPlayers}`;
  $("#chat-input").disabled = !state || !online;
  $("#chat-send").disabled = !state || !online;
  if (!state) {
    $("#room-panel").innerHTML =
      '<span class="panel-decoration">✧</span><span class="eyebrow">WELCOME TO THE CLUB</span><h2>今晚，来一手。</h2><p>把好运留在牌桌，<br>把快乐分享给朋友。</p><button class="primary wide" data-command="create">创建房间 <span>＋</span></button><button class="secondary wide" data-command="join">加入朋友的牌桌 <span>↗</span></button>';
  } else {
    $("#room-panel").innerHTML =
      `<span class="panel-decoration">✧</span><span class="eyebrow">MAKE YOURSELF AT HOME</span><div class="room-code-display"><small>房间号 · ${host ? "你是房主" : "朋友的牌桌"}</small>${state.code}</div><p>${playing ? "牌局进行中，好运正在路上。" : "朋友到齐，随时可以开始。"}</p><button class="primary wide" data-command="deal" ${!host || playing || !online || state.players.filter((p) => p.connected && p.stack >= (doudizhu || mahjong || guandan ? state.baseStake : blackjack ? state.minBet : 1) && !p.left).length < (state.game?.minPlayers || 2) ? "disabled" : ""}>${playing ? "牌局进行中" : host ? (state.hand ? "再来一手" : "开始发牌") : "等待房主发牌"} <span>♠</span></button><div class="room-controls">${host ? `<button data-command="bots" ${playing || !online || state.players.length >= maxPlayers ? "disabled" : ""}>＋ 练习伙伴</button>` : ""}<button data-command="rebuy" ${playing || !online || me.stack >= state.buyIn ? "disabled" : ""}>补充筹码</button><button data-command="invite">邀请朋友 ↗</button></div>`;
  }
  const renderers = {
    guandan: () => renderGuandan(state, { $, card, avatar, esc, fmt, online }),
    poker: renderPoker,
    mahjong: () => renderMahjong(state, { $, avatar, esc, fmt, online }),
    doudizhu: () =>
      renderDoudizhu(state, { $, card, avatar, esc, fmt, online }),
    blackjack: () =>
      renderBlackjack(state, { $, card, avatar, esc, fmt, online }),
  };
  (renderers[state?.gameType || "poker"] || renderPoker)();
  renderChat();
  updateTimer();
  if (state?.legal && `${state.hand}:${state.version}` !== lastTurn) {
    lastTurn = `${state.hand}:${state.version}`;
    ping();
  }
}
function renderPoker() {
  const me = state?.players.find((p) => p.id === state.me);
  const host = state?.hostId === state?.me;
  const playing = state && !["waiting", "showdown"].includes(state.stage);
  const cards = state?.board || [];
  $("#board-area").innerHTML =
    `<div class="board-status">${!state ? "TAKE A SEAT · 让快乐开局" : `第 ${state.hand} 手 · ${stages[state.stage]}`}</div><div class="community-cards">${Array.from({ length: 5 }, (_, i) => card(cards[i], !cards[i])).join("")}</div>${state?.hand ? `<div class="board-pot"><span>◈ 总底池</span>${fmt(state.pot)}</div>` : '<div class="board-welcome">好朋友，好手气。</div>'}${state?.result.length ? `<div class="result-banner">${state.result.map((r) => `${esc(r.name)} +${fmt(r.amount)} <span>· ${esc(r.handName)}</span>`).join("<br>")}</div>` : ""}`;
  const positions = [
    [50, 86],
    [18, 73],
    [10, 44],
    [26, 23],
    [50, 18],
    [74, 23],
    [90, 44],
    [82, 73],
  ];
  const players = state?.players || [];
  const meIndex = Math.max(
    0,
    players.findIndex((p) => p.id === state?.me),
  );
  const count = state ? 8 : 6;
  const lobbyPositions = [
    [50, 85],
    [15, 65],
    [23, 22],
    [50, 13],
    [77, 22],
    [85, 65],
  ];
  const occupiedPositions = {
    2: [0, 4],
    3: [0, 3, 5],
    4: [0, 2, 4, 6],
    5: [0, 2, 3, 5, 6],
    6: [0, 1, 3, 4, 5, 7],
    7: [0, 1, 2, 3, 5, 6, 7],
  }[players.length] || [0, 1, 2, 3, 4, 5, 6, 7];
  $("#seats").innerHTML = Array.from({ length: count }, (_, i) => {
    const offset = occupiedPositions.indexOf(i);
    const index = state
      ? offset < 0
        ? -1
        : (meIndex + offset) % players.length
      : i;
    const p = players[index];
    const [x, y] = state ? positions[i] : lobbyPositions[i];
    if (!p)
      return `<div class="seat empty-seat" style="left:${x}%;top:${y}%"><button class="avatar" data-command="${state ? "invite" : "create"}" aria-label="${state ? "邀请朋友入座" : "创建房间入座"}">${!state && i === 0 ? "♠" : "＋"}</button><div class="seat-name">${!state && i === 0 ? "你的幸运座位" : "虚位以待"}</div></div>`;
    const mine = p.id === state.me,
      current = state.turn === index;
    const winner =
      state.stage === "showdown" && state.result.some((r) => r.id === p.id);
    const badge =
      state.dealer === index && state.hand
        ? "D"
        : state.sb === index && playing
          ? "SB"
          : state.bb === index && playing
            ? "BB"
            : "";
    return `<div class="seat ${mine ? "me" : ""} ${x >= 74 ? "right-seat" : ""} ${p.folded || p.left ? "folded" : ""} ${current ? "current" : ""} ${winner ? "winner" : ""}" style="left:${x}%;top:${y}%"><div class="seat-inner">${p.cards.length && !p.folded ? `<div class="hole-cards">${p.cards.map((c) => card(c)).join("")}</div>` : ""}<span class="avatar">${avatar(p.avatar)}</span>${badge ? `<span class="seat-badge">${badge}</span>` : ""}${!p.connected ? '<span class="offline-mark" title="已断线"></span>' : ""}${playing && p.bet ? `<span class="seat-bet">◈ ${fmt(p.bet)}</span>` : ""}<div class="seat-name">${esc(p.name)}${mine ? " · 你" : ""}${p.bot ? '<span class="bot-tag">BOT</span>' : ""}</div><div class="seat-stack">${fmt(p.stack)}</div><div class="seat-status">${winner ? "✦ 赢家" : p.left ? "已离桌" : !p.connected ? "暂时离线" : !state.hand ? "已入座" : current ? "正在思考…" : esc(p.action)}</div></div></div>`;
  }).join("");
  const area = $("#action-area");
  const previousAmount = $("#raise-amount")?.value;
  area.classList.toggle("playing", !!playing);
  if (!state) {
    area.innerHTML =
      '<div class="action-welcome"><span class="action-icon">♠</span><div><div class="action-title">你的座位，已经留好了。</div><div class="action-subtitle">和朋友连上同一个 Wi-Fi，就能围坐一桌。</div></div></div><button class="primary" data-command="create">入座开玩 ↗</button>';
  } else if (!online) {
    area.innerHTML =
      '<div class="reconnect-banner">连接暂时断开，正在重新连接到牌桌…</div>';
  } else if (state.legal) {
    const l = state.legal;
    area.innerHTML = `<div class="turn-info"><span class="timer" id="turn-timer">35</span><div><div>轮到你了，${esc(me.name)}。</div><div class="hand-hint">${state.myHand ? `当前牌型 · ${esc(state.myHand)}` : "相信你的判断，享受这一手。"}</div></div></div><div class="action-buttons"><button class="fold" data-action="fold">弃牌</button><button class="secondary" data-action="${l.toCall ? "call" : "check"}">${l.toCall ? `跟注 ${fmt(l.call)}` : "过牌"}</button><div class="raise-control"><input id="raise-amount" aria-label="本轮加注至" type="number" min="${l.min}" max="${l.max}" step="1" value="${l.min}" ${!l.canRaise || l.max < l.min ? "disabled" : ""}><button class="primary" data-action="raise" ${!l.canRaise || l.max < l.min ? "disabled" : ""}>加注至</button></div><button class="secondary" data-action="allin" ${l.max > state.currentBet && !l.canRaise ? "disabled" : ""}>全下</button></div>`;
    if (
      previousAmount &&
      Number(previousAmount) >= l.min &&
      Number(previousAmount) <= l.max
    )
      $("#raise-amount").value = previousAmount;
  } else {
    const title =
      state.stage === "showdown"
        ? "这一手，精彩。"
        : state.stage === "waiting"
          ? "朋友在路上，好运也在。"
          : me.folded
            ? "休息一下，下一手见。"
            : !me.inHand
              ? "已入座，下一手一起玩。"
              : `${esc(state.players[state.turn]?.name || "牌友")} 正在行动`;
    const sub =
      state.stage === "showdown"
        ? host
          ? "点击「再来一手」继续，庄位会自动轮转。"
          : "等待房主开始下一手。"
        : state.stage === "waiting"
          ? host
            ? "邀请朋友加入，或添加练习伙伴先玩一局。"
            : "等待房主开始发牌。"
          : `当前下注 ${fmt(state.currentBet)}${state.myHand ? ` · 你的牌型：${esc(state.myHand)}` : ""}`;
    area.innerHTML = `<div class="action-welcome"><span class="action-icon">${state.stage === "showdown" ? "✦" : "♧"}</span><div><div class="action-title">${title}</div><div class="action-subtitle">${sub}</div></div></div>${playing ? '<span class="timer" id="turn-timer">35</span>' : ""}`;
  }
}
function renderChat() {
  const content = $("#chat-content");
  const nearBottom =
    content.scrollHeight - content.scrollTop - content.clientHeight < 60;
  if (tab === "history")
    content.innerHTML = state?.history.length
      ? state.history
          .map(
            (h) =>
              `<div class="history-item"><small>HAND #${h.hand} · ${new Date(h.time).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small>${esc(h.text)}</div>`,
          )
          .join("")
      : '<div class="chat-empty"><span class="chat-spark">♧</span><b>每一手，都有故事。</b>开局后，牌局记录会出现在这里。</div>';
  else
    content.innerHTML = state?.messages.length
      ? state.messages
          .map(
            (m) =>
              `<div class="message"><span class="avatar">${avatar(m.avatar)}</span><div><small>${esc(m.name)}</small><p>${esc(m.text)}</p></div></div>`,
          )
          .join("")
      : `<div class="chat-empty"><span class="chat-spark">✧</span><b>${state ? "牌友已就位，打个招呼吧。" : "好牌友，从一句你好开始。"}</b>${state ? "轻松聊两句，快乐加倍。" : "加入房间后，就能和朋友聊天了。"}</div>`;
  if (nearBottom && tab === "chat") content.scrollTop = content.scrollHeight;
  $("#chat-input").placeholder =
    tab === "chat" ? "和牌友打个招呼…" : "发送消息到牌桌聊天…";
}
function updateTimer() {
  const timer = $("#turn-timer");
  if (timer && state?.deadline)
    timer.textContent = Math.max(
      0,
      Math.ceil((state.deadline - Date.now()) / 1000),
    );
}
setInterval(updateTimer, 250);
function openRoom(type) {
  mode = type;
  $("#dialog-title").textContent =
    type === "create" ? "开一桌，等朋友。" : "朋友的牌桌，等你入座。";
  $("#join-fields").hidden = type !== "join";
  $("#create-fields").hidden = type !== "create";
  $("#room-code").required = type === "join";
  $("#room-submit").innerHTML =
    `${type === "create" ? "创建房间" : "加入牌桌"} <span>↗</span>`;
  $("#form-error").textContent = "";
  $("#nickname").value = getName();
  renderAvatars();
  $("#room-dialog").showModal();
  setTimeout(
    () =>
      ($("#nickname").value && type === "join"
        ? $("#room-code")
        : $("#nickname")
      ).focus(),
    30,
  );
}
function renderAvatars() {
  $("#avatar-options").innerHTML = palettes
    .map(
      (_, i) =>
        `<button type="button" data-avatar="${i}" class="${i === selectedAvatar ? "selected" : ""}" aria-label="像素搭子 ${i + 1}" aria-pressed="${i === selectedAvatar}">${avatar(i)}</button>`,
    )
    .join("");
}
async function showInvite() {
  if (!state) return;
  let addresses = [];
  try {
    addresses = (await (await fetch("/api/addresses")).json()).addresses;
  } catch {
    /* use current host */
  }
  if (!["localhost", "127.0.0.1", "::1"].includes(location.hostname))
    addresses = [location.origin];
  if (!addresses.length) addresses = [location.origin];
  const links = addresses.map((a) => `${a}/?room=${state.code}`);
  inviteText = `来 Kawaii Casino 玩${state.game.name}！\n房间号：${state.code}\n同一 Wi-Fi 下打开：\n${links.join("\n")}`;
  $("#invite-details").innerHTML =
    `<div class="room-code-display"><small>房间号</small>${state.code}</div>${links.map((link) => `<div class="invite-address"><a href="${esc(link)}">${esc(link)}</a></div>`).join("")}`;
  $("#invite-dialog").showModal();
}
document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  if (button.dataset.mjTile) return toggleTile(button);
  if (button.dataset.gdCard) return toggleGuandanCard(button);
  if (button.dataset.ddzCard) return toggleCard(button);
  if (button.hasAttribute("data-close"))
    return button.closest("dialog").close();
  if (button.dataset.avatar !== undefined) {
    selectedAvatar = Number(button.dataset.avatar);
    return renderAvatars();
  }
  const commandName = button.dataset.command;
  if (commandName === "create" || commandName === "join")
    return openRoom(commandName);
  if (commandName === "invite") return showInvite();
  if (commandName) return command(commandName);
  if (button.dataset.action && state?.legal) {
    button.disabled = true;
    try {
      await request("action", {
        type: button.dataset.action,
        amount: Number(
          button.dataset.bid ??
            $("#bet-amount")?.value ??
            $("#raise-amount")?.value,
        ),
        tile: state.gameType === "mahjong" ? selectedTile() : undefined,
        suit: button.dataset.suit,
        cards:
          state.gameType === "guandan"
            ? selectedGuandanCards()
            : state.gameType === "doudizhu"
              ? selectedCards()
              : undefined,
        hand: state.hand,
        version: state.version,
      });
    } catch (err) {
      toast(err.message);
      render();
    }
  }
});
$("#room-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = $("#room-submit");
  submit.disabled = true;
  $("#form-error").textContent = "";
  try {
    const name = $("#nickname").value.trim();
    const result = await request(mode, {
      name,
      avatar: selectedAvatar,
      code: $("#room-code").value,
      gameType: $("#game-select").value,
      smallBlind: Number($("#blind-select").value),
      stack: Number($("#stack-select").value),
    });
    saveSession({ code: result.code, token: result.token });
    rememberName(name);
    $("#room-dialog").close();
    history.replaceState(null, "", `/?room=${result.code}`);
    toast(
      mode === "create" ? "房间已开好，邀请朋友入座吧。" : "入座成功，好运！",
    );
  } catch (err) {
    $("#form-error").textContent = err.message;
  } finally {
    submit.disabled = false;
  }
});
$("#chat-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("#chat-input").value.trim();
  if (!text) return;
  try {
    await request("chat", { text });
    $("#chat-input").value = "";
    if (tab !== "chat") $("#chat-tab").click();
    $("#chat-content").scrollTop = $("#chat-content").scrollHeight;
  } catch (err) {
    toast(err.message);
  }
});
$("#chat-tab").onclick = () => {
  tab = "chat";
  $("#chat-tab").classList.add("active");
  $("#history-tab").classList.remove("active");
  $("#chat-tab").setAttribute("aria-selected", "true");
  $("#history-tab").setAttribute("aria-selected", "false");
  renderChat();
};
$("#history-tab").onclick = () => {
  tab = "history";
  $("#history-tab").classList.add("active");
  $("#chat-tab").classList.remove("active");
  $("#history-tab").setAttribute("aria-selected", "true");
  $("#chat-tab").setAttribute("aria-selected", "false");
  renderChat();
};
$("#rules-button").onclick = () =>
  $(
    state?.gameType === "guandan"
      ? "#guandan-rules-dialog"
      : state?.gameType === "mahjong"
        ? "#mahjong-rules-dialog"
        : state?.gameType === "doudizhu"
          ? "#doudizhu-rules-dialog"
          : state?.gameType === "blackjack"
            ? "#blackjack-rules-dialog"
            : "#rules-dialog",
  ).showModal();
$("#game-select").onchange = () => {
  const blackjack = $("#game-select").value === "blackjack";
  const doudizhu = $("#game-select").value === "doudizhu";
  const mahjong = $("#game-select").value === "mahjong";
  const guandan = $("#game-select").value === "guandan";
  $("#blind-fields").hidden = blackjack || doudizhu || mahjong || guandan;
  $("#room-form .form-note").textContent =
    `${guandan ? "4 人组队 · 底分 10" : mahjong ? "4 人 · 底分 10" : doudizhu ? "3 人 · 底分 10" : blackjack ? "1–5 人 · 最低下注 10" : "2–8 人"} · 无需注册 · 虚拟筹码`;
};
$("#invite-button").onclick = showInvite;
$("#copy-invite").onclick = async () => {
  try {
    await navigator.clipboard.writeText(inviteText);
    toast("邀请信息已复制。");
  } catch {
    toast("浏览器限制了复制，请选中上方地址手动复制。");
  }
};
$("#sound-button").onclick = () => {
  sound = !sound;
  $("#sound-button").style.color = sound ? "var(--mint)" : "";
  $("#sound-button").setAttribute(
    "aria-label",
    sound ? "关闭音效" : "开启音效",
  );
  ping();
  toast(sound ? "已开启回合提示音" : "已关闭音效");
};
$("#leave-button").onclick = async () => {
  if (
    !confirm(
      state?.gameType === "mahjong"
        ? "确定离开牌桌？本手座位保留，自动定缺、过或出最小合法牌，并正常结算。"
        : state?.gameType === "guandan"
          ? "确定离开牌桌？本手座位保留，自动不出或出最小单张，并正常结算。"
          : state?.gameType === "doudizhu"
            ? "确定离开牌桌？本手座位保留，自动不叫、不出或出最小单张，并正常结算。"
            : state?.gameType === "blackjack"
              ? "确定离开牌桌？已下注的手牌会自动停牌并结算。"
              : "确定离开牌桌？进行中的手牌将弃牌，已全下的牌仍会参与结算。",
    )
  )
    return;
  try {
    await request("leave");
    saveSession(null);
    state = null;
    history.replaceState(null, "", "/");
    render();
  } catch (err) {
    toast(err.message);
  }
};
socket.on("connect", async () => {
  online = true;
  const session = stored();
  if (session) {
    try {
      await request("resume", session);
    } catch (err) {
      saveSession(null);
      state = null;
      toast(err.message);
    }
  }
  render();
  const invited = new URLSearchParams(location.search).get("room");
  if (!state && /^\d{6}$/.test(invited || "") && !$("#room-dialog").open) {
    openRoom("join");
    $("#room-code").value = invited;
  }
});
socket.on("disconnect", () => {
  online = false;
  render();
});
socket.on("state", (next) => {
  state = next;
  render();
});
socket.on("replaced", () => {
  saveSession(null);
  state = null;
  online = false;
  toast("这个座位已在另一个页面恢复。");
  render();
});
for (const dialog of document.querySelectorAll("dialog"))
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        dialog.close();
    }
  });
fetch("/api/games")
  .then((r) => r.json())
  .then((games) => {
    const selected = $("#game-select").value;
    $("#game-select").innerHTML = games
      .map((g) => `<option value="${esc(g.gameType)}">${esc(g.name)}</option>`)
      .join("");
    $("#game-select").value = selected;
  })
  .catch(() => {});
render();
socket.connect();
