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
- M5b: 署名済み Android APK のローカルビルド・実機検証に対応（Android 7.0 / API 24 以上）。
- M5c: 接続中のローカル通知（親の入力待ち・完了・失敗、子の要対応・失敗・一時停止）と設定に対応。[対象・制限・検証記録](docs/notifications.md)。通知にはアプリ / Host 0.1.1 が必要です。
- arm64 Linuxはrelease CIでビルド、実機未検証。macOSの常駐登録・Windowsは未対応。

Android 0.1.4 / PCパッケージ0.1.6では、スラッシュコマンド候補・セッションツリー・Mtアイコンを追加しました。アプリの作業中の送信は「割り込む」のみになり、停止後の未確認メッセージは「下書きへ戻す」で編集できます。詳細は [mobile README](apps/mobile/README.md) を参照してください。

Android 0.1.5 / PCパッケージ0.1.7では、設定から OpenAI・OpenAI Codex・Anthropic へログイン／ログアウトできるようになり（[プロバイダー認証](docs/provider-auth.md)）、モデル・Thinking シートに Codex / Claude のサブスク利用枠（5時間・週間の使用率とリセット日時）を表示します。どちらも PC パッケージ0.1.7以上が必要で、ログインには Host の再起動も必要です。 現在、OpenAI（`openai`）の ChatGPT ログインは削除して API キーのみとし、Codex・Anthropic のログインは維持しています。

## PCにインストール・スマホとペアリング

Node.js 22以上と Pi 1.2.0以上が必要です。PCとAndroidを同じTailscaleネットワークに接続してください。
公開名は **`@phni3j9a/pimate`**（内部workspace名 `@pimate/pimate` とは別）。次の手順で導入できます（Androidアプリ0.1.5 / PCパッケージ0.1.7。プロバイダーのログイン・利用枠はPCパッケージ0.1.7以上、スラッシュコマンド・セッションツリーはPCパッケージ0.1.6以上、画像添付は0.1.4以上、モデルのお気に入りは0.1.3以上が必要）。

```sh
pi install npm:@phni3j9a/pimate
pi
```

1. Android で [GitHub Releases](https://github.com/phni3j9a/PiMate/releases) の **`app-v…`** リリースから `pimate-….apk` をダウンロードしてインストール。
   Android に確認されたら、ダウンロードに使ったブラウザ／ファイルアプリの「不明なアプリのインストール」を許可します（インストール後に許可を戻して構いません）。APK はこのリポジトリの Releases から取得してください。
2. PCのPi TUIで **`/pimate setup`** を実行。
3. Hostの起動を確認し、常駐する場合のみ **systemd user service登録** に同意。
   `pimate-host.service` をログイン時に起動します。断ると一時起動し、Piを閉じてもHostは動き続けます。
   linger状態は表示するだけで変更しません。ログアウト後の生存はOS側設定に依存します。
   続けて、同意した場合のみ（PCパッケージ0.1.5以上）`pimate` コマンド（`pimate attach` など）のリンクを `$XDG_BIN_HOME` → `$XDG_DATA_HOME/../bin` → `~/.local/bin` の最初のディレクトリに作ります（Pi公式インストーラーの `~/.local/bin/pi` と同じ場所）。
   そのディレクトリがPATHに無ければ追記する行を表示します。シェルの設定ファイルは変更しません。既存の別ファイルは上書きしません。導入済みの場合も `/pimate setup` を再実行すると追加できます。
4. PiMate の「QRコードを読み取る」でカメラを許可し、PC の **`/pimate setup` が表示した QR** を読み取る。
   マシン名・アドレスを確認してペアリングします。`pimate://` リンクの貼り付けも使えます。コードは10分・1回限りです。

画像添付を使うには PC 側も更新し、対象の **Pi を再起動**してください。古い RC は画像を受け付けません（Host の再起動だけでは更新されません）。

APK のビルド・署名・更新方法は [mobile README](apps/mobile/README.md#android-apk-のビルドと配布m5b) を参照してください。同じ署名の新しい APK は既存アプリに上書きインストールできます。

既定の公開先は **loopback + Tailscaleのみ**。Tailscaleがなければ警告しloopbackのみです。
登録や新しいペアリングはPCのTUIだけから行えます。ペアリングはPiの操作権限を与えるため、リンクを共有しないでください。

- `/pimate pair` — QRを再表示（新しいコード）
- `/pimate devices` — 接続済み端末一覧・失効
- `/pimate status` — Host/Extensionのバージョン、互換性、公開先、常駐状態、abduco
- `/pimate start` / `stop` / `restart` — Host制御（Piセッションは終了しません）
- 更新: `pi update npm:@phni3j9a/pimate` → Pi再起動または `/reload` → `/pimate status`。旧Hostとの不一致時に再起動を提案します。

### 削除

PCのPiで `/pimate uninstall` → ターミナルで `pi remove npm:@phni3j9a/pimate`。
Host停止・今回のuser unit削除と、PiMateが作った `pimate` リンクの削除だけを行い、設定・他のサービス・lingerは変更しません。
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
