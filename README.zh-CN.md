<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <b>简体中文</b> · <a href="README.es.md">Español</a>
</p>

<h1 align="center">site2api</h1>

<p align="center"><b>把你常用的任何网站，变成经过验证的 MCP 服务器。</b><br>
用一遍网站，你的智能体就能拿到真正可用的工具，并已对照线上网站验证过。</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6d4aff" alt="MIT 许可证"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white" alt="Node 20+">
  <img src="https://img.shields.io/badge/MCP-server-1c2030" alt="MCP">
  <img src="https://img.shields.io/badge/Agent%20Skills-Claude%20Code%20%C2%B7%20Cursor%20%C2%B7%20Codex-1c2030" alt="Agent Skills">
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="扫描光束像 X 光一样扫过网站卡片，隐藏的 API 调用变成三个已验证的工具，并通过 MCP 接入智能体" width="860">
  <br><sub>每个网站都已经有 API。site2api 把它找出来、验证好，再交给你的智能体。（<a href="docs/assets/demo.mp4">高清视频</a>）</sub>
</p>

---

## 痛点

你每天用的大多数网站都没有公开 API：你的网店、银行的控制台、公司的内部工具、常逛的论坛。
它们自己的前端调用的是一套完全可用的私有 API，但你的智能体看不到。于是它只能抓取 HTML，
或者驱动浏览器一下一下地点：又慢、又脆、又贵。

**site2api 在你使用网站时观察这套私有 API，然后给你的智能体一个对应的 MCP 服务器。**
它会搞清楚有哪些接口、需要哪些输入以及这些输入从哪来、如何登录，并在你真正使用之前，
把每个只读工具都在线上网站上调用一遍。

## 快速开始

> site2api 还没有发布到 npm。在那之前：先 `git clone`，然后 `pnpm install && pnpm build && npm link`，
> 本文中所有 `npx site2api` 都换成 `site2api`。

