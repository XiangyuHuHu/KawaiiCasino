# ♠ Kawaii Casino

**今晚，来一手。** 和朋友在同一 Wi-Fi 下围坐一张紫色像素牌桌。

第一款游戏是 **无限注德州扑克（Texas Hold’em）**，支持 2–8 人、电脑与手机浏览器。纯虚拟筹码，无注册、支付或兑换功能。

![Kawaii Casino 紫色像素德州扑克牌桌](docs/preview.png)

## 快速开始

安装 [Node.js 22 或更高版本](https://nodejs.org/)。Windows 用户可以直接双击 **`start-casino.cmd`**，首次运行会安装依赖。

也可以在终端运行：

```sh
git clone https://github.com/XiangyuHuHu/KawaiiCasino.git
cd KawaiiCasino
npm ci
npm start
```

1. 房主打开 **http://localhost:3000**，输入昵称、选择像素头像并创建房间。
2. 点击「邀请朋友」，把**局域网地址和六位房间号**发给朋友。
3. 朋友连接同一个 Wi-Fi，用浏览器打开邀请链接，输入昵称即可入座；也可以手动输入房间号。
4. 至少两位有筹码的玩家就座后，房主点击「开始发牌」。每手结束后点击「再来一手」。

一个人也能点击「练习伙伴」添加最多三位简单机器人。这些机器人只用于练习，不代表专业策略。

## 局域网连接

服务监听 `0.0.0.0:3000`，终端会打印本机所有 IPv4 地址。选择实际连接 Wi-Fi/以太网的地址，例如 `http://192.168.1.10:3000`；不要选 VPN 或虚拟网卡地址。朋友设备上的 `localhost` 指向朋友自己的设备，应使用房主的局域网地址。

如果打不开：

- 保持主机终端运行，确认两台设备在同一局域网。
- 在 Windows 防火墙提示中允许 **Node.js 访问专用网络**。
- 检查路由器是否启用了访客 Wi-Fi 或 AP/客户端隔离。
- 不需要公网 IP，也不需要路由器端口转发。

端口占用时，可以改端口：

```powershell
$env:PORT = '3001'
npm start
```

macOS / Linux：`PORT=3001 npm start`。

## 已实现

- 六位房间号、邀请链接、多房间隔离，最多 8 位玩家。
- 紫色牌桌、8 款原创 SVG 像素头像、手机布局、可选回合提示音。
- 小盲/大盲、庄位轮转、翻牌前/翻牌/转牌/河牌四轮下注。
- 过牌、跟注、加注、弃牌、全下；输入的加注额为**本轮总下注额**。
- 最佳五张牌比较、A2345 顺子、踢脚比较、边池、平局分池、奇数筹码及未跟注筹码退回。
- 服务端洗牌和裁决；对手底牌只在符合资格的摊牌时公开，弃牌底牌保持隐藏。
- 每次行动 35 秒；超时有欠注则弃牌，否则过牌。
- 原浏览器标签页刷新/重连恢复座位；房主断线自动转移给其他在线真人。
- 中途入座从下一手开始；离桌时在应行动时自动弃牌，已全下的玩家保留底池资格。
- 牌桌聊天、手牌历史、手牌结束后补充虚拟筹码、机器人练习。

## 保存与使用范围

房间、聊天和筹码只保存在服务进程内存中，**服务重启会清空**。没有在线真人的房间会在闲置六小时后清理。原座位凭证保存在当前标签页的 `sessionStorage` 中；关闭标签页后不保证恢复。断线玩家会保留座位并在下一手暂停入局。

这是面向可信局域网朋友的初版。房间号相当于入场口令，服务器主机是可信裁判；尚未加入账号、长期存档、观战、锦标赛、房主踢人或公网服务防护。

客户端和样式资源由本机服务提供，安装完依赖后游戏无需访问 CDN。

## 开发和验证

```sh
npm run dev            # 服务代码变更自动重启（房间会重置）
npm run check          # JavaScript 语法检查
npm test               # 牌型、筹码、边池、下注规则与真实 Socket.IO 联机测试
npx playwright install chromium
npm run test:browser   # 双浏览器对局、刷新恢复、防消息注入及手机布局
```

如果已经安装 Microsoft Edge，可以跳过浏览器下载，运行：

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
npm run test:browser
```

浏览器测试独立运行在 3100 端口。

## 项目结构

```text
public/                  浏览器界面、样式、SVG 像素头像
server/poker.js          独立的德州扑克规则与结算引擎
server/index.js          HTTP 与 Socket.IO 房间服务
test/poker.test.js       规则测试与随机牌局筹码守恒检查
test/network.test.js     多客户端联机测试
test/browser/            Playwright 浏览器端到端测试
start-casino.cmd         Windows 启动入口
```

技术栈：Node.js、Socket.IO、原生 HTML/CSS/JavaScript，无需前端构建。
