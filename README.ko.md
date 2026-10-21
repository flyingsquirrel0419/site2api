<p align="center">
  <a href="README.md">English</a> · <b>한국어</b> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a>
</p>

<h1 align="center">site2api</h1>

<p align="center"><b>자주 쓰는 웹사이트를 검증된 MCP 서버로 바꿉니다.</b><br>
사이트를 한 번만 써 보세요. 에이전트는 실제 사이트로 검증을 마친 진짜 도구를 얻습니다.</p>

<p align="center">
  <a href="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml"><img src="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6d4aff" alt="MIT 라이선스"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=node.js&logoColor=white" alt="Node 22.12+">
  <img src="https://img.shields.io/badge/MCP-server-1c2030" alt="MCP">
  <img src="https://img.shields.io/badge/Agent%20Skills-Claude%20Code%20%C2%B7%20Cursor%20%C2%B7%20Codex-1c2030" alt="Agent Skills">
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="스캐너 빔이 웹사이트 카드를 엑스레이처럼 훑자 숨은 API 호출이 검증된 도구 세 개가 되어 MCP로 에이전트에 연결되는 모습" width="860">
  <br><sub>모든 웹사이트에는 이미 API가 있습니다. site2api가 그걸 꺼내고, 검증해서, 에이전트에게 넘겨줍니다. (<a href="docs/assets/demo.mp4">고화질 영상</a>)</sub>
</p>

---

## 문제

매일 쓰는 사이트 대부분에는 공개 API가 없습니다. 쇼핑몰, 은행 대시보드, 회사 내부 도구,
즐겨 읽는 포럼 모두 그렇습니다. 이 사이트들의 프런트엔드는 멀쩡한 비공개 API와 통신하지만,
에이전트는 그 API를 볼 수 없습니다. 그래서 HTML을 스크래핑하거나 브라우저를 한 번씩 클릭하며
조작합니다. 느리고, 쉽게 깨지고, 비쌉니다.

**site2api는 사용자가 사이트를 쓰는 동안 그 비공개 API를 지켜보고, 에이전트에게 그 API용 MCP
서버를 만들어 줍니다.** 엔드포인트, 입력값과 그 출처, 로그인 방식을 알아낸 다음, 사용자가 쓰기
전에 모든 읽기 전용 도구를 실제 사이트에 호출해 봅니다.

## 빠른 시작

> site2api는 아직 npm에 없습니다. 그때까지는 `git clone` 후 `pnpm install && pnpm build && npm link`를 실행하고,
> 이 문서에서 `npx site2api`라고 쓴 곳마다 `site2api`를 사용하세요.

