<p align="center">
  <a href="README.md">English</a> · <b>한국어</b> · <a href="README.ja.md">日本語</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a>
</p>

<h1 align="center">site2api</h1>

<p align="center"><b>사용 중인 웹앱을 에이전트가 호출할 수 있는 MCP 도구로 만드세요.</b><br>
몇 가지 동작을 기록하고 로컬 MCP 서버를 생성한 뒤, 읽기 도구를 실제 사이트에서 검증합니다.</p>

<p align="center">
  <a href="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml"><img src="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6d4aff" alt="MIT 라이선스"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=node.js&logoColor=white" alt="Node 22.12+">
  <img src="https://img.shields.io/badge/MCP-server-1c2030" alt="MCP">
  <img src="https://img.shields.io/badge/Agent%20Skills-Claude%20Code%20%C2%B7%20Cursor%20%C2%B7%20Codex-1c2030" alt="Agent Skills">
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="기록한 웹앱의 요청이 에이전트에 연결되는 MCP 도구 세 개로 변하는 모습" width="860">
  <br><sub>브라우저 요청에서 호출 가능한 도구까지. <a href="docs/assets/demo.mp4">고화질 영상 보기</a>.</sub>
</p>

## 왜 site2api인가요?

많은 웹앱은 자체 프런트엔드에서 JSON이나 GraphQL API를 호출하지만, 필요한 기능을 위한 공개 API는 제공하지 않습니다. 에이전트가 매번 브라우저를 조작할 수도 있지만, 그러면 작업마다 화면 동작에 의존하게 됩니다.

site2api는 사용자가 웹앱을 이용하는 동안 그 요청을 기록합니다. 작업과 입력 형식을 파악하고 주문 ID 같은 값의 출처를 추적한 다음 로컬 MCP 서버를 생성합니다. 생성 전에 읽기 작업을 실제 사이트에 호출해 기록된 응답과 일치하는지 확인합니다.

**잘 맞는 대상:** JSON 또는 GraphQL API를 사용하는 웹앱, 대시보드, 사용 권한이 있는 사내 도구, 검색 화면. HTML만 반환하는 사이트나 일반 브라우저 접근을 차단하는 사이트에는 적합하지 않습니다.

## 빠른 시작

Node.js 22.12 이상과 설치된 Chrome이 필요합니다. Chrome을 사용할 수 없다면 `npx playwright install chromium`으로 Playwright Chromium을 한 번 설치하세요.

```bash
npx site2api run https://app.example.com
```

전용 브라우저 프로필이 열립니다. 필요하면 로그인하고, 도구로 만들 기능을 서로 다른 입력으로 각각 두 번 이상 사용한 뒤 Enter를 누르세요. 명령어가 기록·분석·읽기 작업 검증을 마치고 독립 실행형 서버를 `out/mcp/`에 생성합니다. LLM 제공자를 설정하지 않았다면 휴리스틱 도구 이름을 사용하며, 나중에 다듬을 수 있습니다.

```text
out/
├── report.md       # 작업과 입력값의 관계
├── verify.json     # 읽기 작업별 통과·경고·실패·건너뜀
└── mcp/
    ├── server.mjs  # MCP SDK가 포함된 서버
    ├── tools.json  # 도구 정의
    └── mcp.json    # 클라이언트 설정
```

생성된 서버를 MCP 클라이언트에 등록하세요. Claude Code에서는 다음과 같이 실행합니다.

```bash
claude mcp add app -e SITE2API_COOKIE='<Cookie header>' -- node /absolute/path/to/out/mcp/server.mjs
```

필요한 자격 증명만 생성된 `out/mcp/README.md`에서 확인해 설정하세요. 다른 클라이언트 설정은 [생성된 서버 안내](docs/generated-server.md)를 참고하세요. 화면 없이 기록하려면 [캡처 스크립트](docs/capture-scripts.md)를 사용하거나 DevTools의 HAR을 가져올 수 있습니다.

### 코딩 에이전트와 함께 사용하기

[`skills/site2api`](skills/site2api)를 프로젝트의 `.claude/skills/` 또는 `.agents/skills/`에 복사한 뒤 요청하세요.

> https://app.example.com용 MCP 서버를 만들어 줘. 검색, 내 주문 목록, 주문 상세가 필요해.

스킬이 기록·도구 이름 지정·검증·생성 과정을 안내합니다. 기존 코딩 에이전트를 사용하므로 이 방식에는 별도의 LLM API 키가 필요하지 않습니다. 자세한 내용은 [에이전트에서 사용하기](docs/agents.md)를 참고하세요.

## 생성된 서버가 제공하는 기능