**配合你的编程智能体**（Claude Code、Cursor、Codex……任何支持
[Agent Skills](https://agentskills.io) 的 Agent）：把 [`skills/site2api`](skills/site2api) 复制到
项目的 `.claude/skills/` 或 `.agents/skills/` 下，然后提问：

> 给 https://app.example.com 做一个 MCP 服务器。我需要搜索、我的订单和订单详情。

这个 Skill 会带着智能体完成录制、工具命名、验证和生成。不需要 API key：思考交给你的智能体。

**一条命令搞定：**

```bash
npx site2api run https://app.example.com
```

会弹出一个浏览器窗口。登录，把你想做成工具的功能都用一遍（每个用两次最好），然后按
Enter。你会得到 `out/mcp/`，一个自包含的服务器：

```bash
claude mcp add app -e SITE2API_COOKIE='…' -- node out/mcp/server.mjs   # or use out/mcp/mcp.json
```

没有屏幕，或者在 CI 里运行？那就让脚本来驱动浏览器：
`npx site2api run https://app.example.com --script capture.mjs`（[capture 脚本](docs/capture-scripts.md)）。

## 工作原理

<p align="center"><img src="docs/assets/flow.svg" alt="录制、规范化、追踪、推断、验证、生成" width="900"></p>

| | 阶段 | 做了什么 |
|---|---|---|
| 1 | **录制** | 在独立配置文件的浏览器中，记录你（或脚本）使用网站时的 API 调用。也可以直接导入 DevTools 导出的 HAR。 |
| 2 | **规范化** | 丢弃静态文件和统计埋点，把 `/orders/3f6c…` 变成 `/orders/{orderId}`，合并 JSON schema，拆分 GraphQL 操作，识别 cookie、bearer token、CSRF 请求头和 API key。 |
| 3 | **追踪** | 找出每个输入的来源：订单 id 来自订单列表，CSRF token 来自 `/api/session`。结果确定，不用 LLM。 |
| 4 | **推断** | 给工具命名、写描述，把每个操作标记为读、写或认证。由你的编程智能体通过 Skill 完成，或者用 `site2api infer` 调用 Claude 或任何兼容 OpenAI 的 API。 |
| 5 | **验证** | 在线上网站调用每个只读工具，并对照录制下来的 schema 检查响应。写操作和登录操作绝不会被调用。 |
| 6 | **生成** | `server.mjs` + `tools.json` + `mcp.json`。单个文件，内置 MCP SDK：`node server.mjs` 即可运行，无需安装任何依赖。 |

详见：[工作原理](docs/how-it-works.md)。

## 你的智能体能得到什么

- **可串联的工具。** 描述里写明输入从哪来（"use `orderId` from
  `list_orders` results"），所以智能体会按 `list_orders` → `get_order` 调用，无需瞎猜。
- **只把关键参数作为输入。** 录制期间从未变化的值（客户端版本、分页大小）会变成默认值。
  在 hn.algolia.com 上，搜索工具的必填输入从 19 个减到了 3 个。
- **登录替它搞定。** Session cookie、bearer token 和 API key 从环境变量读取；
  CSRF token 自动获取并刷新。
- **写操作有闸门。** 会修改数据的工具默认不包含，除非你传入
  `--allow-writes`，即便如此，每次调用也都需要 `confirm: true`。
- **报错清清楚楚。** 会话过期会直说。网站连不上会告诉你是哪个主机、什么原因。

详见：[生成的服务器](docs/generated-server.md)。

## 不只是生成，而是验证过

```text
✅ list_orders                  HTTP 200
✅ get_order                    HTTP 200
🟡 search_stories               HTTP 200, but missing: /processingTimingsMS/fetch/total
❌ get_product                  /price: expected number, got string
```

`site2api verify` 会在线上网站重放每个读工具，输入取自关联的响应或录制数据。**✅** 表示匹配。
**🟡** 表示能用，但一些原本总是存在的字段缺失了（通常是可选字段）。**❌** 表示类型变了或状态码不符合预期，
API 很可能已经改动。`generate --only-verified` 会保留 ✅ 和 🟡。定时运行它，就能及时发现 API
变动。详见：[验证](docs/verify.md)。

## 横向对比

| | HAR → OpenAPI 转换器 | 驱动浏览器的智能体 | **site2api** |
|---|---|---|---|
| 产出 | 一个 OpenAPI 文件 | 每次都要点来点去 | **一个 MCP 服务器** |
| 每次调用耗时 | — | 几秒到几分钟 | **一次 HTTP 请求** |
| 知道输入从哪来 | 否 | 每次重新摸索 | **是，从流量中追踪得出** |
| 登录、CSRF、API key | 自己处理 | 每次运行都要处理 | **由服务器处理** |
| 对照线上网站检查 | 否 | — | **是（`verify`）** |
| 需要 LLM | 否 | 每一步都要 | **仅用于给工具命名，可选** |

## 原则

site2api 面向的是**你自己的账号和你自己的数据**，并遵守各网站的服务条款。

- **不存储凭据。** Cookie、token 和 key 的值绝不会出现在 spec、报告、
  标注、验证结果或生成的服务器中。每一份输出都会与录制时见到的凭据的加盐哈希进行比对，
  只要文件中包含任何一个凭据，site2api 就拒绝写入。
- **普通浏览器，人类节奏。** 无论是你还是脚本在驱动：不做隐身伪装，不绕过反机器人检测或 CAPTCHA，
  不轮换代理。脚本有请求预算，步骤之间有最短间隔。批量抓取不在目标之内。
- **写操作默认关闭**，`verify` 也从不调用它们。

详见：[安全模型](docs/security.md)。

## 常见问题

**这算爬虫吗？** 不算。它调用的是网站自己前端调用的同一套 API，以你的身份、按你自己的频率。
它不会全站爬取，而且是为你自己的账号设计的。

**遇到有 CAPTCHA 或反机器人保护的网站怎么办？** site2api 不会绕过它们。如果某个网站会拦截普通浏览器，
那它就不适用。

**能在没有屏幕的服务器上运行吗？** 能。用 capture script（`--script`）进行无头录制，
或者直接导入 HAR。其他所有步骤本来就是无头的。

**哪些网站效果最好？** 与后端通过 JSON 或 GraphQL 通信的单页应用：网店、控制台、SaaS 工具、搜索界面。
服务端渲染的 HTML 页面没有 API 可找。

**网站改版了怎么办？** `verify` 会告诉你哪些工具坏了、怎么坏的。重新录制再重新生成即可，一分钟就好。

**哪些智能体能用这个服务器？** 任何 MCP 客户端：Claude Code、Cursor、Codex、Claude Desktop
等等。`out/mcp/mcp.json` 在支持标准 `mcpServers` 格式的客户端中可直接使用。

## 文档

[快速上手](docs/getting-started.md) ·
[CLI 参考](docs/cli.md) ·
[Capture scripts](docs/capture-scripts.md) ·
[在智能体中使用](docs/agents.md) ·
[验证](docs/verify.md) ·
[生成的服务器](docs/generated-server.md) ·
[工作原理](docs/how-it-works.md) ·
[安全模型](docs/security.md)

## 开发

```bash
pnpm install
pnpm test          # unit tests + MCP, verify and record end to end against the demo shop
pnpm demo          # the demo shop on :4317
pnpm build && node dist/cli.js run http://localhost:4317 --script demo/shop/capture.mjs
```

演示是 `demo/motion/` 中的 [HyperFrames](https://github.com/heygen-com/hyperframes) 项目，重新渲染的方法见该目录的 README。在其他智能体中测试这个 Skill：
[docs/testing-skill.md](docs/testing-skill.md)。

## 许可证

MIT
