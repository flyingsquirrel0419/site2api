<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <b>日本語</b> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.es.md">Español</a>
</p>

<h1 align="center">site2api</h1>

<p align="center"><b>普段使っているサイトを、検証済みの MCP サーバーに。</b><br>
サイトを一度使うだけ。エージェントは、実サイトで動作確認済みの本物のツールを手に入れます。</p>

<p align="center">
  <a href="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml"><img src="https://github.com/flyingsquirrel0419/site2api/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6d4aff" alt="MIT ライセンス"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=node.js&logoColor=white" alt="Node 22.12+">
  <img src="https://img.shields.io/badge/MCP-server-1c2030" alt="MCP">
  <img src="https://img.shields.io/badge/Agent%20Skills-Claude%20Code%20%C2%B7%20Cursor%20%C2%B7%20Codex-1c2030" alt="Agent Skills">
</p>

<p align="center">
  <img src="docs/assets/demo.gif" alt="スキャナーのビームがウェブサイトのカードを X 線のように走査し、隠れた API 呼び出しが検証済みのツール 3 つになって MCP でエージェントにつながる様子" width="860">
  <br><sub>どのウェブサイトにも、すでに API があります。site2api がそれを取り出し、検証して、エージェントに渡します。（<a href="docs/assets/demo.mp4">高画質動画</a>）</sub>
</p>

---

## 課題

毎日使うサイトの多くには公開 API がありません。ネットショップ、銀行のダッシュボード、社内ツール、
よく読むフォーラムなど。サイト自身のフロントエンドはちゃんとしたプライベート API と通信しているのに、
エージェントからはそれが見えません。そのため HTML をスクレイピングしたり、ブラウザを 1 クリックずつ
操作したりすることになります。遅く、壊れやすく、コストもかかります。

**site2api は、あなたがサイトを使っている間にそのプライベート API を観察し、それを扱う MCP サーバーを
エージェントに渡します。** エンドポイント、入力値とその出どころ、ログイン方法を割り出し、
あなたが使い始める前に、読み取り専用のツールをすべて実サイトに対して呼び出して確認します。

## クイックスタート

> site2api はまだ npm に公開されていません。公開までは `git clone` してから `pnpm install && pnpm build && npm link` を実行し、
> このページの `npx site2api` を `site2api` に読み替えてください。