| 기능 | 작동 방식 |
|---|---|
| **필요한 입력만 노출** | 기록된 샘플에서 바뀌지 않은 값은 필수 인수가 아닌 기본값이 됩니다. |
| **이어지는 도구 호출** | 설명에 `list_orders` 결과의 `orderId`처럼 입력값의 출처가 표시됩니다. |
| **인증 처리** | 서버는 세션 쿠키·bearer 토큰·API 키를 환경 변수에서 읽고, 기록된 CSRF 토큰을 가져와 갱신할 수 있습니다. |
| **쓰기 제어** | 쓰기 도구는 기본적으로 제외됩니다. `--allow-writes`를 사용해도 호출마다 `confirm: true`가 필요합니다. |
| **로컬 결과물** | `server.mjs`에는 MCP SDK가 포함돼 있어 `out/mcp/`에서 추가 의존성 설치 없이 Node.js로 실행됩니다. |

기록부터 생성까지의 단계는 [작동 방식](docs/how-it-works.md)에 설명돼 있습니다.

## 연결하기 전에 검증하기

```text
✅ list_orders      HTTP 200
🟡 search_stories   HTTP 200, but missing: /processingTimingsMS/fetch/total
❌ get_product      /price: expected number, got string
⏭  get_invoice      needs input: invoiceId
```

`site2api verify out`은 읽기 작업을 실제 사이트에 호출하고 응답을 기록된 스키마와 비교합니다. **통과**는 일치, **경고**는 타입은 같지만 모든 기록 샘플에 있던 필드가 빠진 상태, **실패**는 예상 밖 상태 코드나 스키마 불일치, **건너뜀**은 입력값 또는 자격 증명이 필요한 상태입니다. `verify`는 쓰기와 로그인 작업을 호출하지 않습니다. `generate --only-verified`는 통과·경고 상태의 읽기 도구를 포함합니다. 자세한 내용은 [검증 안내](docs/verify.md)를 참고하세요.

## 보안과 사용 범위

사용 권한이 있는 계정과 데이터에 한해, 해당 사이트의 이용 약관에 따라 사용하세요.

- **원본 기록은 비공개로 보관하세요.** HAR에는 세션 자격 증명이 포함될 수 있습니다. `--discard-har`를 선택하지 않으면 사용자만 읽을 수 있는 로컬 디렉터리에 남습니다. 커밋하거나 공유하지 마세요.
- **생성 파일에는 기록된 자격 증명 값을 넣지 않습니다.** 명세·보고서·주석·검증 결과·서버 파일을 쓰기 전에 기록된 자격 증명의 지문과 대조합니다. 실행 중인 서버는 환경 변수에서 자격 증명을 읽습니다.
- **쓰기는 명시적으로 활성화해야 합니다.** `verify`는 쓰기를 실행하지 않으며, 생성된 쓰기 도구도 호출마다 `confirm: true`가 필요합니다.
- **차단 우회나 대량 크롤링을 위한 도구가 아닙니다.** CAPTCHA·봇 탐지를 우회하거나 스텔스 플러그인·프록시 로테이션을 사용하지 않습니다.

선택 사항인 `infer` 명령은 기록된 값이 아닌 작업 이름과 데이터 구조를 설정된 LLM 제공자에게 전송합니다. site2api에는 텔레메트리가 없습니다. 정확한 데이터 흐름과 제한 사항은 [보안 모델](docs/security.md)을 참고하세요.

## 자주 묻는 질문

**LLM API 키가 필요한가요?** `run`의 휴리스틱 이름이나 기존 코딩 에이전트와 함께 쓰는 Agent Skill에는 필요하지 않습니다. 선택 사항인 `infer`에는 제공자 설정이 필요합니다.

**세션이 만료되면 어떻게 하나요?** 서버 환경 변수의 자격 증명을 갱신하세요. 서버를 다시 생성할 필요는 없습니다.

**사이트가 바뀌면 어떻게 하나요?** `site2api verify out`으로 영향을 받은 도구를 확인한 뒤, 필요하면 다시 기록하고 생성하세요.

**어떤 클라이언트에서 사용할 수 있나요?** stdio 서버를 실행할 수 있는 MCP 클라이언트라면 사용할 수 있습니다. Claude Code, Cursor, Codex, Claude Desktop 등의 설정은 [클라이언트 안내](docs/generated-server.md)를 참고하세요.

## 문서

[시작하기](docs/getting-started.md) ·
[CLI 레퍼런스](docs/cli.md) ·
[캡처 스크립트](docs/capture-scripts.md) ·
[에이전트에서 사용하기](docs/agents.md) ·
[검증](docs/verify.md) ·
[생성된 서버](docs/generated-server.md) ·
[작동 방식](docs/how-it-works.md) ·
[보안 모델](docs/security.md)

## 개발

```bash
pnpm install
pnpm test
pnpm demo
pnpm build && node dist/cli.js run http://localhost:4317 --script demo/shop/capture.mjs
```

데모 애니메이션은 `demo/motion/`의 [HyperFrames](https://github.com/heygen-com/hyperframes) 프로젝트입니다. 기여 방법과 정책은 [CONTRIBUTING.md](CONTRIBUTING.md), [행동 강령](CODE_OF_CONDUCT.md), [보안 정책](SECURITY.md), [변경 내역](CHANGELOG.md)을 참고하세요.

## 라이선스

MIT
