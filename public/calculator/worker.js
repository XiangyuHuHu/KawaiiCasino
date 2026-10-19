import { roulette, blackjack, poker } from "./engine.js";
self.onmessage = ({ data }) => {
  try {
    const calculate = { roulette, blackjack, poker }[data.game];
    if (!calculate) throw new Error("未知玩法。");
    const result = calculate(data.input, (fraction) =>
      self.postMessage({ progress: fraction }),
    );
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
