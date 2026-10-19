import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { networkInterfaces } from "node:os";
import { randomBytes, randomInt } from "node:crypto";
import { Server } from "socket.io";
import { games, gameMetadata } from "./games/index.js";

const root = new URL("../public/", import.meta.url);
const files = {
  "/games/guandan.js": ["games/guandan.js", "text/javascript; charset=utf-8"],
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/games/mahjong.js": ["games/mahjong.js", "text/javascript; charset=utf-8"],
  "/games/doudizhu.js": ["games/doudizhu.js", "text/javascript; charset=utf-8"],
  "/games/blackjack.js": [
    "games/blackjack.js",
    "text/javascript; charset=utf-8",
  ],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
};
const STALE_ACTION = "牌局已更新，请重新操作";
const BURST_LIMIT = 40;
// Host round controls stay available after a fast assist burst.
const BURST_EXEMPT = new Set(["deal", "start", "next"]);

function envMillis(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) return fallback;
  return value;
}

export function createCasino({
  publicUrls = process.env.PUBLIC_URLS || "",
  botDelay = envMillis("BOT_DELAY_MS", 1000),
  tickInterval = 300,
  actionTimeout = envMillis("ACTION_TIMEOUT_MS", 35000),
} = {}) {
  const advertisedAddresses = publicUrls
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("PUBLIC_URLS 必须是 HTTP/HTTPS 地址");
      return url.origin;
    });
  const rooms = new Map();
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    }
    if (pathname === "/api/games") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify([...games.keys()].map(gameMetadata)));
    }
    if (pathname === "/api/addresses") {
      const port = server.address()?.port;
      const addresses = advertisedAddresses.length
        ? advertisedAddresses
        : Object.values(networkInterfaces())
            .flat()
            .filter((n) => n.family === "IPv4" && !n.internal)
            .map((n) => `http://${n.address}:${port}`);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ addresses }));
    }
    const file = files[pathname];
    if (!file) {
      res.writeHead(404);
      return res.end("Not found");
    }
    try {
      const data = await readFile(new URL(file[0], root));
      res.writeHead(200, {
        "Content-Type": file[1],
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(data);
    } catch {
      res.writeHead(500);
      res.end("Unable to load page");
    }
  });
  const io = new Server(server, { maxHttpBufferSize: 8192, serveClient: true });
  const cleanName = (value) => {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 16)
      throw new Error("昵称需要 1–16 个字符");
    return value.trim();
  };
  const emit = (room) => {
    room.updated = Date.now();
    for (const p of room.table.players) {
      const socket = io.sockets.sockets.get(p.socketId);
      if (socket)
        socket.emit("state", {
          code: room.code,
          hostId: room.hostId,
          me: p.id,
          gameType: room.gameType,
          mode: room.mode || "multiplayer",
          game: gameMetadata(room.gameType),
          ...room.table.view(p.id),
          messages: room.messages,
        });
    }
  };
  const migrate = (room) => {
    if (
      !room.table.players.some(
        (p) => p.id === room.hostId && p.connected && !p.left,
      )
    )
      room.hostId =
        room.table.players.find((p) => p.connected && !p.bot && !p.left)?.id ||
        null;
  };
  io.on("connection", (socket) => {
    let hits = 0;
    let windowStart = Date.now();
    const event = (name, handler) =>
      socket.on(name, (input = {}, ack = () => {}) => {
        if (typeof ack !== "function") ack = () => {};
        let consumed = false;
        try {
          const now = Date.now();
          if (now - windowStart >= 1000) {
            hits = 0;
            windowStart = now;
          }
          if (!BURST_EXEMPT.has(name)) {
            if (hits >= BURST_LIMIT) throw new Error("操作太快了，稍等一下");
            hits += 1;
            consumed = true;
          }
          if (!input || typeof input !== "object" || Array.isArray(input))
            throw new Error("请求格式无效");
          ack({ ok: true, ...handler(input) });
        } catch (error) {
          if (consumed && error.message === STALE_ACTION) hits -= 1;
          ack({ ok: false, error: error.message });
        }
      });
    const current = () => {
      const room = rooms.get(socket.data.code);
      const player = room?.table.players.find(
        (p) =>
          p.id === socket.data.playerId && p.socketId === socket.id && !p.left,
      );
      if (!room || !player) throw new Error("请先加入房间");
      return { room, player };
    };
    const host = () => {
      const c = current();
      if (c.room.hostId !== c.player.id) throw new Error("只有房主可以操作");
      return c;
    };
    const enter = (room, player) => {
      socket.data.code = room.code;
      socket.data.playerId = player.id;
      player.socketId = socket.id;
      player.connected = true;
      if (!room.hostId) room.hostId = player.id;
      emit(room);
      return { code: room.code, token: player.token, playerId: player.id };
    };
    event("create", (input) => {
      if (socket.data.code) throw new Error("请先离开当前房间");
      if (rooms.size >= 1000) throw new Error("服务器房间已满");
      const name = cleanName(input.name);
      const gameType = input.gameType ?? "poker";
      gameMetadata(gameType);
      const { Engine } = games.get(gameType);
      const smallBlind = [25, 50, 100].includes(input.smallBlind)
        ? input.smallBlind
        : 50;
      const stack = [5000, 10000, 20000].includes(input.stack)
        ? input.stack
        : 10000;
      let code;
      do {
        code = String(randomInt(100000, 1000000));
      } while (rooms.has(code));
      const room = {
        code,
        gameType,
        mode: input.solo === true ? "solo" : "multiplayer",
        table: new Engine({ smallBlind, stack, actionTimeout }),
        messages: [],
        updated: Date.now(),
        hostId: null,
      };
      const p = room.table.addPlayer(name, {
        token: randomBytes(24).toString("hex"),
        avatar: Number.isInteger(input.avatar) ? Math.abs(input.avatar % 8) : 0,
      });
      if (room.mode === "solo") {
        const names = [
          "薄荷团子",
          "桃桃汽水",
          "午夜布丁",
          "星星奶糖",
          "奶盖小熊",
          "月亮松饼",
          "抹茶狐狸",
          "椰椰小猫",
          "橘子海",
          "芝士年糕",
        ].filter((candidate) => candidate !== p.name);
        for (let i = names.length - 1; i > 0; i--) {
          const j = randomInt(i + 1);
          [names[i], names[j]] = [names[j], names[i]];
        }
        const { maxPlayers } = games.get(gameType);
        for (let i = 0; i < maxPlayers - 1; i++)
          room.table.addPlayer(names[i], {
            bot: true,
            avatar: (p.avatar + i + 1) % 8,
          });
        room.table.start();
      }
      rooms.set(code, room);
      return enter(room, p);
    });
    event("join", (input) => {
      if (socket.data.code) throw new Error("请先离开当前房间");
      const room = rooms.get(String(input.code));
      if (!room) throw new Error("房间不存在，请检查六位房间号");
      if (room.mode === "solo")
        throw new Error("这是单人娱乐房间，请创建多人房间邀请朋友");
      room.table.prune();
      const p = room.table.addPlayer(cleanName(input.name), {
        token: randomBytes(24).toString("hex"),
        avatar: Number.isInteger(input.avatar) ? Math.abs(input.avatar % 8) : 0,
      });
      room.table.log(`${p.name} 加入牌桌`);
      return enter(room, p);
    });
    event("resume", (input) => {
      const room = rooms.get(String(input.code));
      const p = room?.table.players.find(
        (p) => p.token === input.token && !p.bot && !p.left,
      );
      if (!room || !p) throw new Error("原房间已关闭，请重新加入");
      if (socket.data.code && socket.data.playerId !== p.id)
        throw new Error("当前连接已加入房间");
      const old = io.sockets.sockets.get(p.socketId);
      if (old && old.id !== socket.id) {
        old.data = {};
        old.emit("replaced");
        old.disconnect(true);
      }
      return enter(room, p);
    });
    const startRound = () => {
      const { room } = host();
      room.table.prune();
      if (room.mode === "solo" && !room.table.playing) {
        const minimum = room.table.baseStake ?? room.table.minBet ?? 1;
        for (const p of room.table.players)
          if (p.stack < minimum) {
            p.stack = room.table.buyIn;
            room.table.log(`${p.name} 补充娱乐筹码至 ${p.stack}`);
          }
      }
      room.table.start();
      emit(room);
    };
    event("deal", startRound);
    event("start", startRound);
    event("next", startRound);
    event("action", (input) => {
      const { room, player } = current();
      if (
        input.version !== room.table.version ||
        input.hand !== room.table.hand
      )
        throw new Error(STALE_ACTION);
      room.table.action(player.id, input);
      emit(room);
    });
    event("bots", (input) => {
      const { room } = host();
      room.table.prune();
      const game = games.get(room.gameType);
      if (!game.bots) throw new Error("此游戏暂不支持练习伙伴");
      const free = game.maxPlayers - room.table.players.length;
      if (!free) throw new Error("牌桌已满");
      const requested = input.count ?? game.practiceBots ?? free;
      if (
        !Number.isSafeInteger(requested) ||
        requested < 1 ||
        requested > game.maxPlayers
      )
        throw new Error("机器人数量无效");
      const names = [
        "薄荷团子",
        "桃桃汽水",
        "午夜布丁",
        "星星奶糖",
        "奶盖小熊",
        "月亮松饼",
        "抹茶狐狸",
        "椰椰小猫",
        "橘子海",
        "芝士年糕",
      ].filter((name) => !room.table.players.some((p) => p.name === name));
      for (let i = names.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [names[i], names[j]] = [names[j], names[i]];
      }
      const count = Math.min(requested, free);
      for (let i = 0; i < count; i++)
        room.table.addPlayer(names[i], { bot: true, avatar: randomInt(8) });
      room.table.log(
        `加入 ${count} 位机器人${room.table.playing ? "，下一手入局" : ""}`,
      );
      emit(room);
    });
    event("removeBot", () => {
      const { room } = host();
      if (room.table.playing) throw new Error("请等本手结束再移除机器人");
      const bot = [...room.table.players].reverse().find((p) => p.bot);
      if (!bot) throw new Error("牌桌上没有机器人");
      room.table.remove(bot.id);
      room.table.prune();
      room.table.log(`机器人 ${bot.name} 离桌，座位已空出`);
      emit(room);
    });
    event("rebuy", () => {
      const { room, player } = current();
      if (room.table.playing) throw new Error("请等本手结束再补充筹码");
      if (player.stack >= room.table.buyIn)
        throw new Error("你的筹码已经足够了");
      player.stack = room.table.buyIn;
      room.table.version++;
      room.table.log(`${player.name} 补充筹码至 ${player.stack}`);
      emit(room);
    });
    event("chat", (input) => {
      const { room, player } = current();
      const message =
        typeof input.text === "string" ? input.text.trim().slice(0, 200) : "";
      if (!message) throw new Error("消息不能为空");
      if (Date.now() - (player.lastChat || 0) < 700)
        throw new Error("消息发送太快");
      player.lastChat = Date.now();
      room.messages.push({
        id: randomBytes(6).toString("hex"),
        name: player.name,
        avatar: player.avatar,
        text: message,
      });
      room.messages = room.messages.slice(-60);
      emit(room);
    });
    event("leave", () => {
      const { room, player } = current();
      room.table.remove(player.id);
      socket.data = {};
      migrate(room);
      emit(room);
      room.table.prune();
    });
    socket.on("disconnect", () => {
      const room = rooms.get(socket.data.code);
      const p = room?.table.players.find(
        (p) => p.id === socket.data.playerId && p.socketId === socket.id,
      );
      if (p) {
        p.connected = false;
        migrate(room);
        emit(room);
      }
    });
  });
  const ticker = setInterval(() => {
    for (const [code, room] of rooms) {
      if (
        Date.now() - room.updated > 6 * 60 * 60 * 1000 &&
        !room.table.players.some((p) => !p.bot && p.connected)
      ) {
        rooms.delete(code);
        continue;
      }
      const t = room.table;
      const p = t.players[t.turn];
      if (!t.playing || !p) continue;
      if (!room.table.players.some((p) => !p.bot && p.connected)) continue;
      if (
        (p.bot &&
          Date.now() >= t.deadline - (t.actionTimeout ?? 35000) + botDelay) ||
        Date.now() >= t.deadline
      ) {
        t.automaticAction(p.id, p.bot);
        emit(room);
      }
    }
  }, tickInterval);
  ticker.unref();
  server.on("close", () => clearInterval(ticker));
  return {
    server,
    io,
    rooms,
    close: () => {
      clearInterval(ticker);
      io.close();
    },
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createCasino();
  server.on("error", (error) => {
    console.error(`启动失败：${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "0.0.0.0", () => {
    console.log(
      `\n  ♠ KAWAII CASINO · 朋友游戏厅\n\n  本机：http://localhost:${port}`,
    );
    for (const n of Object.values(networkInterfaces()).flat())
      if (n.family === "IPv4" && !n.internal)
        console.log(`  局域网：http://${n.address}:${port}`);
    console.log("\n  同一 Wi-Fi 下打开局域网地址即可加入。按 Ctrl+C 关闭。\n");
  });
}
