import { buildLiveInput } from "./calculator/live-input.js";
import { resolveBet } from "./calculator/roulette-rules.js";
let worker = null,
  timer = null,
  lastKey = null,
  lastResult = null,
  lastError = null,
  current = null,
  model = "finite";
const $ = (selector) => document.querySelector(selector);
const percent = (value) => `${(value * 100).toFixed(1)}%`;
const signed = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function stop() {
  worker?.terminate();
  worker = null;
  clearTimeout(timer);
}
function paint() {
  const panel = $("#probability-panel");
  const game = current?.game;
  const controls = `<button class="text-button" data-open-calculator>计算说明 ↗</button>${game === "blackjack" ? `<select id="prob-model" aria-label="局内21点计算模型"><option value="finite" ${model === "finite" ? "selected" : ""}>有限牌靴 · 精确递归</option><option value="infinite" ${model === "infinite" ? "selected" : ""}>无限牌靴 · 明确近似</option></select>` : ""}`;
  let body =
    '<p class="prob-note">发牌并轮到可分析的手牌后，自动显示当前牌面概率。</p>';
  if (lastError)
    body = `<p class="prob-error">${esc(lastError)}${game === "blackjack" && model === "finite" ? " 可手动选择无限牌靴近似；没有自动替换模型。" : ""}</p>`;
  else if (current && !lastResult)
    body =
      '<p class="prob-note" aria-live="polite">正在浏览器后台计算当前牌面…</p>';
  else if (lastResult && current) {
    const r = lastResult;
    if (game === "poker") {
      body = `<div class="prob-metrics"><div><small>独赢概率</small><b>${percent(r.win)}</b></div><div><small>平分底池概率</small><b>${percent(r.tie)}</b></div><div><small>摊牌权益</small><b>${percent(r.equity)}</b></div><div><small>抽样误差界</small><b>±${percent(r.radius)}</b></div></div><p class="prob-note">${r.method === "exact" ? "精确枚举" : `${r.samples.toLocaleString()} 次固定种子模拟 · 95% 抽样误差界`}。假设尚在局中的对手为均匀随机手牌，不读取对手底牌；真实下注范围可能不同。</p><p class="prob-note">${current.info.sidePots ? "本手涉及全下／潜在边池，仅展示摊牌概率，不给出跟注EV。" : `当前跟注 ${current.input.call} · ${current.info.river ? "假设跟注后直接摊牌" : "仍有后续下注，权益不等于行动价值"}。`} 不据此计算加注、诈唬或保证最优行动。</p>`;
    } else if (game === "blackjack") {
      body = `<div class="prob-table-wrap"><table class="prob-table"><thead><tr><th>动作</th><th>赢</th><th>平</th><th>输</th><th>净期望筹码</th></tr></thead><tbody>${r.actions.map((a) => `<tr><th>${esc(a.name)}</th><td>${percent(a.win)}</td><td>${percent(a.push)}</td><td>${percent(a.loss)}</td><td>${signed(a.ev * r.stake)}</td></tr>`).join("")}</tbody></table></div><p class="prob-note">${r.method === "exact" ? `有限牌靴精确递归 · ${r.remaining} 张未知牌` : "无限牌靴近似 · 每次抽牌独立"}。仅使用自身手牌、公开牌和本牌靴已公开的历史牌；未读取庄家暗牌。</p><p class="prob-note">${current.info.pair || current.info.split ? "分牌没有纳入动作比较；这里只比较列出的动作。 " : ""}要牌后的后续要牌／停牌按较高期望递归；其他座位后续抽牌会改变牌面。当前为第 ${current.info.handIndex + 1} 手参考。</p>`;
    } else
      body = `<div class="prob-metrics"><div><small>命中概率</small><b>${percent(r.win)}</b></div><div><small>赌场优势</small><b>${percent(-r.unitEV)}</b></div><div><small>本注期望净收益</small><b>${signed(r.ev)}</b></div></div><p class="prob-note">${r.pockets} 格等概率 · 精确计算${r.halfLoss ? " · 零点退半" : ""}。每次转盘独立，历史结果不改变下一局概率。${current.info.settled ? "本局已结算，以上为该投注类型的规则概率。" : ""}</p>`;
  }
  panel.innerHTML = `<header class="prob-heading"><div><span class="eyebrow">PROBABILITY LAB</span><h3>当前牌面 · 概率参考</h3></div><div class="prob-tools">${controls}</div></header>${body}`;
}
export function renderProbability(state) {
  const panel = $("#probability-panel");
  const supported =
    state && ["poker", "blackjack", "roulette"].includes(state.gameType);
  panel.hidden = !supported;
  if (!supported) {
    stop();
    lastKey = null;
    lastResult = null;
    lastError = null;
    current = null;
    return;
  }
  let choice;
  if (state.gameType === "roulette") {
    const me = state.players.find((p) => p.id === state.me);
    try {
      choice = me.bet || {
        ...resolveBet(
          state.wheel,
          $("#roulette-bet-select")?.value || "red",
          $("#roulette-numbers")?.value || "17",
        ),
        amount: Number($("#bet-amount")?.value) || 100,
      };
    } catch (error) {
      stop();
      current = null;
      lastKey = null;
      lastResult = null;
      lastError = error.message;
      paint();
      return;
    }
  }
  current = buildLiveInput(state, model, choice);
  if (!current) {
    stop();
    lastKey = null;
    lastResult = null;
    lastError = null;
    paint();
    return;
  }
  if (lastKey === current.key) {
    paint();
    return;
  }
  stop();
  lastKey = current.key;
  lastResult = null;
  lastError = null;
  paint();
  const key = lastKey;
  worker = new Worker(new URL("./calculator/worker.js", import.meta.url), {
    type: "module",
  });
  worker.onerror = (event) => {
    event.preventDefault();
    if (lastKey === key) {
      lastError = "计算线程无法运行，请重新刷新。";
      stop();
      paint();
    }
  };
  worker.onmessage = ({ data }) => {
    if (lastKey !== key || data.progress !== undefined) return;
    lastResult = data.result || null;
    lastError = data.error || null;
    stop();
    paint();
  };
  timer = setTimeout(() => {
    if (lastKey === key) {
      lastError = "本次计算超过15秒，已取消。";
      stop();
      paint();
    }
  }, 15000);
  worker.postMessage({ game: current.game, input: current.input });
}
document.addEventListener("change", (event) => {
  if (event.target.id === "prob-model") {
    model = event.target.value;
    lastKey = null;
    document.dispatchEvent(new CustomEvent("probability-refresh"));
  }
});
