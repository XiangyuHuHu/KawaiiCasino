import { randomInt } from "node:crypto";
import { Table } from "../poker.js";

// Adapter keeps the original Hold'em engine and its public API unchanged.
export class PokerTable extends Table {
  action(id, input) {
    return this.act(id, input.type, input.amount);
  }
  automaticAction(id, bot) {
    const legal = this.legal(id);
    if (!legal) return;
    if (bot && legal.canRaise && legal.max >= legal.min && randomInt(10) === 0)
      this.act(id, "raise", legal.min);
    else if (!legal.toCall) this.act(id, "check");
    else if (bot && (legal.toCall < this.bigBlind * 5 || randomInt(4) !== 0))
      this.act(id, "call");
    else this.act(id, "fold");
  }
}