**코딩 에이전트로** (Claude Code, Cursor, Codex 등
[Agent Skills](https://agentskills.io)를 지원하는 모든 에이전트): [`skills/site2api`](skills/site2api)를
프로젝트의 `.claude/skills/` 또는 `.agents/skills/`에 복사한 뒤 이렇게 요청하세요.

> https://app.example.com용 MCP 서버를 만들어 줘. 검색, 내 주문 목록, 주문 상세가 필요해.

스킬이 녹화, 도구 이름 짓기, 검증, 생성까지 에이전트를 안내합니다. API 키는 필요 없습니다.
생각은 에이전트가 합니다.

**명령어 한 줄로:**

```bash
npx site2api run https://app.example.com
```

브라우저 창이 열립니다. 로그인하고, 도구로 만들고 싶은 기능을 사용한 뒤(기능마다 두 번씩이 가장 좋습니다)
Enter를 누르세요. 그러면 독립 실행형 서버인 `out/mcp/`가 만들어집니다.

```bash
claude mcp add app -e SITE2API_COOKIE='…' -- node out/mcp/server.mjs   # or use out/mcp/mcp.json
```

화면이 없거나 CI에서 실행하나요? 대신 스크립트로 브라우저를 조작하세요.
`npx site2api run https://app.example.com --script capture.mjs` ([캡처 스크립트](docs/capture-scripts.md)).

## 작동 방식

<p align="center"><img src="docs/assets/flow.svg" alt="녹화, 정규화, 추적, 추론, 검증, 생성" width="900"></p>

| | 단계 | 하는 일 |
|---|---|---|
| 1 | **녹화** | 전용 프로필을 쓰는 브라우저가, 사용자(또는 스크립트)가 사이트를 쓰는 동안 API 호출을 녹화합니다. DevTools에서 받은 HAR을 가져와도 됩니다. |
| 2 | **정규화** | 정적 파일과 분석 요청을 걸러내고, `/orders/3f6c…`를 `/orders/{orderId}`로 바꾸고, JSON 스키마를 병합하고, GraphQL 작업을 분리하고, 쿠키·bearer 토큰·CSRF 헤더·API 키를 감지합니다. |
| 3 | **추적** | 모든 입력값의 출처를 찾습니다. 주문 ID는 주문 목록에서, CSRF 토큰은 `/api/session`에서 옵니다. 결정적으로 동작하며 LLM을 쓰지 않습니다. |
| 4 | **추론** | 도구 이름과 설명을 짓고, 각 작업을 읽기·쓰기·인증으로 분류합니다. 코딩 에이전트가 스킬로 처리하거나, `site2api infer`가 Claude 또는 OpenAI 호환 API를 호출합니다. |
| 5 | **검증** | 모든 읽기 전용 도구를 실제 사이트에 호출하고 응답을 녹화된 스키마와 대조합니다. 쓰기와 로그인 작업은 절대 호출하지 않습니다. |
| 6 | **생성** | `server.mjs` + `tools.json` + `mcp.json`. MCP SDK가 번들된 단일 파일이라 `node server.mjs`만 실행하면 되고, 설치할 것이 없습니다. |

자세히: [작동 방식](docs/how-it-works.md).

## 에이전트가 얻는 것

- **서로 이어지는 도구.** 설명에 입력값의 출처가 적혀 있어서("`list_orders` 결과의
  `orderId` 사용"), 에이전트가 추측 없이 `list_orders` → `get_order`를 호출합니다.
- **꼭 필요한 입력만.** 녹화 중 한 번도 바뀌지 않은 값(클라이언트 버전, 페이지 크기 등)은
  기본값이 됩니다. hn.algolia.com에서는 검색 도구의 필수 입력이 19개에서 3개로
  줄었습니다.
- **로그인 자동 처리.** 세션 쿠키, bearer 토큰, API 키는 환경 변수에서 가져오고,
  CSRF 토큰은 자동으로 받아오고 갱신합니다.
- **쓰기는 잠금 뒤에.** 데이터를 바꾸는 도구는 `--allow-writes`를 넘기지 않으면 제외되며,
  넘기더라도 호출할 때마다 `confirm: true`가 필요합니다.
- **명확한 실패 메시지.** 세션이 만료되면 만료됐다고 알려 줍니다. 사이트에 연결할 수 없으면 어느 호스트가 왜 안 되는지 알려 줍니다.

자세히: [생성된 서버](docs/generated-server.md).

## 생성으로 끝나지 않고, 검증까지

```text
✅ list_orders                  HTTP 200
✅ get_order                    HTTP 200
🟡 search_stories               HTTP 200, but missing: /processingTimingsMS/fetch/total
❌ get_product                  /price: expected number, got string
```

`site2api verify`는 연결된 응답이나 녹화에서 가져온 입력값으로 모든 읽기 도구를 실제 사이트에
다시 실행합니다. **✅**는 일치합니다. **🟡**는 동작하지만, 항상 있던 일부 필드가 빠졌습니다(대개
선택 필드입니다). **❌**는 타입이 바뀌었거나 예상하지 못한 상태 코드가 왔다는 뜻으로, API가 바뀌었을
가능성이 높습니다. `generate --only-verified`는 ✅와 🟡를 남깁니다. 주기적으로 실행하면 API 변경을
잡아낼 수 있습니다. 자세히: [verify](docs/verify.md).

## 비교

| | HAR → OpenAPI 변환기 | 브라우저 조작 에이전트 | **site2api** |
|---|---|---|---|
| 결과물 | OpenAPI 파일 | 매번 클릭 | **MCP 서버** |
| 호출당 속도 | — | 수 초에서 수 분 | **HTTP 요청 한 번** |
| 입력값의 출처를 아는가 | 아니요 | 매번 새로 찾음 | **예, 트래픽에서 추적** |
| 로그인, CSRF, API 키 | 직접 처리 | 실행할 때마다 | **서버가 처리** |
| 실제 사이트로 검증 | 아니요 | — | **예 (`verify`)** |
| LLM 필요 여부 | 아니요 | 단계마다 | **도구 이름 짓기에만, 선택 사항** |

## 원칙

site2api는 각 사이트의 이용 약관 범위 안에서 **본인 계정과 본인 데이터**를 위한 도구입니다.

- **자격 증명을 저장하지 않습니다.** 쿠키, 토큰, 키 값은 스펙, 리포트, 주석, 검증 결과, 생성된
  서버 어디에도 들어가지 않습니다. 모든 출력물을 캡처에서 발견된 자격 증명의 솔트 해시와 대조하며,
  하나라도 포함된 파일은 site2api가 쓰기를 거부합니다.
- **평범한 브라우저, 사람의 속도.** 사용자가 조작하든 스크립트가 조작하든, 스텔스도, 봇 탐지나
  CAPTCHA 우회도, 프록시 로테이션도 없습니다. 스크립트에는 요청 예산과 단계 사이 최소 대기 시간이
  있습니다. 대량 스크래핑은 목표가 아닙니다.
- **쓰기는 기본적으로 꺼져 있으며**, `verify`는 쓰기 작업을 절대 호출하지 않습니다.

자세히: [보안 모델](docs/security.md).

## FAQ

**이거 스크래핑 아닌가요?** 아닙니다. 사이트의 프런트엔드가 호출하는 것과 같은 API를, 사용자 본인으로서,
사용자가 직접 쓸 때와 같은 빈도로 호출합니다. 크롤링하지 않으며, 본인 계정용으로 만들어졌습니다.

**CAPTCHA나 봇 차단이 있는 사이트는요?** site2api는 이를 우회하지 않습니다. 평범한 브라우저를
차단하는 사이트라면 맞지 않습니다.

**화면 없는 서버에서도 동작하나요?** 네. 캡처 스크립트(`--script`)로 헤드리스 녹화를 하거나 HAR을
가져오세요. 나머지 단계는 모두 이미 헤드리스로 동작합니다.

**어떤 사이트에 가장 잘 맞나요?** 백엔드와 JSON이나 GraphQL로 통신하는 싱글 페이지 앱입니다. 쇼핑몰,
대시보드, SaaS 도구, 검색 UI 등이 해당합니다. 서버 렌더링 HTML 페이지에는 찾을 API가 없습니다.

**사이트가 바뀌면 어떻게 되나요?** `verify`가 어떤 도구가 어떻게 깨졌는지 알려 줍니다. 다시 녹화하고
재생성하면 됩니다. 1분이면 끝납니다.

**어떤 에이전트가 이 서버를 쓸 수 있나요?** 모든 MCP 클라이언트입니다. Claude Code, Cursor, Codex, Claude Desktop
등이 있습니다. `out/mcp/mcp.json`은 표준 `mcpServers` 형식을 읽는 클라이언트에서 그대로 동작합니다.

## 문서

[시작하기](docs/getting-started.md) ·
[CLI 레퍼런스](docs/cli.md) ·
[캡처 스크립트](docs/capture-scripts.md) ·
[에이전트에서 사용하기](docs/agents.md) ·
[Verify](docs/verify.md) ·
[생성된 서버](docs/generated-server.md) ·
[작동 방식](docs/how-it-works.md) ·
[보안 모델](docs/security.md)

## 개발

```bash
pnpm install
pnpm test          # unit tests + MCP, verify and record end to end against the demo shop
pnpm demo          # the demo shop on :4317
pnpm build && node dist/cli.js run http://localhost:4317 --script demo/shop/capture.mjs
```

데모는 `demo/motion/`에 있는 [HyperFrames](https://github.com/heygen-com/hyperframes) 프로젝트입니다. 다시 렌더하는 방법은 그 폴더의 README에 있습니다. 다른 에이전트에서 스킬 테스트하기:
[docs/testing-skill.md](docs/testing-skill.md).

기여를 환영합니다. [CONTRIBUTING.md](CONTRIBUTING.md), [행동 강령](CODE_OF_CONDUCT.md), 취약점 신고는 [SECURITY.md](SECURITY.md), 변경 내역은 [CHANGELOG.md](CHANGELOG.md)를 보세요.

## 라이선스

MIT