**コーディングエージェントで使う**（Claude Code、Cursor、Codex など、
[Agent Skills](https://agentskills.io) に対応したエージェントならどれでも）: [`skills/site2api`](skills/site2api) を
プロジェクトの `.claude/skills/` または `.agents/skills/` にコピーし、次のように頼みます。

> https://app.example.com の MCP サーバーを作って。検索、自分の注文一覧、注文詳細が欲しい。

スキルがエージェントを、記録、ツールの命名、検証、生成まで案内します。API キーは不要です。
考えるのはエージェントの役目です。

**コマンド 1 つで使う:**

```bash
npx site2api run https://app.example.com
```

ブラウザウィンドウが開きます。ログインし、ツールにしたい機能を使って（それぞれ 2 回ずつがおすすめ）、
Enter を押します。自己完結したサーバー `out/mcp/` ができあがります。

```bash
claude mcp add app -e SITE2API_COOKIE='…' -- node out/mcp/server.mjs   # or use out/mcp/mcp.json
```

画面がない環境や CI で動かす場合は、代わりにスクリプトでブラウザを操作できます:
`npx site2api run https://app.example.com --script capture.mjs`（[キャプチャスクリプト](docs/capture-scripts.md)）。

## 仕組み

<p align="center"><img src="docs/assets/flow.svg" alt="記録、正規化、追跡、推論、検証、生成" width="900"></p>

| | ステージ | 処理内容 |
|---|---|---|
| 1 | **記録（Record）** | 専用プロファイルのブラウザが、あなた（またはスクリプト）がサイトを使う間の API 呼び出しを記録します。DevTools の HAR を持ち込むこともできます。 |
| 2 | **正規化（Normalize）** | 静的ファイルやアナリティクスを除外し、`/orders/3f6c…` を `/orders/{orderId}` に変換、JSON スキーマをマージ、GraphQL オペレーションを分割し、Cookie、Bearer トークン、CSRF ヘッダー、API キーを検出します。 |
| 3 | **追跡（Trace）** | すべての入力値の出どころを突き止めます。注文 ID は注文一覧から、CSRF トークンは `/api/session` から、といった具合です。決定的な処理で、LLM は使いません。 |
| 4 | **推論（Infer）** | ツールに名前を付け、説明文を書き、各オペレーションを read、write、auth に分類します。スキル経由でコーディングエージェントが行うか、`site2api infer` が Claude または OpenAI 互換 API を呼び出します。 |
| 5 | **検証（Verify）** | 読み取り専用ツールをすべて実サイトで呼び出し、レスポンスを記録済みスキーマと照合します。書き込みやログインのオペレーションは決して呼び出しません。 |
| 6 | **生成（Generate）** | `server.mjs` + `tools.json` + `mcp.json`。MCP SDK を同梱した単一ファイルなので、`node server.mjs` だけで動き、インストールは不要です。 |

詳しくは: [仕組み](docs/how-it-works.md)

## エージェントが手に入れるもの

- **連携できるツール。** 説明文に入力値の出どころが書かれている（"use `orderId` from
  `list_orders` results"）ので、エージェントは推測せずに `list_orders` → `get_order` と呼び出せます。
- **本当に必要なものだけが入力に。** 記録中に一度も変わらなかった値（クライアントのバージョンや
  ページサイズなど）はデフォルト値になります。hn.algolia.com では、検索ツールの必須入力が 19 個から
  3 個に減りました。
- **ログインはおまかせ。** セッション Cookie、Bearer トークン、API キーは環境変数から読み込みます。
  CSRF トークンは自動で取得・更新されます。
- **書き込みにはゲート付き。** データを変更するツールは `--allow-writes` を指定しない限り含まれず、
  指定した場合でも呼び出しごとに `confirm: true` が必要です。
- **わかりやすいエラー。** セッションが切れていればそう伝えます。サイトに接続できなければ、どのホストに、なぜ接続できないのかを伝えます。

詳しくは: [生成されるサーバー](docs/generated-server.md)

## 生成するだけでなく、検証まで

```text
✅ list_orders                  HTTP 200
✅ get_order                    HTTP 200
🟡 search_stories               HTTP 200, but missing: /processingTimingsMS/fetch/total
❌ get_product                  /price: expected number, got string
```

`site2api verify` は、すべての読み取りツールを実サイトに対して再実行します。入力値は関連する
レスポンスまたは記録から取得します。**✅** は一致。**🟡** は動作するものの、常に存在していた
フィールドの一部が欠けている状態です（たいていは省略可能なフィールドです）。**❌** は型が変わったか
想定外のステータスが返ったもので、API が変わった可能性が高いことを示します。`generate --only-verified` は ✅ と 🟡 を残します。
定期実行すれば API の変化を検知できます。詳しくは: [検証](docs/verify.md)

## 他の手段との比較

| | HAR → OpenAPI 変換ツール | ブラウザ操作型エージェント | **site2api** |
|---|---|---|---|
| 出力 | OpenAPI ファイル | 毎回のクリック操作 | **MCP サーバー** |
| 1 回あたりの速度 | — | 数秒〜数分 | **HTTP リクエスト 1 回** |
| 入力値の出どころを把握 | いいえ | 毎回探し直す | **はい、通信から追跡** |
| ログイン、CSRF、API キー | 自分で対応 | 実行のたびに | **サーバーが処理** |
| 実サイトでの検証 | いいえ | — | **はい（`verify`）** |
| LLM が必要 | いいえ | 毎ステップ | **ツールの命名のみ、任意** |

## 基本方針

site2api は、各サイトの利用規約の範囲内で、**あなた自身のアカウントとあなた自身のデータ**のために使うツールです。

- **認証情報を保存しません。** Cookie、トークン、キーの値は、スペック、レポート、アノテーション、
  検証結果、生成されたサーバーのいずれにも含まれません。すべての出力は、キャプチャ中に見つかった
  認証情報のソルト付きハッシュと照合され、それを含むファイルは site2api が書き出しを拒否します。
- **普通のブラウザを、人間のペースで。** 操作するのがあなたでもスクリプトでも同じです。ステルス機能、
  ボット検知や CAPTCHA の回避、プロキシのローテーションは一切ありません。スクリプトにはリクエスト数の上限と
  ステップ間の最小待機時間があります。大量スクレイピングは目的外です。
- **書き込みはデフォルトで無効**で、`verify` が書き込みを呼び出すことはありません。

詳しくは: [セキュリティモデル](docs/security.md)

## よくある質問

**これはスクレイピングですか？** いいえ。サイト自身のフロントエンドが呼び出すのと同じ API を、
あなたとして、あなたが操作するのと同じ頻度で呼び出します。クロールはせず、あなた自身のアカウントのために作られています。

**CAPTCHA やボット対策のあるサイトは？** site2api はそれらを回避しません。普通のブラウザを
ブロックするサイトには向いていません。

**画面のないサーバーでも動きますか？** はい。キャプチャスクリプト（`--script`）を使ってヘッドレスで
記録するか、HAR を持ち込んでください。それ以外のステップはもともとヘッドレスで動きます。

**どんなサイトに最適ですか？** バックエンドと JSON や GraphQL で通信するシングルページアプリです。
ショップ、ダッシュボード、SaaS ツール、検索 UI など。サーバーレンダリングの HTML ページには見つけるべき API がありません。

**サイトが変わったらどうなりますか？** `verify` が、どのツールがどう壊れたかを教えてくれます。
もう一度記録して再生成すれば、1 分で済みます。

**どのエージェントからサーバーを使えますか？** MCP クライアントならどれでも使えます。Claude Code、Cursor、Codex、
Claude Desktop など。`out/mcp/mcp.json` は、標準の `mcpServers` 形式を読み込むクライアントでそのまま使えます。

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
pnpm test          # unit tests + MCP, verify and record end to end against the demo shop
pnpm demo          # the demo shop on :4317
pnpm build && node dist/cli.js run http://localhost:4317 --script demo/shop/capture.mjs
```

デモは `demo/motion/` にある [HyperFrames](https://github.com/heygen-com/hyperframes) プロジェクトです。再レンダリングの方法はそのフォルダーの README にあります。他のエージェントでスキルをテストする方法:
[docs/testing-skill.md](docs/testing-skill.md)

## ライセンス

MIT
