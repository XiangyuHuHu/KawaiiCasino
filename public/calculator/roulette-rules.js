export const redNumbers = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);
export const europeanOrder = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
].map(String);
export const betNames = {
  red: "红色",
  black: "黑色",
  odd: "单数",
  even: "双数",
  low: "1–18",
  high: "19–36",
  straight: "单号",
  split: "分注 · 2个邻号",
  street: "街注 · 3个同排号",
  corner: "角注 · 4个角号",
  six: "六线 · 相邻两排",
  dozen: "十二数 · 第1/2/3打",
  column: "列注 · 第1/2/3列",
  basket: "美式五数",
};
export function rouletteNumbers(wheel) {
  if (!["european", "american", "triple"].includes(wheel))
    throw new Error("轮盘规则无效");
  return [
    ...europeanOrder,
    ...(wheel === "european" ? [] : ["00"]),
    ...(wheel === "triple" ? ["000"] : []),
  ];
}
export function resolveBet(wheel, kind, input = "") {
  const pockets = rouletteNumbers(wheel),
    normal = Array.from({ length: 36 }, (_, i) => i + 1);
  const outside = {
    red: normal.filter((n) => redNumbers.has(n)),
    black: normal.filter((n) => !redNumbers.has(n)),
    odd: normal.filter((n) => n % 2),
    even: normal.filter((n) => n % 2 === 0),
    low: normal.slice(0, 18),
    high: normal.slice(18),
  };
  if (outside[kind])
    return {
      kind,
      numbers: outside[kind].map(String),
      payout: 1,
      name: betNames[kind],
    };
  const raw = String(input)
    .trim()
    .split(/[\s,，]+/)
    .filter(Boolean);
  if (kind === "dozen" || kind === "column") {
    if (raw.length !== 1 || !["1", "2", "3"].includes(raw[0]))
      throw new Error("请输入第1、2或3打／列");
    const n = Number(raw[0]);
    return {
      kind,
      numbers: normal
        .filter((x) =>
          kind === "dozen"
            ? Math.floor((x - 1) / 12) === n - 1
            : (x - 1) % 3 === n - 1,
        )
        .map(String),
      payout: 2,
      name: `第${n}${kind === "dozen" ? "打" : "列"}`,
    };
  }
  if (kind === "basket") {
    if (wheel !== "american") throw new Error("五数投注仅限美式双零");
    return {
      kind,
      numbers: ["0", "00", "1", "2", "3"],
      payout: 6,
      name: betNames[kind],
    };
  }
  const count = { straight: 1, split: 2, street: 3, corner: 4, six: 6 }[kind];
  if (
    !count ||
    raw.length !== count ||
    new Set(raw).size !== count ||
    raw.some((n) => !pockets.includes(n))
  )
    throw new Error("投注号码数量或号码无效");
  const nums = raw.map(Number).sort((a, b) => a - b),
    start = nums[0];
  const shape = (expected) =>
    expected.length === nums.length && expected.every((n, i) => n === nums[i]);
  const regular = raw.every((n) => !n.startsWith("0"));
  const valid =
    kind === "straight" ||
    (kind === "split" &&
      ((regular &&
        (nums[1] - start === 3 ||
          (nums[1] - start === 1 &&
            Math.floor((start - 1) / 3) === Math.floor((nums[1] - 1) / 3)))) ||
        (wheel === "european" &&
          start === 0 &&
          nums[1] >= 1 &&
          nums[1] <= 3))) ||
    (kind === "street" &&
      ((regular &&
        (start - 1) % 3 === 0 &&
        shape([start, start + 1, start + 2])) ||
        (wheel === "european" && (shape([0, 1, 2]) || shape([0, 2, 3]))))) ||
    (kind === "corner" &&
      ((regular &&
        (start - 1) % 3 < 2 &&
        shape([start, start + 1, start + 3, start + 4])) ||
        (wheel === "european" && shape([0, 1, 2, 3])))) ||
    (kind === "six" &&
      regular &&
      (start - 1) % 3 === 0 &&
      shape(Array.from({ length: 6 }, (_, i) => start + i)));
  if (!valid) throw new Error("号码必须组成轮盘桌上相邻的合法投注区域");
  return {
    kind,
    numbers: raw,
    payout: { straight: 35, split: 17, street: 11, corner: 8, six: 5 }[kind],
    name: betNames[kind],
  };
}
