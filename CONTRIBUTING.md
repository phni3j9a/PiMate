# 開発者向けガイド

PiMate の開発に参加する方向けの情報です。使い方は [README.md](README.md) を参照してください。

## 方針と設計の資料

- [docs/SPEC.md](docs/SPEC.md) — 合意済みの要件と開発方針（設計方針の正本）。ユーザー体験と技術的な前提だけを定め、詳細設計・実装・テスト計画はコーディングエージェントに任せる前提で、意図的に簡潔にしています。以前の詳細仕様書は Git 履歴から参照できます。
- [docs/design/](docs/design/README.md) — 画面モック（見た目の基準）。[一覧ページ](docs/design/index.html) をブラウザで開けます。
- [docs/poc-report.md](docs/poc-report.md) — Linux での技術検証の結果・制限・MVP への推奨（検証コードは [poc/](poc/README.md)）。
- [#4 MVP ロードマップ](https://github.com/phni3j9a/PiMate/issues/4)
- `docs/*-verification.md` — 機能ごとの Android 実機・エミュレーターでの確認範囲と限界。

## 構成

npm workspaces の monorepo です。

| パス | 内容 |
|---|---|
| [packages/protocol](packages/protocol/src/index.ts) | RC Extension・Host・アプリが共有するプロトコル v1 の型 |
| [packages/pimate](packages/pimate/README.md) | Pi パッケージ。Remote Control Extension（Pi 内で動く）と Host（別プロセス）、`pimate` CLI |
| [apps/mobile](apps/mobile/README.md) | Expo アプリ（Android 優先） |

配布名は **`@phni3j9a/pimate`** で、内部 workspace 名 `@pimate/pimate` とは別です。

## セットアップと検証

Node 22.18 以上が必要です（Host は型の除去で `.ts` を直接実行します）。

```sh
npm install
npm run lint && npm run typecheck && npm test
npm run test:e2e -w @pimate/pimate   # 実 Pi + abduco（LLM は使わない）
```

PC の Pi なしで画面を確認する方法（開発用 fake Host）は [apps/mobile/README.md](apps/mobile/README.md#pcのpiなしで画面を確認する) を参照してください。

## ビルドとリリース

- PC パッケージの生成・未公開 tarball での検証・公開手順: [packages/pimate/README.md](packages/pimate/README.md#配布パッケージとリリースm5a)
- Android APK のビルド・署名・配布: [apps/mobile/README.md](apps/mobile/README.md#android-apk-のビルドと配布m5b)
- リリースは Android が `app-v…`、PC パッケージが `v…` のタグで、別々に版を上げます。利用者向けの変更点は [CHANGELOG.md](CHANGELOG.md) に追記してください。

## Issue と PR

- 不具合・要望は [Issues](https://github.com/phni3j9a/PiMate/issues) へ。
- 作業は最新のデフォルトブランチから専用ブランチを切り、PR には結果・主な判断理由・検証・残事項を書いてください。
- 現在の仕様・使い方が変わる場合は、README や関連文書も更新してください。
