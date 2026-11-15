# iOS 版の開発・確認・配布（Devin Cloud）

iOS 版は TestFlight の内部グループ「Internal」だけに配布しています（一般公開・外部テスターなし）。通知はアプリが前面にあるときだけ表示されます（[notifications.md](notifications.md)）。最初の対応は [#146](https://github.com/phni3j9a/PiMate/issues/146) / [#147](https://github.com/phni3j9a/PiMate/pull/147) です。

開発機（Mac mini 2018 / Ubuntu）は Xcode 26.4 以上（Expo SDK 57 の要件）を動かせないため、iOS のビルド・シミュレーター確認・TestFlight へのアップロードは **Devin Cloud の macOS VM** で行います。人（と Main のエージェント）は指示・監査・実機確認を担当します。

## 環境

| 項目 | 内容 |
|---|---|
| Devin | Pro プラン。org `phni3j9a`。GitHub 連携済み |
| VM | macOS 26.6 / Xcode 26.6 / Node 24 / iPhone 17 シミュレーター（2026-11 時点。変わることがある） |
| blueprint | リポジトリ単位で登録。正本は [ios-devin-blueprint.yaml](ios-devin-blueprint.yaml)。変更したら `devin cloud drs blueprint-write --blueprint-id <id> --from-file docs/ios-devin-blueprint.yaml` → `devin cloud drs build-start` で反映する（ID は `devin cloud drs blueprint-list`） |
| スナップショット | blueprint の maintenance で `npm install`・`expo prebuild -p ios`（Pods 込み）・シミュレーター向けビルドを済ませ、セッション開始時から差分ビルドになるようにしている |
| Secrets（Devin の org） | `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_PRIVATE_KEY` / `APPLE_TEAM_ID`。API キーは Admin 権限（2026-11-15 に App Manager のキーから差し替え） |
| App Store Connect | アプリ「PiMate」（Apple ID 6834810849、Bundle ID `dev.pimate.app`、SKU `pimate-ios`）、TestFlight 内部グループ「Internal」 |

## セッションの始め方

- **モデルを選ぶ（Free・SWE-2 Flash など）**: Devin CLI の対話画面を使う。API は `devin_mode` に Free・Flash を指定できず、CLI の `--model` は Cloud に効かない。
  ```sh
  devin --cloud            # 最初のメッセージの前に以下を選ぶ
  # /platform → macOS、/model → 例: SWE-2 Flash（Tab で推論の労力）、/repo → PiMate
  ```
  ブラウザ（app.devin.ai）でも、OS（macOS）・Free などを選んで始められる。
- **Normal 等でよい場合**: API で `{"platform":"macos","repos":["phni3j9a/PiMate"],"prompt":...}` を `POST /v3/organizations/<org>/sessions`。
- 指示は長文を貼らず、Issue のコメントに「Devin への指示」を書き、その URL と本書を読ませる（下のひな形）。

## Devin への指示のひな形

Issue に以下を基にした指示を書く。初回（#146）で起きた逸脱を禁止事項に入れてある。

```
Repo: phni3j9a/PiMate. Work on Issue #<N> on a branch `<N>-<name>` from latest main.
Read docs/ios.md (this procedure), apps/mobile/AGENTS.md, apps/mobile/README.md first.
Goal: <やること>. Write commits / PR / docs in Japanese.

Rules:
- Scope: apps/mobile and related docs only. Do NOT modify packages/ (PC package; its tests run on Linux CI).
  If PC package tests fail on macOS, list them under 残事項 instead of changing them.
- ios/ is generated (CNG); never commit it. Native config only via app.json / app.config.js / plugins.
- Use plain `npx expo prebuild -p ios` (the snapshot is pre-built). Use `--clean` only if native config changed.
- Do not change Android behavior; guard iOS-only fixes with Platform checks.
- Sign only with Xcode automatic signing (`-allowProvisioningUpdates` + the -authenticationKey* flags).
  Do NOT create or revoke certificates / profiles by hand (API, openssl), and do not change App Store Connect
  settings other than uploading a build and adding it to "Internal". If signing fails, stop and ask.
- Never commit secrets (*.p8, *.p12, keys). Do not merge the PR or publish outside TestFlight Internal.
- Every item you could not actually verify (only partially, or blocked by the simulator) must be listed under 残事項.

Steps: build → verify in the Simulator with the dev fake Host (light/dark, screenshots) → fix →
`npm run typecheck && npm run lint && npm test -w @pimate/mobile` → commit/push → PR (結果・主要な判断理由・検証・残事項, `Refs #<N>`)
→ (if requested) TestFlight upload per docs/ios.md.
Reply with: PR URL, TestFlight version/build, verified / not verified, questions.
```

## シミュレーターでの確認

- 開発用 fake Host: `node apps/mobile/scripts/dev-fake-host.mjs --port 47800 --listen 127.0.0.1 --address 127.0.0.1:47800`。出力された `pimate://pair?...` を `xcrun simctl openurl booted '<link>'` で開くとペアリングできる。操作は同スクリプト冒頭の `/_dev/*` を参照。
- 外観: `xcrun simctl ui booted appearance dark|light`、スクリーンショット: `xcrun simctl io booted screenshot <path>`。
- シミュレーターでは確かめられないもの（実機確認へ回す）: QR 読み取り（カメラ）、Tailscale 経由の実 PC 接続、通知の許可と表示、バックグラウンド移行時の切断と復帰、表の右端までの横スクロールと長押し選択（自動操作では一部しかできなかった）、モデルシートの背景タップで閉じるか（自動操作では閉じなかった。実機で要確認）。

## TestFlight へのアップロード

1. `$ASC_PRIVATE_KEY` を `~/.appstoreconnect/private_keys/AuthKey_$ASC_KEY_ID.p8`（chmod 600）に書く。コミットしない。
2. ビルド番号: `app.config.js` は既定で Android の versionCode と同じ値（0.1.18 → 1018）を iOS の `buildNumber` にする。同じバージョンで再アップロードするときは `PIMATE_IOS_BUILD_NUMBER` で App Store Connect の最新より大きい番号を指定する。
3. `xcodebuild archive`（Release、`generic/platform=iOS`）→ `xcodebuild -exportArchive`（`method=app-store-connect`、`destination=upload`）→ ビルドを「Internal」へ追加。
4. 暗号化の申告は `ITSAppUsesNonExemptEncryption: false`（app.json）で毎回不要。

**署名**: Admin 権限の API キーで、Xcode の自動署名（`-allowProvisioningUpdates` と `-authenticationKey*` の指定）に任せる。配布用証明書は Apple 側で管理される（cloud-managed）ため、VM に秘密鍵を置く必要はない。証明書・プロファイルを API や openssl で手作りしない。失敗したら止めて確認する。
経緯: #147 の時点では App Manager のキーだったため自動署名で配布用証明書を作れず、Devin が API で Apple Distribution 証明書とプロファイルを手作りした（秘密鍵は当時の VM にしかなく再利用できない）。2026-11-15 に Admin のキーへ差し替えた。Admin キーでの自動署名はまだ実際には試していない（次のアップロードで確認する）。

## 監査（Main 側）

Devin は範囲外の変更や重い操作を独断で行うことがあるため、Main が監査する。10 分ごとの浅い確認より、push・PR 作成・TestFlight 前の区切りで深く見る方が効果が高い。

- 状態: `GET /v3/organizations/<org>/sessions/<id>`（`status_detail`）、`.../messages`。介入は `POST .../messages`。VM の中は `devin ssh <id>`（TTY が必要なので tmux 内で実行）。
- 差分: `git diff origin/main...origin/<branch>` で `ios/`・秘密情報・`packages/`・意図しない `package-lock.json` を確認。変更した関数・コンポーネントは呼び出し元まで追う（#147 では props の展開をやめた際に `entryId` の受け渡しが抜けかけ、Devin Review が検出した）。
- CI（check / e2e / package）と Devin Review の結果、PR の「残事項」に未確認事項が漏れなく書かれているか。
- PR のスクリーンショットは Devin の一時リンクなので、長期の証拠にはならない。

## 実機での確認項目（TestFlight 版）

- Tailscale 経由で実 PC の QR を読み取ってペアリング、チャットの送受信、再接続
- 通知の許可と前面での表示、バックグラウンドから戻ったときの再接続
- 表の横スクロール（右端まで）と長押しの部分選択、モデル・使用状況シートの開閉（背景タップ）
- ライト / ダーク、文字サイズ
