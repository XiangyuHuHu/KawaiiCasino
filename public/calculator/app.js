import { parseCards, cardText, parseRanks } from "./engine.js";
const $ = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const percent = (value, digits = 2) => `${(value * 100).toFixed(digits)}%`;
const money = (value) =>
  new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 }).format(value);
const signed = (value) => `${value > 0 ? "+" : ""}${money(value)}`;
const tinyProbability = (log10) =>
  `${(10 ** (log10 - Math.floor(log10))).toFixed(3)}e${Math.floor(log10)}`;
const esc = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let game = "roulette",
  worker,
  timer,
  lastRecord = null,
  computing = false;

function getInput() {
  const form = $(`#form-${game}`),
    input = Object.fromEntries(new FormData(form));
  all(`#form-${game} input[type=checkbox]`).forEach(
    (field) => (input[field.name] = field.checked),
  );
  input.h17 = input.h17 === "true";
  input.bankroll = $("#bankroll").value;
  return input;
}
function saveInputs() {
  try {
    const forms = {};
    all(".game-form").forEach(
      (form) =>
        (forms[form.id] = Object.fromEntries(
          [...form.elements]
            .filter((f) => f.name)
            .map((f) => [f.name, f.type === "checkbox" ? f.checked : f.value]),
        )),
    );
    localStorage.setItem(
      "odds-lab-v1",
      JSON.stringify({
        game,
        bankroll: $("#bankroll").value,
        riskLimit: $("#riskLimit").value,
        forms,
      }),
    );
  } catch {
    /* Calculator also works with browser storage disabled. */
  }
}
function restoreInputs() {
  try {
    const state = JSON.parse(localStorage.getItem("odds-lab-v1") || "null");
    if (!state) return;
    for (const [id, values] of Object.entries(state.forms || {})) {
      const form = document.getElementById(id);
      if (!form) continue;
      for (const [name, value] of Object.entries(values)) {
        const f = form.elements.namedItem(name);
        if (f) {
          if (f.type === "checkbox") f.checked = Boolean(value);
          else f.value = String(value);
        }
      }
    }
    if (state.bankroll !== undefined) $("#bankroll").value = state.bankroll;
    if (state.riskLimit !== undefined) $("#riskLimit").value = state.riskLimit;
    if (["roulette", "blackjack", "poker"].includes(state.game))
      selectGame(state.game, false);
  } catch {
    /* Ignore corrupt or unavailable local storage. */
  }
}
function cardPreviews() {
  all("[data-preview]").forEach((preview) => {
    const field = preview.previousElementSibling;
    try {
      const cards =
        preview.dataset.preview === "cards"
          ? parseCards(field.value).map(cardText)
          : parseRanks(field.value).map((r) => (r === 1 ? "A" : String(r)));
      preview.innerHTML = cards
        .slice(0, 12)
        .map(
          (text) =>
            `<span class="card ${/[♥♦]/.test(text) ? "red" : ""}">${esc(text.replace(/[♠♥♦♣]/, ""))}<small>${esc((text.match(/[♠♥♦♣]/) || ["♣"])[0])}</small></span>`,
        )
        .join("");
    } catch {
      preview.innerHTML = "";
    }
  });
}
function finishBusy() {
  computing = false;
  clearTimeout(timer);
  worker?.terminate();
  worker = undefined;
  $("#calculate").disabled = false;
  $("#calculate").innerHTML = "计算场面 <span>↗</span>";
  $("#cancel").hidden = true;
  $("#results").removeAttribute("aria-busy");
}
function invalidate() {
  if (computing) {
    finishBusy();
    $("#calculation-status").textContent = "输入已改变，计算已取消。";
  }
  if (lastRecord) {
    $("#results").classList.add("results-stale");
    $("#method-badge").textContent = "待重新计算";
    if (!$("#stale-alert"))
      $("#results").insertAdjacentHTML(
        "beforebegin",
        '<div id="stale-alert" class="stale-alert">输入已修改，以下是上一次的结果。请重新计算。</div>',
      );
  } else if ($("#results .loading"))
    $("#results").innerHTML =
      '<div class="empty-results"><h2>输入已改变</h2><p>点击「计算场面」获取当前结果。</p></div>';
  $("#export").hidden = true;
  $("#error").hidden = true;
  cardPreviews();
  saveInputs();
}
function selectGame(next, persist = true) {
  if (computing) finishBusy();
  game = next;
  lastRecord = null;
  all("[data-game]").forEach((tab) => {
    const selected = tab.dataset.game === game;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  all(".game-form").forEach(
    (form) => (form.hidden = form.id !== `form-${game}`),
  );
  $("#calculate").setAttribute("form", `form-${game}`);
  $("#error").hidden = true;
  $("#export").hidden = true;
  $("#stale-alert")?.remove();
  $("#results").classList.remove("results-stale");
  $("#results").innerHTML =
    '<div class="empty-results"><span>∑</span><h2>看清一笔下注的价值</h2><p>填写场面后点击计算，<br>查看胜率、净收益与筹码占用。</p><div class="empty-metrics"><span>概率</span><span>期望</span><span>资金</span></div></div>';
  $("#method-badge").textContent = "等待计算";
  $("#calculation-status").textContent = "公平规则 · 明确假设";
  if (persist) saveInputs();
}
function detail(label, value, tone = "") {
  return `<div class="detail-row"><span>${esc(label)}</span><strong class="${tone}">${esc(value)}</strong></div>`;
}
function metric(label, value, subtitle, tone = "") {
  return `<div class="metric"><label>${esc(label)}</label><strong class="${tone}">${esc(value)}</strong><small>${esc(subtitle)}</small></div>`;
}
function probabilities(items) {
  return `<div class="prob-bars"><div class="bar-track" aria-hidden="true">${items.map((x) => `<span class="${x.class || ""}" style="flex:${x.p}"></span>`).join("")}</div><div class="bar-labels">${items.map((x) => `<span class="${x.class || ""}"><i></i>${esc(x.label)} ${percent(x.p)}</span>`).join("")}</div></div>`;
}
function funding(result, message) {
  const limit = Number($("#riskLimit").value) / 100,
    warning = result.exposure > limit;
  return `<div class="funding ${warning ? "warning" : ""}">${detail("此次资金占用", percent(result.exposure))}<p>${warning ? `超过你设定的 ${percent(limit, 0)} 提醒线。` : ""}${esc(message)}</p></div>`;
}
function resultHTML(r) {
  if (r.game === "roulette") {
    const items = [
      { label: "赢", p: r.win },
      { label: "全损", p: r.loss, class: "loss" },
    ];
    if (r.halfLoss) items.push({ label: "半损", p: r.halfLoss, class: "half" });
    return `<div class="verdict negative"><span class="caption">以盈利为目标的判断</span><h2>不下注 · 负期望</h2><p>这笔下注每投入100筹码，平均净亏 ${money(-r.unitEV * 100)}。公平轮盘各次旋转独立。</p></div><div class="big-metrics">${metric("单局胜率", percent(r.win), `${r.covered} / ${r.pockets} 个格子`)}${metric("单局期望净收益", signed(r.ev), `下注 ${money(r.stake)} 筹码`, "negative-value")}</div>${probabilities(items)}<div class="detail-rows">${detail("赌场优势", percent(-r.unitEV))}${detail("赢时净赔付", `${r.payout} : 1`)}${detail(`${r.rounds}轮期望净收益`, signed(r.totalEV), "negative-value")}${detail(`${r.rounds}轮收益标准差`, `± ${money(r.sd)}`)}${detail(`${r.rounds}轮全部全损概率`, r.fullLossStreak < 0.000001 ? tinyProbability(r.log10FullLossStreak) : percent(r.fullLossStreak, 4))}${detail("盈利目标下的凯利下注", "0 筹码")}</div>${funding(r, "资金更多只能增加承受波动的能力，不会改善下注的期望收益。")}<p class="result-note">${esc(r.note)}连续全损概率不是破产概率。历史热号、冷号及翻倍追损不改变上述期望。</p>`;
  }
  if (r.game === "blackjack") {
    const best = r.best,
      totalEV = best.ev * r.stake,
      insufficient = r.pair;
    const title =
      r.total > 21
        ? "已爆牌"
        : insufficient
          ? `候选动作：${best.name}`
          : `当前建议：${best.name}`;
    return `<div class="verdict ${totalEV < 0 || insufficient ? "negative" : ""}"><span class="caption">当前牌面：${r.soft ? "软" : "硬"}${r.total}${r.natural ? " · 自然21点" : ""}</span><h2>${title}</h2><p>${insufficient ? "你持有对子。当前未比较分牌，以下只代表已列出动作中的最优选择。" : "按期望净收益选择动作，胜率最高的动作未必收益最好。"}${totalEV < 0 ? "当前所有候选动作均为负期望，这是已下注后的损失比较。" : ""}</p></div><div class="big-metrics">${metric("推荐动作赢局概率", percent(best.win), "平局不计为获胜")}${metric("动作期望净收益", signed(totalEV), `相对本局原始下注 ${money(r.stake)}`, totalEV < 0 ? "negative-value" : "positive")}</div>${probabilities(
      [
        { label: "赢", p: best.win },
        { label: "平", p: best.push, class: "push" },
        {
          label: best.id === "surrender" ? "半损投降" : "输",
          p: best.loss,
          class: "loss",
        },
      ],
    )}<table class="actions-table"><caption class="help">当前可用候选动作，按期望收益排序</caption><thead><tr><th scope="col">动作</th><th scope="col">胜率</th><th scope="col">期望净收益</th></tr></thead><tbody>${r.actions.map((a, i) => `<tr class="${i === 0 ? "best" : ""}"><td>${esc(a.name)}${i === 0 ? " ↗" : ""}</td><td>${percent(a.win)}</td><td>${signed(a.ev * r.stake)}</td></tr>`).join("")}</tbody></table><div class="detail-rows">${detail("剩余未知牌（含底牌）", `${r.remaining} 张`)}${detail("递归状态数", money(r.states))}${detail("自然21点检查", r.excluded ? "已排除庄家自然21点" : "当前未排除或无需检查")}${detail("已列候选中最优单位EV", best.ev.toFixed(6))}</div>${funding(r, "这是一笔已发生下注的动作选择，不用于决定新一局的下注额。加倍只在总筹码足够时列出。")}<p class="result-note">${esc(r.note)}${r.method === "infinite" ? "当前为无限牌靴模型；抽牌独立，未利用实际剩余牌组成。" : "剩余未知牌假设均匀随机洗牌；历史牌遗漏会改变实际结果。"}投降的“输”表示固定损失一半原始下注。</p>`;
  }
  const uncertain = r.evInterval[0] <= 0 && r.evInterval[1] >= 0;
  const kellyText =
    r.call === 0
      ? "无需跟注"
      : uncertain
        ? "误差跨过盈亏线，暂不提供额度"
        : r.ev <= 0
          ? "0 筹码"
          : `${money(r.quarterKellyBudget)} 筹码（同分布参考）`;
  return `<div class="verdict ${r.ev <= 0 || uncertain ? "negative" : ""}"><span class="caption">直接摊牌模型下的判断</span><h2>${esc(r.decision)}</h2><p>${r.unknown ? `${r.unknown}位对手使用均匀随机范围。` : "对手手牌已固定。"}${r.call === 0 ? "无需支付即可继续；此工具未评估主动下注或加注。" : "只比较跟注与弃牌。未评估主动下注或加注。"}</p></div><div class="big-metrics">${metric("底池权益", percent(r.equity), "包括平局分到的底池份额")}${metric("跟注期望净收益", signed(r.ev), "扣除跟注金额与底池抽水", r.ev < 0 ? "negative-value" : "positive")}</div>${probabilities(
    [
      { label: "独赢", p: r.win },
      { label: "平局", p: r.tie, class: "push" },
      { label: "输", p: r.loss, class: "loss" },
    ],
  )}<div class="detail-rows">${detail("跟注所需最低权益", percent(r.threshold))}${detail(r.method === "exact" ? "完整枚举结果" : "权益的95%误差界", r.method === "exact" ? "无抽样误差" : `${percent(r.interval[0])} – ${percent(r.interval[1])}`)}${detail("EV区间", `${signed(r.evInterval[0])} – ${signed(r.evInterval[1])}`)}${detail("抽水后最终底池", `${money(r.distributable)} 筹码`)}${detail("本局抽水", `${money(r.rake)} 筹码`)}${detail(r.method === "exact" ? "枚举场景数" : "模拟次数 / 随机种子", r.method === "exact" ? money(r.samples) : `${money(r.samples)} / ${r.seed}`)}${detail("四分之一凯利参考额度", kellyText)}</div>${funding(r, "权益领先赔率，也可能输掉整笔跟注。凯利参考不决定该牌局的加注大小。")}<details class="distribution"><summary>你的最终牌型分布</summary>${r.histogram
    .filter((h) => h.p > 0)
    .map(
      (h) =>
        `<div class="hist-row"><span>${h.name}</span><b><i style="width:${h.p * 100}%"></i></b><span>${percent(h.p, 1)}</span></div>`,
    )
    .join(
      "",
    )}</details><p class="result-note">${esc(r.note)}${r.method === "montecarlo" ? "误差界采用Hoeffding不等式；95%指独立重复模拟的覆盖保证，不是实际胜率正确的概率。" : ""}</p>`;
}
function calculate(event) {
  event?.preventDefault();
  if (computing) return;
  const input = getInput(),
    riskLimit = Number($("#riskLimit").value);
  if (
    !$("#bankroll").value ||
    !Number.isFinite(Number(input.bankroll)) ||
    Number(input.bankroll) <= 0 ||
    !$("#riskLimit").value ||
    riskLimit < 1 ||
    riskLimit > 100 ||
    !Number.isInteger(riskLimit)
  ) {
    $("#error").hidden = false;
    $("#error").textContent =
      "总筹码必须大于0，资金占用提醒线必须是1–100的整数。";
    return;
  }
  if (!$(`#form-${game}`).reportValidity()) return;
  saveInputs();
  lastRecord = null;
  computing = true;
  $("#error").hidden = true;
  $("#stale-alert")?.remove();
  $("#export").hidden = true;
  $("#results").classList.remove("results-stale");
  $("#calculate").disabled = true;
  $("#calculate").textContent = "正在计算…";
  $("#cancel").hidden = false;
  $("#method-badge").textContent = "计算中";
  $("#results").setAttribute("aria-busy", "true");
  $("#results").innerHTML =
    '<div class="loading"><div class="spinner"></div>正在分析合法场景…<p class="help">精确枚举可能需要数秒，可随时取消。</p></div>';
  $("#calculation-status").textContent = "计算在本地浏览器进行";
  const started = performance.now();
  worker = new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
  });
  const fail = (message) => {
    finishBusy();
    $("#error").hidden = false;
    $("#error").textContent = message;
    $("#method-badge").textContent = "无法计算";
    $("#results").innerHTML =
      '<div class="empty-results"><span>∑</span><h2>请检查输入</h2><p>修正场面或规则后重新计算。</p></div>';
    $("#calculation-status").textContent = "未生成结果";
    lastRecord = null;
  };
  worker.onerror = () =>
    fail(
      "计算线程无法启动。请使用本地HTTP服务打开页面：npm start；不要直接打开HTML文件。",
    );
  worker.onmessage = ({ data }) => {
    if (data.progress !== undefined) {
      $("#calculation-status").textContent =
        `模拟进度 ${percent(data.progress, 0)}`;
      return;
    }
    if (data.error) {
      fail(data.error);
      return;
    }
    const r = data.result,
      elapsed = performance.now() - started;
    finishBusy();
    $("#results").innerHTML = resultHTML(r);
    $("#export").hidden = false;
    $("#method-badge").textContent = {
      exact: "精确枚举",
      infinite: "无限牌靴模型",
      montecarlo: "模拟 · 95%误差界",
    }[r.method];
    $("#calculation-status").textContent =
      `计算完成 · ${(elapsed / 1000).toFixed(2)}s · 可导出输入与结果`;
    lastRecord = {
      version: 1,
      time: new Date().toISOString(),
      game,
      input,
      riskLimit,
      elapsedMs: elapsed,
      result: r,
    };
  };
  timer = setTimeout(
    () =>
      fail(
        "计算超过60秒，已停止。可以减少模拟次数，或手动选择无限牌靴模型。未将近似结果冒充精确结果。",
      ),
    60000,
  );
  worker.postMessage({ game, input });
}

