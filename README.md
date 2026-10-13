# PiMate

Pi Coding Agentを、iOS/AndroidのネイティブUIから操作するためのプロジェクトです。

## プロダクト方針

**[docs/SPEC.md — 合意済みの要件と開発方針](docs/SPEC.md)**

仕様書は意図的に簡潔にしています。ユーザー体験と技術的な前提だけを定め、詳細設計・実装・テスト計画はCodex / Claude Codeなどのコーディングエージェントに任せます。

画面の見た目の基準は **[docs/design/ — 画面モック](docs/design/README.md)** にあります（[一覧ページ](docs/design/index.html)をブラウザで開けます）。

## 現在の段階

Linuxでの技術検証（PoC）を終え、MVP（Android優先、React Native + Expo）を作っています。進め方は [#4 MVPロードマップ](https://github.com/phni3j9a/PiMate/issues/4) にあります。

- PoCの結果・制限・MVPへの推奨: [docs/poc-report.md](docs/poc-report.md)（検証コードは [poc/](poc/README.md)）
- 未検証: macOS、arm64 Linux

## 構成

npm workspacesのmonorepoです。

| パス | 内容 |
|---|---|
| [packages/protocol](packages/protocol/src/index.ts) | RC Extension・Host・アプリが共有するプロトコル v1 の型 |
| [packages/pimate](packages/pimate/README.md) | Piパッケージ。Remote Control Extension（Pi内で動く）とHost（別プロセス） |
| [apps/mobile](apps/mobile/README.md) | Expoアプリ（Android優先） |

## 開発

Node 22.18以上が必要です（Hostは型の除去で `.ts` を直接実行します）。

```bash
npm install
npm run lint && npm run typecheck && npm test
npm run test:e2e -w @pimate/pimate   # 実Pi + abduco（LLMは使わない）
```

以前の詳細仕様書はGit履歴から参照できますが、**現在の設計方針の正本は [docs/SPEC.md](docs/SPEC.md)** です。
