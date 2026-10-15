# M5b Android 実機検証

Issue: [#18](https://github.com/phni3j9a/PiMate/issues/18)。2026-10-15、Linux x64 でローカル release APK をビルドし、実 Host / Pi / RC Extension に接続して確認した記録です。Expo Go・偽 Host・Metro は使っていません。

## 成果物

| 項目 | 結果 |
|---|---|
| APK | `apps/mobile/dist/pimate-0.1.0.apk`（Git 管理外） |
| サイズ | 135,032,283 bytes（約 128.8 MiB、全 ABI 同梱） |
| APK SHA-256 | `f86700f2a6ad9b534fdba319967ca7f778b3bfb252f62ca35c2489ce738f1926` |
| 署名証明書 SHA-256 | `fdad0d857500d2a34ced4457ca4cfb7c10bb6b1f7235af29b8ed32ced1293ac7` |
| 署名 | RSA 3072 bit、APK Signature Scheme v2、`apksigner verify --verbose --print-certs` 成功 |
| アプリ ID / バージョン | `dev.pimate.app` / versionName `0.1.0` / versionCode `1000` |
| Android | minSdk 24 / targetSdk 36 / compileSdk 36 |
| ABI | arm64-v8a / armeabi-v7a / x86 / x86_64 |
| ビルド | Expo 57、React Native 0.86.3、Temurin JDK 21、Gradle 9.3.1、SDK build-tools 36.0.0、NDK 27.1.12297006 |

`npm run build:android -w @pimate/mobile` で CNG を clean 再生成して作成。初回と最終版を同じ外部署名鍵でビルドし、両端末へ `adb install -r` で上書きできました。最終ビルドは 8 分 16 秒、568 tasks。

新しい PiMate アイコン・splash を最終 clean prebuild に取り込み済みです。生成された foreground / monochrome / splash のバイナリが APK 内の resource と SHA-256 一致することを検証。Fold7 の cold start で新しい青い π の splash を撮影しました。

署名鍵の保管・復元・配布手順は [mobile README](../apps/mobile/README.md#android-apk-のビルドと配布m5b)。この記録は Release 公開・タグ作成・マージの完了を意味しません。

## 実機と接続

- **Galaxy Z Fold7 / SM-F966Z / Android 16**: PC と端末の Tailscale IP 間、HTTP/WS、無線 adb。物理的に閉じた状態の **カバー画面 1080×2520** を使用。
- **Pixel 3 / Android 11**: USB adb。Tailscale 宛は到達せず、確認のうえ `adb reverse tcp:47800 tcp:47800` と loopback のペアリングリンクで検証。**この端末の Tailscale 経路は未検証**。
- Host と RC は配布候補の `/tmp/pimate-rel/package` を使用。Host は検証用の一時 `PIMATE_CONFIG_DIR`、RC は一時 `PIMATE_RUN_DIR` で通常利用分と分離。Pi 1.2.0、モデル `openai/gpt-6-luna`、Thinking off（変更試験を除く）。
- PC 起動 Pi は tmux、スマホ起動 Pi は実際の abduco セッション。テストの write/edit は `/tmp/pimate-m5b-real/work/hello.txt` だけを変更。

## シナリオ結果

スクリーンショット・UI dump・ログの原本は検証 PC の **`/tmp/pimate-m5b-real/`** に保存（リポジトリには含めません）。UIAutomator はアニメーション中に idle 判定できないことがあるため、その場合は実スクリーンショットと PC 側の結果で確認し、古い XML を根拠にはしていません。

| シナリオ | Fold7 | Pixel 3 | 主な証跡（上記ディレクトリ内） |
|---|---|---|---|
| 署名 APK のインストール・起動・更新 | 成功 | 成功 | `build-final.log`、`fold-final-apk.png`、`pixel-final-apk.png` |
| ネイティブ `pimate://` → マシン確認 → ペアリング | Tailscale で成功 | adb reverse で成功 | `fold-paired.png`、`fold-drawer.png`、`pixel-drawer.png` |
| drawer / 実 Pi の一覧・選択 | 成功 | 成功 | `fold-drawer.png`、`pixel-drawer.png` |
| 送信・応答・逐次表示・ツール行 | write → edit → 最終応答、作業中の bash 行を確認 | `Reply PIXEL11` → `PIXEL11` を確認 | `fold-stream.png`、`fold-after-send.png`、`fold-tools.png`、`pixel-send-success.png` |
| 差分レビュー | `hello` → `hello world` の差分を表示 | 同じセッションの差分導線・履歴を確認 | `fold-diff.png`、`fold-tools.png` |
| 停止 | 実行中の `sleep 60` を中断、PC に aborted・アプリに「中断しました」 | 対象外（縮小検証） | `fold-aborted.png` |
| select / confirm / input | 実 Extension の `ctx.ui.*` に端末から回答 | 対象外 | `fold-select.png`、`fold-confirm.png`、`fold-input-keyboard.png`、`dialog-results.json`（`Fold7 selected` / true / `Fold7`） |
| モデル / Thinking 変更 | Luna → Astra → Luna、off → low → off が PC に反映 | 一覧・検索の表示 | `fold-model-astra.png`、`model-change.txt`、`thinking-change.txt` |
| 新規 / 過去セッション再開 | 新規の空会話 → 以前の会話に戻り履歴・区切り表示 | 対象外 | `fold-new-confirm.png`、`fold-resume.png`、`fold-resumed.png` |
| スマホから Pi 起動 → PC attach | 信頼確認・モデル・最初のメッセージ → `HELLO`。`pimate attach` で同じ Pi を操作 | 起動した Pi の一覧を表示 | `fold-spawned.png`、`instances.json`、`attach.txt` |
| pi-subagents 要約・一覧・詳細 | 実バックグラウンド実行・作業記録を確認 | 完了・停止のチャットを表示 | `fold-sub-summary.png`、`fold-sub-sheet.png`、`fold-sub-detail.png` |
| 子への steer | 受領表示、作業境界で指示が届き `STEERED` と回答 | 対象外 | `fold-sub-steer.png`、`fold-sub-steered-complete.png` |
| 子の停止 | 一覧から確認 → 停止、親は継続。PC 側も stopped | 停止後の履歴を表示 | `fold-sub-stop-dialog.png`、`fold-sub-stopped.png`、`subagent-stopped.txt` |
| Host 再起動 | 切断 → 同じ設定で Host 起動 → 再接続、履歴復元 | Host 再起動後に履歴を確認 | `fold-host-offline.png`、`fold-host-reconnected.png` |
| バックグラウンド → 前面 / force-stop → 再起動 | 再ペアリング不要、履歴・操作を復元 | 同じく復元 | `fold-foreground.png`、`fold-restart.png`、`pixel-background-restored.png`、`pixel-restart-ok.png` |
| キーボード | チャット・input 回答・子への指示を入力でき、送信可能 | Android 11 で入力・送信可能 | `fold-keyboard.png`、`fold-input-keyboard.png`、`pixel-keyboard.png` |
| カメラ権限 | QR 実読取は利用者確認待ち | 権限ダイアログ →「今回のみ」→ scanner 起動 | `pixel-camera-permission.png`、`pixel-camera-ready.png` |
| 新アイコン / splash | 最終 APK に取り込み・cold start 表示 | 同じ最終 APK をインストール・起動 | `fold-final-splash.png`、`icon-apk-verification.json` |

実機でアプリ・RC のロジック修正を必要とする不具合は見つかりませんでした。ビルド上の問題は、JRE だけの既存 Java 21 を使わずユーザー領域の **完全な JDK 21** に切り替え、Gradle の署名設定を AGP `finalizeDsl` 時点で適用することで解消しています。

subagents 検証では検証ハーネス由来の `PI_SUBAGENT_CHILD` 等をテスト Pi に継承するとツールが非公開になるため、テスト用プロセスの起動時だけ除去しました。また既存 HyAgents scout のモデル制約と指定 Luna が衝突するため、一時作業ディレクトリの検証専用 agent（Luna/off、read-only）で再試行。実際の pi-subagents バックグラウンド runner と RC 経由の steer/stop を使っています。ユーザーの Pi 設定・agent 定義は変更していません。

## 自動検証・後片付け

- `npm run lint`: 104 files、成功。
- `npm run typecheck`: 全 workspace 成功。追加した Node ベースの config テストに Node 型参照が必要だったため明示し、再実行で成功。
- `npm test`: 23 files / **270 tests 成功**（pimate 110、protocol 7、mobile 153）。追加の versionCode テスト 10 件を含む。
- `bash -n apps/mobile/scripts/build-android-release.sh` / `git diff --check`: 成功。
- テスト Host / PC Pi / スマホ Pi / abduco / tmux は終了。47800 の listen なし、検証用 socket と abduco session なし、Pixel の adb reverse を解除、一時 Host config を削除済み。
- Metro / emulator は起動していません。両端末とも `dev.pimate.app` をインストールしたまま終了し、アンインストールしていません。署名鍵と検証用 JDK、SDK のビルドキャッシュは次回のビルド用に保持しています。

## 残事項・範囲外

- **カメラで PC の QR を実際に読み取る最終確認**は利用者が行います。今回のペアリングは本物のワンタイムリンクを adb の VIEW intent で開いて確認しました。
- **Fold7 内画面・開閉時の再レイアウト**は未検証。端末の物理状態や表示設定を変えていません。カバー画面で崩れは見つかりませんでした。
- Pixel 3 の Tailscale 経路、Android API 24〜29、長時間バックグラウンド・Doze、機内モード切り替えは未検証。個人端末のネットワーク設定は変更していません。
- universal APK は約 129 MiB。ABI 分割や R8/resource shrink は今回有効化していません。
- テスト用トークンは失効済みです。端末に残る古い接続は、本番利用時にアプリの設定から削除して再ペアリングできます。
