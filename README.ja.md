<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <b>日本語</b> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a>
</p>

<h1 align="center">site2api</h1>

<p align="center"><b>使っている Web アプリを、エージェントが呼び出せる MCP ツールに。</b><br>
いくつかの操作を記録し、ローカルの MCP サーバーを生成して、読み取りツールを実サイトで検証します。</p>

<p align="center">
  <a href="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml"><img src="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6d4aff" alt="MIT ライセンス"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=node.js&logoColor=white" alt="Node 22.12+">
  <img src="https://img.shields.io/badge/MCP-server-1c2030" alt="MCP">
  <img src="https://img.shields.io/badge/Agent%20Skills-Claude%20Code%20%C2%B7%20Cursor%20%C2%B7%20Codex-1c2030" alt="Agent Skills">
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="記録した Web アプリのリクエストが、エージェントに接続する 3 つの MCP ツールになる様子" width="860">
  <br><sub>ブラウザーのリクエストを、呼び出せるツールに。<a href="docs/assets/demo.mp4">高画質動画を見る</a>。</sub>
</p>

## site2api が解決すること

多くの Web アプリは、フロントエンドから JSON や GraphQL の API を呼び出していても、必要な機能の公開 API を提供していません。エージェントに毎回ブラウザーを操作させる方法では、各タスクが画面操作に依存します。

site2api は、あなたがアプリを使う間にそのリクエストを記録します。操作と入力スキーマを特定し、注文 ID などの値の出どころを追跡して、ローカルの MCP サーバーを生成します。生成前に読み取り操作を実サイトで呼び出し、記録したレスポンスと照合します。

**適した対象:** JSON または GraphQL の API を使う Web アプリ、ダッシュボード、利用権限のある社内ツール、検索画面。HTML のみを返すサイトや通常のブラウザーアクセスをブロックするサイトには適していません。

## クイックスタート

Node.js 22.12 以降と、インストール済みの Chrome が必要です。Chrome がない場合は、`npx playwright install chromium` で Playwright Chromium を一度インストールしてください。

```bash
npx site2api run https://app.example.com
```

専用のブラウザープロファイルが開きます。必要ならログインし、ツール化したい機能をそれぞれ異なる入力で 2 回以上使ってから Enter を押してください。コマンドが記録、分析、読み取り操作の検証を行い、自己完結型のサーバーを `out/mcp/` に生成します。LLM プロバイダーを設定していない場合、ツール名にはヒューリスティックな名前が使われ、後から修正できます。

```text
out/
├── report.md       # 操作と入力値の関係
├── verify.json     # 読み取り操作ごとの合格・警告・失敗・エラー・スキップ
└── mcp/
    ├── server.mjs  # MCP SDK を同梱したサーバー
    ├── tools.json  # ツール定義
    └── mcp.json    # クライアント設定
```

生成したサーバーを MCP クライアントに登録します。Claude Code の例:

```bash
claude mcp add app -e SITE2API_COOKIE='<Cookie header>' -- node /absolute/path/to/out/mcp/server.mjs
```

必要な認証情報だけを、生成された `out/mcp/README.md` で確認して設定してください。他のクライアントについては [生成されるサーバー](docs/generated-server.md) を参照してください。画面のない環境では [キャプチャスクリプト](docs/capture-scripts.md) を使えます。DevTools の HAR を取り込むこともできます。

### コーディングエージェントと使う

[`skills/site2api`](skills/site2api) をプロジェクトの `.claude/skills/` または `.agents/skills/` にコピーして、次のように依頼します。

> https://app.example.com の MCP サーバーを作って。検索、自分の注文一覧、注文詳細が欲しい。

スキルが記録、命名、検証、生成を案内します。既存のコーディングエージェントを使うため、この方法に別途 LLM API キーは不要です。詳しくは [エージェントから使う](docs/agents.md) を参照してください。

## 生成されるサーバーの機能

