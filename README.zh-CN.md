<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="README.ja.md">日本語</a> · <b>简体中文</b> · <a href="README.es.md">Español</a>
</p>

<h1 align="center">site2api</h1>

<p align="center"><b>把你使用的 Web 应用变成智能体可调用的 MCP 工具。</b><br>
记录几次操作，生成本地 MCP 服务器，并在实际网站上验证只读工具。</p>

<p align="center">
  <a href="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml"><img src="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6d4aff" alt="MIT 许可证"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=node.js&logoColor=white" alt="Node 22.12+">
  <img src="https://img.shields.io/badge/MCP-server-1c2030" alt="MCP">
  <img src="https://img.shields.io/badge/Agent%20Skills-Claude%20Code%20%C2%B7%20Cursor%20%C2%B7%20Codex-1c2030" alt="Agent Skills">
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="录制的 Web 应用请求变成连接智能体的三个 MCP 工具" width="860">
  <br><sub>从浏览器请求到可调用的工具。<a href="docs/assets/demo.mp4">观看高清视频</a>。</sub>
</p>

## 为什么需要 site2api

许多 Web 应用的前端会调用 JSON 或 GraphQL API，却没有为你需要的功能提供公开 API。让智能体每次都操作浏览器，会使每项任务依赖页面交互。

site2api 在你使用应用时记录这些请求，识别操作、推断输入结构，并追踪订单 ID 等值的来源，随后生成本地 MCP 服务器。生成之前，它会在实际网站上调用符合条件的只读操作，并报告响应是否与录制结果一致。

**适用场景：** 使用 JSON 或 GraphQL API 的 Web 应用、仪表盘、你有权使用的内部工具，以及搜索界面。仅返回 HTML 的网站，或阻止普通浏览器访问的网站，不适合使用。

## 快速开始

需要 Node.js 22.12 或更高版本，以及已安装的 Chrome。如果没有 Chrome，可先运行一次 `npx playwright install chromium` 安装 Playwright Chromium。

```bash
npx site2api run https://app.example.com
```

命令会打开独立的浏览器配置文件。按需登录，用不同输入将每个想变成工具的功能操作至少两次，然后按 Enter。命令会完成录制、分析和只读操作验证，并在 `out/mcp/` 中生成自包含的服务器。如果没有配置 LLM 服务，工具会先使用规则生成的名称，之后仍可调整。

```text
out/
├── report.md       # 操作与输入值的关联
├── verify.json     # 各只读操作的通过、警告、失败或跳过结果
└── mcp/
    ├── server.mjs  # 内置 MCP SDK 的服务器
    ├── tools.json  # 工具定义
    └── mcp.json    # 客户端配置
```

将服务器注册到 MCP 客户端。以 Claude Code 为例：

```bash
claude mcp add app -e SITE2API_COOKIE='<Cookie header>' -- node /absolute/path/to/out/mcp/server.mjs
```

只设置生成的 `out/mcp/README.md` 中列出的必要凭据。其他客户端的配置方式见[生成的服务器](docs/generated-server.md)。无图形界面时可使用[录制脚本](docs/capture-scripts.md)，也可以导入 DevTools 导出的 HAR。

### 配合编程智能体使用

将 [`skills/site2api`](skills/site2api) 复制到项目的 `.claude/skills/` 或 `.agents/skills/` 目录，然后提问：

> 为 https://app.example.com 创建 MCP 服务器。我需要搜索、我的订单列表和订单详情。

Skill 会引导智能体完成录制、命名、验证和生成。此方式使用你现有的编程智能体，无需单独的 LLM API 密钥。详见[在智能体中使用](docs/agents.md)。

## 生成的服务器提供什么

| 功能 | 工作方式 |
|---|---|
| **只暴露必要输入** | 录制样本中始终不变的值会成为默认值，而不是必填参数。 |
| **串联工具** | 描述中标明输入来源，例如 `list_orders` 结果中的 `orderId`。 |
| **身份验证** | 服务器从环境变量读取会话 Cookie、Bearer 令牌和 API 密钥；还可以获取并刷新录制到的 CSRF 令牌。 |
| **控制写操作** | 默认排除写工具。即使使用 `--allow-writes`，每次调用仍须传入 `confirm: true`。 |
| **本地运行** | `server.mjs` 内置 MCP SDK，在 `out/mcp/` 中无需额外安装依赖即可用 Node.js 运行。 |

各阶段的细节见[工作原理](docs/how-it-works.md)。

## 接入前先验证

```text
✅ list_orders      HTTP 200
🟡 search_stories   HTTP 200, but missing: /processingTimingsMS/fetch/total
❌ get_product      /price: expected number, got string
⏭  get_invoice      needs input: invoiceId
```

`site2api verify out` 会在实际网站上调用只读操作，并将响应与录制的结构比较。**通过**表示匹配；**警告**表示类型匹配，但缺少录制样本中一直存在的字段；**失败**表示状态码或结构不符合预期；**跳过**表示缺少输入或凭据。`verify` 不会调用写操作和登录操作。`generate --only-verified` 会保留通过或警告状态的只读工具。详见[验证](docs/verify.md)。

## 安全与使用范围

仅将 site2api 用于你有权访问的账户和数据，并遵守网站的服务条款。

- **妥善保管原始录制文件。** HAR 可能包含会话凭据。除非使用 `--discard-har`，它会保留在仅当前用户可读的本地目录中。不要提交到仓库或分享。
- **生成文件不会包含录制到的凭据值。** 写入规范、报告、标注、验证结果和服务器文件前，会与录制凭据的指纹进行比对。运行中的服务器从环境变量读取凭据。
- **写操作须主动启用。** `verify` 不会执行写操作；生成的写工具每次调用都要求 `confirm: true`。
- **不用于绕过限制或批量抓取。** site2api 不绕过 CAPTCHA 或反机器人机制，不使用隐身插件或代理轮换，也不以大规模抓取为目标。

可选的 `infer` 命令会向配置的 LLM 服务发送操作名称和数据结构，不发送录制的值。site2api 不收集遥测数据。准确的数据流与限制见[安全模型](docs/security.md)。

## 常见问题

**需要 LLM API 密钥吗？** 使用 `run` 的规则命名，或通过现有编程智能体运行 Agent Skill，都不需要。可选的 `infer` 命令需要配置服务提供方。

**会话过期怎么办？** 更新服务器环境变量中的凭据即可，无需重新生成服务器。

**网站发生变化怎么办？** 运行 `site2api verify out` 找到受影响的工具，必要时重新录制并生成。

**支持哪些客户端？** 所有能启动 stdio 服务器的 MCP 客户端，包括 Claude Code、Cursor、Codex 和 Claude Desktop。详见[客户端配置](docs/generated-server.md)。

## 文档

[入门指南](docs/getting-started.md) ·
[CLI 参考](docs/cli.md) ·
[录制脚本](docs/capture-scripts.md) ·
[在智能体中使用](docs/agents.md) ·
[验证](docs/verify.md) ·
[生成的服务器](docs/generated-server.md) ·
[工作原理](docs/how-it-works.md) ·
[安全模型](docs/security.md)

## 开发

```bash
pnpm install
pnpm test
pnpm demo
pnpm build && node dist/cli.js run http://localhost:4317 --script demo/shop/capture.mjs
```

演示动画是 `demo/motion/` 中的 [HyperFrames](https://github.com/heygen-com/hyperframes) 项目。欢迎贡献，请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)、[行为准则](CODE_OF_CONDUCT.md)、[安全政策](SECURITY.md) 和[更新记录](CHANGELOG.md)。

## 许可证

MIT
