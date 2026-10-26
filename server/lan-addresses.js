import { readFile } from "node:fs/promises";
import { isIP } from "node:net";

// A short lease prevents a stopped Windows helper from advertising yesterday's IP.
export function parseHostAddresses(text, now = Date.now()) {
  const snapshot = JSON.parse(text);
  if (
    !Number.isFinite(snapshot.updatedAt) ||
    now - snapshot.updatedAt > 30000 ||
    snapshot.updatedAt > now + 10000
  )
    throw new Error("宿主机地址同步已停止，请重新运行 Docker 启动器。");
  if (!Array.isArray(snapshot.addresses) || snapshot.addresses.length > 32)
    throw new Error("宿主机地址格式无效。");
  const addresses = [
    ...new Set(
      snapshot.addresses.map((value) => {
        const url = new URL(value);
        if (
          url.protocol !== "http:" ||
          isIP(url.hostname) !== 4 ||
          /^(0\.|127\.|169\.254\.)/.test(url.hostname) ||
          url.username ||
          url.password ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        )
          throw new Error("宿主机地址格式无效。");
        return url.origin;
      }),
    ),
  ];
  return {
    addresses,
    source: "host",
    available: addresses.length > 0,
    ...(addresses.length
      ? {}
      : { error: "暂未连接局域网，请连接 Wi-Fi 或网线后重试。" }),
  };
}

export async function readHostAddresses(path) {
  try {
    return parseHostAddresses(await readFile(path, "utf8"));
  } catch (error) {
    return {
      addresses: [],
      source: "host",
      available: false,
      error:
        error.code || error instanceof SyntaxError
          ? "暂时无法获取宿主机地址，请运行 Docker 启动器后重试。"
          : error.message,
    };
  }
}