| 機能 | 動作 |
|---|---|
| **必要な入力だけを公開** | 記録したサンプルで変化しなかった値は、必須引数ではなくデフォルト値になります。 |
| **ツールの連携** | `list_orders` の結果にある `orderId` など、入力値の出どころを説明に示します。 |
| **認証** | セッション Cookie、Bearer トークン、API キーを環境変数から読み込み、記録された CSRF トークンを取得・更新できます。 |
| **書き込みの制御** | 書き込みツールはデフォルトで除外されます。`--allow-writes` を使っても、呼び出しごとに `confirm: true` が必要です。 |
| **ローカル出力** | `server.mjs` は MCP SDK を同梱し、`out/mcp/` に依存パッケージを追加せず Node.js で実行できます。 |

各処理の詳細は [仕組み](docs/how-it-works.md) を参照してください。

## 接続前に検証

```text
✅ list_orders      HTTP 200
🟡 search_stories   HTTP 200, but missing: /processingTimingsMS/fetch/total
❌ get_product      /price: expected number, got string
⚠️ get_profile      not authorized: credentials missing or expired
⏭  get_invoice      needs input: invoiceId
```

`site2api verify out` は読み取り操作を実サイトで呼び出し、レスポンスを記録したスキーマと比較します。**合格**は一致、**警告**は型が一致する一方で全サンプルに存在したフィールドが欠けている状態、**失敗**は想定外のステータスやスキーマの不一致、**エラー**はリクエストの失敗、HTTP 401/403 レスポンス、またはリダイレクトが発生した状態、**スキップ**は入力値または認証情報が足りない状態です。`verify` は書き込み操作とログイン操作を呼び出しません。`generate --only-verified` は合格・警告の読み取りツールを含めます。詳しくは [検証](docs/verify.md) を参照してください。

## セキュリティと利用範囲

利用権限のあるアカウントとデータに対して、サイトの利用規約に従って使用してください。

- **元の記録は非公開で保管してください。** HAR にはセッション認証情報が含まれる場合があります。`--discard-har` を指定しない限り、ユーザーだけが読めるローカルディレクトリに残ります。コミットや共有はしないでください。
- **生成ファイルに記録された認証情報の値は含めません。** 仕様、レポート、注釈、検証結果、サーバーファイルを保存する前に、記録された認証情報のフィンガープリントと照合します。実行中のサーバーは環境変数から認証情報を読みます。
- **書き込みは明示的に有効化します。** `verify` は書き込みを実行せず、生成された書き込みツールも毎回 `confirm: true` を要求します。
- **ブロック回避や大量クロールには対応しません。** CAPTCHA やボット対策の回避、ステルスプラグイン、プロキシのローテーションは行いません。

オプションの `infer` コマンドは、記録された値ではなく操作名とデータ構造を設定済みの LLM プロバイダーに送信します。site2api にテレメトリーはありません。データの流れと制限は [セキュリティモデル](docs/security.md) を参照してください。

## よくある質問

**LLM API キーは必要ですか？** `run` のヒューリスティックな命名や、既存のコーディングエージェントで使う Agent Skill には不要です。オプションの `infer` にはプロバイダーの設定が必要です。

**セッションが切れたら？** サーバーの環境変数に設定した認証情報を更新してください。サーバーの再生成は不要です。

**サイトが変わったら？** `site2api verify out` で影響を受けたツールを確認し、必要に応じて再記録・再生成してください。

**対応クライアントは？** stdio サーバーを起動できる MCP クライアントです。Claude Code、Cursor、Codex、Claude Desktop などの設定は [クライアント設定](docs/generated-server.md) を参照してください。

## ドキュメント

[はじめに](docs/getting-started.md) ·
[CLI リファレンス](docs/cli.md) ·
[キャプチャスクリプト](docs/capture-scripts.md) ·
[エージェントから使う](docs/agents.md) ·
[検証](docs/verify.md) ·
[生成されるサーバー](docs/generated-server.md) ·
[仕組み](docs/how-it-works.md) ·
[セキュリティモデル](docs/security.md)

## 開発

```bash
pnpm install
pnpm test
pnpm demo
pnpm build && node dist/cli.js run http://localhost:4317 --script demo/shop/capture.mjs
```

デモアニメーションは `demo/motion/` の [HyperFrames](https://github.com/heygen-com/hyperframes) プロジェクトです。コントリビューションについては [CONTRIBUTING.md](CONTRIBUTING.md)、[行動規範](CODE_OF_CONDUCT.md)、[セキュリティポリシー](SECURITY.md)、[変更履歴](CHANGELOG.md) を参照してください。

## ライセンス

MIT
