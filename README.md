# PiMate

Pi Coding Agentを、iOS/AndroidのネイティブUIから操作するためのプロジェクトです。

## プロダクト方針

**[docs/SPEC.md — 合意済みの要件と開発方針](docs/SPEC.md)**

仕様書は意図的に簡潔にしています。ユーザー体験と技術的な前提だけを定め、詳細設計・実装・テスト計画はCodex / Claude Codeなどのコーディングエージェントに任せます。

画面の見た目の基準は **[docs/design/ — 画面モック](docs/design/README.md)** にあります（[一覧ページ](docs/design/index.html)をブラウザで開けます）。

## 現在の段階

Linuxでの技術検証（PoC）を終え、MVP（Android優先、React Native + Expo）を作っています。進め方は [#4 MVPロードマップ](https://github.com/phni3j9a/PiMate/issues/4) にあります。

- PoCの結果・制限・MVPへの推奨: [docs/poc-report.md](docs/poc-report.md)（検証コードは [poc/](poc/README.md)）
- M5a: PC側の配布パッケージ生成・初回セットアップ・Host常駐/削除に対応（Linux x64で検証）。
- arm64 Linuxはrelease CIでビルド、実機未検証。macOSの常駐登録・Windowsは未対応。

## PCにインストール・スマホとペアリング

Node.js 22以上と Pi 1.2.0以上が必要です。PCとAndroidを同じTailscaleネットワークに接続してください。
公開名は **`pimate`**（内部workspace名 `@pimate/pimate` とは別）。npm公開後は次の手順で導入できます。

```sh
pi install npm:pimate
pi
```

1. PCのPi TUIで **`/pimate setup`** を実行。
2. Hostの起動を確認し、常駐する場合のみ **systemd user service登録** に同意。
   `pimate-host.service` をログイン時に起動します。断ると一時起動し、Piを閉じてもHostは動き続けます。
   linger状態は表示するだけで変更しません。ログアウト後の生存はOS側設定に依存します。
3. QR / `pimate://` リンクをPiMate Androidアプリで開く。コードは10分・1回限りです。
   Android配布は別マイルストーンで、現在は [開発版の手順](apps/mobile/README.md) を使用します。

既定の公開先は **loopback + Tailscaleのみ**。Tailscaleがなければ警告しloopbackのみです。
登録や新しいペアリングはPCのTUIだけから行えます。ペアリングはPiの操作権限を与えるため、リンクを共有しないでください。

- `/pimate pair` — QRを再表示（新しいコード）
- `/pimate devices` — 接続済み端末一覧・失効
- `/pimate status` — Host/Extensionのバージョン、互換性、公開先、常駐状態、abduco
- `/pimate start` / `stop` / `restart` — Host制御（Piセッションは終了しません）
- 更新: `pi update npm:pimate` → Pi再起動または `/reload` → `/pimate status`。旧Hostとの不一致時に再起動を提案します。

### 削除

PCのPiで `/pimate uninstall` → ターミナルで `pi remove npm:pimate`。
Host停止・今回のuser unit削除だけを行い、設定・他のサービス・lingerは変更しません。
ペアリングも忘れる場合は `~/.config/pimate`（環境変数で変更した場合はその場所）を手動削除します。
開発/未公開tarballからの導入とリリース方法は [packages/pimate/README.md](packages/pimate/README.md#配布パッケージとリリースm5a) を参照してください。

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