all("[data-game]").forEach((tab) =>
  tab.addEventListener("click", () => selectGame(tab.dataset.game)),
);
$(".tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = all("[data-game]"),
    current = tabs.findIndex((t) => t.dataset.game === game);
  const index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? 2
        : (current + (event.key === "ArrowRight" ? 1 : 2)) % 3;
  selectGame(tabs[index].dataset.game);
  tabs[index].focus();
});
all(".game-form").forEach((form) => {
  form.addEventListener("submit", calculate);
  form.addEventListener("input", invalidate);
});
$("#bankroll").addEventListener("input", invalidate);
$("#riskLimit").addEventListener("input", invalidate);
all("[data-bankroll]").forEach((button) =>
  button.addEventListener("click", () => {
    $("#bankroll").value = button.dataset.bankroll;
    invalidate();
  }),
);
$("#cancel").addEventListener("click", () => {
  finishBusy();
  $("#results").innerHTML =
    '<div class="empty-results"><h2>计算已取消</h2><p>修改输入后可重新开始。</p></div>';
  $("#method-badge").textContent = "已取消";
  $("#calculation-status").textContent = "未生成新结果";
  lastRecord = null;
});
$("#example").addEventListener("click", () => {
  const form = $(`#form-${game}`);
  form.reset();
  const stake = form.elements.namedItem("stake");
  if (stake && Number($("#bankroll").value) > 0)
    stake.value = Math.min(10, Number($("#bankroll").value));
  if (game === "poker" && Number($("#bankroll").value) > 0)
    form.elements.namedItem("call").value = Math.min(
      20,
      Number($("#bankroll").value),
    );
  invalidate();
  calculate();
});
$("#export").addEventListener("click", () => {
  if (!lastRecord || $("#results").classList.contains("results-stale")) return;
  const blob = new Blob([JSON.stringify(lastRecord, null, 2)], {
      type: "application/json",
    }),
    url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `odds-lab-${lastRecord.game}-${Date.now()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
restoreInputs();
cardPreviews();
calculate();
